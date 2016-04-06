//This is a part of another project I made, and modified somewhat to use in the honours project.
"use strict";

if("load" in self) {
	console.warn("self.load already exists! It will be clobbered. Careful.");
}

self.load = (function(self) {
	/** This namespace provides the functions required to import files and resolve dependencies.
	 * 
	 * JavaScript files imported by this system consist of adding them to the page's head tag, one after the other.
	 * Before a new file is added to the head, the old one must have been finished downloading,
	 *  and call `{@link load.provide}` with it's namespace name.
	 * 
	 * A package name may contain as the first character a ">".
	 *  This indicates that it should be downloaded AFTER the current package.
	 *  This should be used to fix circular dependancies by marking the one that should be ran first with this.
	 * 
	 * A dependency may start with the character "@". If so, then the dependency will be interpreted as the URL of a
	 *  remote resource.
	 * 
	 * Dependancy files are used by this system, and are typically generated by `tools/generateDeps.py`. They are JSON
	 *  files containing an object with the following keys (older versions used an array, however):
	 * 
	 * - `version` (required): The version of the dep file. Highest currently is 1.
	 * - `packages`: An array of all the packages the dependancy file describes, in the form `[file, [provided packages]
	 *  , [packages this is dependant on], file size in bytes]`.
	 * - `dependencies`: An array of all the dependencies of this dependency file. These will be downloaded before the
	 *  list is considered ready.
	 */
	var load = {};

	/** Contains all the dependancy information for the files.
	 * 
	 * Each key is an import name, and the value is an array.
	 *  The first element is the filename that provides the file, 
	 *  the second is a state value, as shown below, 
	 *  the third is an array of all the dependancies of the namespace,
	 *  the fourth is the size of the file
	 *  the fifth is the thing that was provided,
	 *  and the sixth is whether it is a script package or a resource
	 * 
	 * Possible values for the state are either 0 (not imported), 
	 *  1 (currently in the proccess of importing) or 2 (successfully imported and ran).
	 * @type object
	 * @private
	 * @since 0.0.12-alpha
	 */
	var _names = {};
	
	var STATE_NONE = 0;
	var STATE_IMPORTING = 1;
	var STATE_IMPORTED = 2;
	var STATE_RAN = 3;
	
	var NFILENAME = 0;
	var NSTATE = 1;
	var NDEPS = 2;
	var NSIZE = 3;
	var NOBJ = 4;
	var NTYPE = 5;
	
	var TYPE_PACK = 0;
	var TYPE_RES = 1;
	
	var USE_THREADING = false;
	
	/** The functions that will be called when the given namespace is imported.
	 * @type array
	 * @private
	 * @since 0.0.21-alpha
	 */
	var _readies = {};
	
	/** An object containing the files that can be imported. Key is the file path, first value is an array of the
	 *  packages it provides, second is an array of packages it depends on, and third is a boolean saying whether the
	 *  file has been added to the document head yet.
	 * @type object
	 * @private
	 * @since 0.0.21-alpha
	 */
	var _files = {};
	
	/** The set of all package names that need to be imported. This is all the packages that have not been imported, but
	 *  have to be imported to satisfy a package that has been imported by `{@link load.import}`.
	 * @type array
	 * @private
	 * @since 0.0.21-alpha
	 */
	var _importSet = [];
	
	/** All the dependency files that have been imported. Key is filename, value is data.
	 * @type object
	 * @private
	 * @since 0.0.21-alpha
	 */
	var _depFiles = {};
	
	/** An array of all uncaught exceptions that have happened.
	 * @type boolean
	 * @private
	 * @since 0.0.21-alpha
	 */
	var _uncaughtErrors = [];
	
	// Set up multithreading
	load.worker = !("document" in self) && !("window" in self)
	
	if(load.worker) {
		// A worker
		
		self.onmessage = function(e) {
			if(e.data[0] == "_load_packs") {
				// Add package information
				load.addDependency.apply(load, e.data[1]);
			}else{
				load.import(e.data[1]).then(function(pack) {
					var output = pack(e.data[2]);
					self.postMessage([e.data[0], output[0]], output[1]);
				});
			}
		}
	}else{
		// Not a worker
		
		/** An array of work orders currently waiting to be processed.
		 * 
		 * New ones are added to the end, and old ones are sliced from the front. Each entry is an `[id, worker package
		 *  name, order object, transfer array]` array.
		 * 
		 * @type array
		 * @private
		 * @since 0.0.21-alpha
		 */
		var _workOrders = [];
		
		/** The array of workers.
		 * @type array
		 * @private
		 * @since 0.0.21-alpha
		 */
		var _workers = [];
		
		/** A map from workers to a boolean indicating that the worker is processing an order.
		 * @type Map<Worker, boolean>
		 * @private
		 */
		var _workerStates = new Map();
		
		/** A counter, it will be increased every time a work order is produced, and is used as the id.
		 * @type integer
		 * @private
		 */
		var _workCounter = 0;
		
		/** A map from work ids to their promise fulfill functions.
		 * @type Map<integer, function(*)>
		 * @private
		 */
		var _workPromises = new Map();
		
		// Create workers
		if(USE_THREADING) {
			var threads = Math.max(navigator.hardwareConcurrency/2, 1);
			for(var i = threads; i > 0; i--) {
				var w = new Worker(document.currentScript.src);
				_workers.push(w);
				_workerStates.set(w, false);
				
				w.onmessage = function(e) {
					_workerStates.set(e.target, false);
					
					var f = _workPromises.get(e.data[0]);
					_workPromises.delete(e.data[0]);
					f(e.data[1]);
				}
			}
			
			// Check for work
			setInterval(function() {
				if(_workOrders.length) {
					for(var worker of _workerStates.entries()) {
						if(worker[1]) {
							continue;
						}
						
						var task = _workOrders.splice(0, 1)[0];
						
						worker[0].postMessage(task.slice(0, 3), task[3]);
						_workerStates.set(worker[0], true);
						
						if(!_workOrders.length) return;
					}
				}
			}, 10);
		}
	}
	
	/** Marks that the namespace `name` has been provided, and associates a given object with it.
	 *   This tells the engine to download the next file in the list,
	 *   and it also creates the namespace object if it doesn't already exist.
	 * 
	 * As a convienience, this will seal the provided package and it's prototype (if it exists) unless the value
	 *  "noSeal" is true in the options. Also, if there is an option "alsoSeal", it will be treated as an array of
	 *  names of package properties to seal as well.
	 * 
	 * @param {string} name The namespace to provide.
	 * @param {?*} pack The object to return when this package is required by other packages.
	 * @param {?object} options Any additional options for the package.
	 * @since 0.0.12-alpha
	 */
	load.provide = function(name, pack, options) {
		console.log("Provided "+name);
		
		if(!options) options = {};
		
		//Set object and imported
		if(name in _names) {
			_names[name][NOBJ] = pack;
			_names[name][NSTATE] = STATE_IMPORTED;
		}else{
			_names[name] = ["", STATE_IMPORTED, [], 0, pack, TYPE_PACK];
		}
		
		//Seal objects
		if(pack && (!("noSeal" in options) || !options.noSeal)) {
			Object.seal(pack);
			if("prototype" in pack) {
				Object.seal(pack.prototype);
			}
			
			if("alsoSeal" in options) {
				options.alsoSeal.forEach(function(v) {
					Object.seal(pack[v]);
					if("prototype" in pack[v]) Object.seal(pack[v].prototype);
				});
			}
		}
		
		//Fire all the functions
		if(name in _readies) {
			for(var i = 0; i < _readies[name].length; i ++) {
				_readies[name][i](pack);
			}
		}
		
		//Fire Event
		if(load.onProvide) {
			setTimeout(load.onProvide.fire.bind(load.onProvide, {"package":name}, name), 1);
		}
		
		// And try to import more if possible
		_tryImport();
	};
	
	load.provideResource = function(name, data) {
		console.log("Provided resource "+name);
		
		//Set object and imported
		if(name in _names) {
			_names[name][NOBJ] = pack;
			_names[name][NSTATE] = STATE_RAN;
		}else{
			_names[name] = ["", STATE_RAN, [], 0, data, TYPE_RES];
		}
		
		//Set object
		_names[name][NOBJ] = data;
		
		//Fire all the functions
		if(name in _readies) {
			for(var i = 0; i < _readies[name].length; i ++) {
				_readies[name][i](pack);
			}
		}
		
		//Fire Event
		if(load.onProvide) {
			setTimeout(load.onProvide.fire.bind(load.onProvide, {"package":name}, name), 1);
		}
		
		// And try to import more if possible
		_tryImport();
	};
	
	/** Adds a dependency.
	 * 
	 *  This tells the engine the file in which the namespaces are provided,
	 *  and what other files must be imported before it.
	 * 
	 * @param {string} file The file name which the namespaces reside.
	 * @param {array} provided An array of namespace names which are provided by the file.
	 * @param {array} required An array of namespace names that are required for this file to run.
	 *  These will be downloaded before this one if any provided namespaces are requested.
	 * @param {integer=0} size The size of the file, in bytes. Optional.
	 * @since 0.0.12-alpha
	 */
	load.addDependency = function(file, provided, required, size, type) {
		if(!size) size = 0;
		
		for(var i = provided.length-1; i >= 0; i--) {
			if(!_names[provided[i]]
			|| (_names[provided[i]][NSTATE] == STATE_NONE &&
				(!(_names[provided[i]][NFILENAME] in _files) || provided.length > _files[_names[provided[i]][0]][0].length))
			){
				_names[provided[i]] = [file, STATE_NONE, required, size, undefined, type];
			}
		}
		
		// Add them to the workers as well
		if(!this.worker) {
			for(var w of _workers) {
				w.postMessage(["_load_packs", Array.prototype.slice.call(arguments)]);
			}
		}
		
		_files[file] = [provided, required, false];
	};
	
	/** Marks the current file as requiring the specified namespace as a dependency, 
	 *  used for generating dependancy information.
	 * 
	 * If there is no garuntee that the package is imported yet either because it starts with ">" or is a suggestion, an
	 *  onReady function should be provided, an example pattern to use is
	 *  `require("project.myPackage", function(p) {myPackage = p});`.
	 * 
	 * @param {string} name The namespace to add as a dependency.
	 * @param {?function(*)} onReady If the package isn't imported yet this will be called with the package when it is.
	 * @return {*} An object that is provided by that namespace.
	 * @since 0.0.15-alpha
	 */
	load.require = function(name, onReady) {
		if(name.charAt(0) == ">") name = name.substring(1);
		
		if(onReady) {
			if(name in _names && _names[name][NSTATE] == STATE_IMPORTING) {
				onReady(load.require(name));
			}else{
				if(!(name in _readies)) _readies[name] = [];
				_readies[name].push(onReady);
			}
		}
		
		if(name in _names) {
			if(_names[name][NSTATE] == STATE_IMPORTED) {
				_names[name][NSTATE] = STATE_RAN;
				_names[name][NOBJ] = _names[name][NOBJ](self);
			}
			return _names[name][NOBJ];
		}
	};
	
	/** Marks the current file as requiring the specified resource as a dependency.
	 * 
	 * @param {string} name The path to the file to add.
	 * @return {string} The string content of that resource.
	 * @since 0.0.15-alpha
	 */
	load.requireResource = function(name) {
		return load.require(name);
	};
	
	/** Identical to `{@link load.require}` in operation, but the package won't be downloaded automatically.
	 * 
	 * @param {string} name The namespace to add as a dependency.
	 * @param {?function(*)} onReady If the package isn't imported yet (via it beginning with ">" for example), this
	 *  will be called with the package when it is.
	 * @return {*} An object that is provided by that namespace.
	 * @since 0.0.21-alpha
	 */
	load.suggest = load.require;
	
	/** Returns a package that has been previously imported. If the package has not been imported, this returns
	 *  undefined and no attempt is made to import the package.
	 * @param {string} name The package to import, as a string name.
	 * @return {promise(*)} A promise that fulfills to the package if it has been imported.
	 * @since 0.0.15-alpha
	 */
	load.getPackage = function(name) {
		if(!load.isImported(name)) {
			return undefined;
		}else{
			if(name.charAt(0) == ">") name = name.substring(1);
			
			return _names[name][NOBJ];
		}
	};
	
	/** Imports a package and returns it.
	 * 
	 * The package must have been previously registered using `addDependency` or `importList`.
	 * 
	 * The namespace will NOT be immediately available after this function call unless it has already been imported
	 *  (in which case the call does not import anything else).
	 * @param {string} name The package to import, as a string name.
	 * @return {promise(*)} A promise that fulfills to the package if it has been imported.
	 * @since 0.0.15-alpha
	 */
	load.import = function(name) {
		return new Promise(function(fulfill, reject) {
			if(!load.isImported(name)) {
				var oldname = name;
				if(name.charAt(0) == ">") name = name.substring(1);
				
				if(!(name in _readies)) _readies[name] = [];
				_readies[name].push(fulfill);
				
				_addToImportSet(oldname);
			}else{
				if(name.charAt(0) == ">") name = name.substring(1);
				
				return fulfill(_names[name][NOBJ]);
			}
		});
	};
	
	/** Imports all packages, usefull for debugging or something.
	 * @since 0.0.15-alpha
	 */
	load.importAll = function() {
		for(var f in _names) {
			load.import(f);
		}
	};
	
	/** Imports all packages that match a given regular expression.
	 * @since 0.0.21-alpha
	 */
	load.importMatch = function(patt) {
		for(var f in _names) {
			if(patt.test(f))
				load.import(f);
		}
	};

	/** Download a JSON containing an array of dependancies. These will be looped through,
	 *  and the entries will be given to `{@link load.addDependency}`.
	 * 
	 * Each entry of the array must itself be an array of the form `[file, provided, required]`.
	 * 
	 * This returns a promise that resolves when the file is downloaded or fails to download.
	 * @param {string} path The path to the JSON file.
	 * @param {function()} callback Will be called when the file load is completed.
	 * @param {function()} errorCallback Will be called if there is an error.
	 * @returns {Promise(object)} A promise.
	 * @since 0.0.15-alpha
	 */
	load.importList = function(path, callback, errorCallback) {
		if(path in _depFiles) return Promise.resolve(_depFiles[path]);
		
		console.log("%cDownloading dependancy file "+path, "color:#999999");
		
		var pfunct = function(fullfill, reject) {
			var union = function(data) {
				if(callback) callback(data);
				if(fullfill) fullfill(data);
			}
			
			var unione = function(data) {
				if(errorCallback) errorCallback(data);
				if(reject) reject(data);
			}
			
			var xhr = new XMLHttpRequest();
		
			xhr.onreadystatechange = function() {
				if(xhr.readyState == 4 && xhr.status > 100 && xhr.status < 400) {
					var relativePath = path.split("/").slice(0, -1).join("/")+"/";
					
					// Hack to get the absolute path
					var a = document.createElement("a");
					a.href = relativePath;
					var absolutePath = a.href;
					
					var data = xhr.response;
					
					if(typeof(data) == "string") data = JSON.parse(data);
					
					if(Array.isArray(data)) {
						//Convert into new format
						data = {"version":0, "packages":data};
					}
					
					_depFiles[path] = data;
					
					var deps = data.packages;
					for(var i = deps.length-1; i >= 0; i--) {
						var now = deps[i]
						
						if(deps[i][0].indexOf(":") === -1 && deps[i][0][0] != "/") deps[i][0] = absolutePath+deps[i][0];
						
						var dlist = now[2];
						if(now.length > 4) dlist = dlist.concat(now[4]);
						load.addDependency(now[0], now[1], dlist, now[3], TYPE_PACK);
						
						if(now.length > 4) {
							for(var j = now[4].length-1; j >= 0; j--) {
								// Convert to absolute paths
								var fpath = now[4][j]
								if(fpath.indexOf(":") === -1 && fpath[0] != "/") {
									fpath = absolutePath + now[4][j];
								}
								load.addDependency(fpath, [now[4][j]], [], 0, TYPE_RES);
							}
						}
					}
					
					if("dependencies" in data) {
						return Promise.all(data.dependencies.map(function(e) {
							return load.importList(e);
						})).then(union.bind(undefined, data));
					}else{
						union(data);
					}
				}else if(xhr.readyState == 4) {
					console.error("Error getting import file, "+xhr.statusText);
					unione(xhr);
				}
			}
			
			xhr.open("GET", path, true);
			xhr.responseType = "json";
			xhr.send();
		}
		
		return new Promise(pfunct);
	};

	/** Given a package, if it has not been imported, it is added to `{@link load._importSet}` and this function is
	 *  called on all its dependancies.
	 * 
	 * @param {string} pack The package to add to the import set.
	 * @private
	 * @since 0.0.21-alpha
	 */
	var _addToImportSet = function(pack) {
		if(_importSet.indexOf(pack) !== -1) return;
		if(!(pack in _names)) {
			throw new load.DependencyError(pack + " required but not found.");
			return;
		}
		if(_names[pack][NSTATE] !== STATE_NONE) return;
		
		_importSet.push(pack);
		var p = _names[pack];
		
		for(var i = 0; i < p[NDEPS].length; i ++) {
			if(p[NDEPS][i].charAt(0) == ">") {
				_addToImportSet(p[NDEPS][i].substring(1));
			}else if(p[2][i].charAt(0) == "@") {
				_importSet.push(p[NDEPS][i]);
			}else{
				_addToImportSet(p[NDEPS][i]);
			}
		}
		
		_tryImport();
	};
	
	/** Looks through the import set, sees if any can be imported (have no unsatisfied dependancies), generates the
	 *  batch set, then calls `{@link load._doImportFile}` to import them.
	 * @param {?boolean} trace If true, then more information is given.
	 * @private
	 * @since 0.0.21-alpha
	 */
	var _tryImport = function(trace) {
		if(!_importSet.length) {
			return;
		}
		
		var _packagesToImport = [];
		
		//Generate the batch set
		for(var i = 0; i < _importSet.length; i ++) {
			if(_importSet[i].charAt(0) == "@") {
				_packagesToImport.push(_importSet[i]);
				_importSet.splice(i, 1);
				i --;
				continue;
			}
			
			var now = _names[_importSet[i]];
			
			var okay = true;
			for(var d = 0; d < now[NDEPS].length; d ++) {
				if(now[NDEPS][d].charAt(0) == ">") {
					//Okay
				}else if(now[NDEPS][d].charAt(0) == "@") {
					//Also Okay
				}else if(!(now[NDEPS][d] in _names)) {
					console.warn(now[NFILENAME] + " depends on "+now[NDEPS][d]+", which is not available.");
					okay = false;
					break;
				}else if(_names[now[NDEPS][d]][NSTATE] < STATE_IMPORTED) {
					// Check if they are from the same file
					if(_names[now[NDEPS][d]][NFILENAME] != now[NFILENAME]) {
						okay = false;
						if(trace) console.log(now[NFILENAME] +" blocked by "+_names[now[NDEPS][d]][NFILENAME]);
						break;
					}
				}
			}
			
			if(okay) {
				if(now[NSTATE] == STATE_NONE) _packagesToImport.push(_importSet[i]);
				_importSet.splice(i, 1);
				i --;
			}
		}
		
		//And then import them all
		if(_packagesToImport.length) console.log("%cImporting: "+_packagesToImport.join(", "), "color:#999999");
		
		for(var i = _packagesToImport.length-1; i >= 0; i --) {
			if(_packagesToImport[i].charAt(0) == "@") {
				_doImportFile(_packagesToImport[i], TYPE_PACK);
			}else{
				_doImportFile(_names[_packagesToImport[i]][NFILENAME], _names[_packagesToImport[i]][NTYPE]);
			}
		}
	}
	
	/** Adds the file to the HTML documents head in a script tag, actually importing the file.
	 * @param {string} file The file to add. If it starts with "@" that character is stripped.
	 * @param {int} type The type of the file; is it a resource (TYPE_RES) or package (TYPE_PACK).
	 * @private
	 * @since 0.0.21-alpha
	 */
	var _doImportFile = function(file, type) {
		if(type == TYPE_PACK) {
			if(file.charAt(0) == "@") file = file.substring(1);
			
			if(!(file in _files)) {
				_files[file] = [[], [], false];
			}
			
			var f = _files[file];
			
			if(f[2]) return;
			f[2] = true;
			
			for(var i = 0; i < f[0].length; i ++) {
				_names[f[0][i]][NSTATE] = STATE_IMPORTING;
			}
			
			if(!("document" in self) && !("window" in self)) {
				importScripts(file);
			}else{
				var js = document.createElement("script");
				js.src = file;
				js.async = true;
				js.addEventListener("error", function(e) {
					throw new load.ImportError(file+" failed to import.");
				});
				document.head.appendChild(js);
			}
		}else{
			var f = _files[file];
			
			for(var i = 0; i < f[0].length; i ++) {
				_names[f[0][i]][NSTATE] = STATE_IMPORTING;
			}
			
			var xhr = new XMLHttpRequest();
		
			xhr.onreadystatechange = function() {
				if(xhr.readyState == 4 && xhr.status > 100 && xhr.status < 400) {
					var content = xhr.response;
					
					for(var i = 0; i < f[0].length; i ++) {
						_names[f[0][i]][NSTATE] = STATE_RAN;
						_names[f[0][i]][NOBJ] = content;
					}
					
					_tryImport();
				}else if(xhr.readyState == 4) {
					console.error("Error getting resource "+file+", "+xhr.statusText);
				}
			}
			
			xhr.open("GET", file, true);
			xhr.responseType = "text";
			xhr.send();
		}
	};
	
	/** Stops all currently importing packages, but will not interrupt any currently running files.
	 * @since 0.0.20-alpha
	 */
	load.abort = function() {
		_importSet = [];
	};
	
	/** Checks if the specified package is imported.
	 * @param {string} name The package name to check.
	 * @return {boolean} Whether the package is imported.
	 * @since 0.0.20-alpha
	 */
	load.isImported = function(name) {
		if(name in _names && _names[name][1] >= STATE_RAN) {
			return true;
		}
		
		return false;
	};
	
	/** Submits a work order which will run on the next worker that becomes available.
	 * 
	 * The worker is the name of a package; this package must return a function which takes the "order" as input, and 
	 *  returns the output in the form of a [object, properties to transfer] pair. This function will be run on a web
	 *  worker and will be separate to the main page.
	 * 
	 * If `submitWorkOrder` is called from a worker, it just does it synchronously, rather than deferring it to another
	 *  thread.
	 * 
	 * @param {string} worker The name of the worker package to do the work.
	 * @param {*} order The data to send to this worker package's function.
	 * @param {?array} copy An optional array of objects to transfer, rather than copy.
	 * @return {Promise(*)} A promise that resolves to the output of the work order.
	 * @since 0.0.21-alpha
	 */
	load.submitWorkOrder = function(worker, order, transfer) {
		if(load.worker) {
			return new Promise(function(f, r) {
				load.import(worker).then(function(pack) {
					var data = pack(order);
					f(data[0]);
				});
			});
		}else{
			return new Promise(function(f, r) {
				_workOrders.push([_workCounter++, worker, order, transfer]);
				_workPromises.set(_workCounter-1, f);
			});
		}
	};
	
	/** Returns an array of errors; each element is a pair `[error object, errorEvent]`. `errorEvent` is an event object
	 *  from the `onError` handler.
	 * @return {array} All uncaught errors that have happened.
	 * @since 0.0.21-alpha
	 */
	load.getErrors = function() {
		return _uncaughtErrors;
	};
	
	/** An error raised if there is dependancy problems.
	 * @param {string} message The message that this error should display.
	 * @since 0.0.21-alpha
	 * @constructor
	 * @extends Error
	 */
	load.DependencyError = function(message) {
		this.message = message;
		this.name = "DependencyError";
	};
	load.DependencyError.prototype = Object.create(Error.prototype);
	
	/** An error raised if there is a problem importing a package (such as it not being found).
	 * @param {string} message The message that this error should display.
	 * @since 0.0.21-alpha
	 * @constructor
	 * @extends Error
	 */
	load.ImportError = function(message) {
		this.message = message;
		this.name = "ImportError";
	};
	load.ImportError.prototype = Object.create(Error.prototype);
	
	/** Returns the total size of files that are being downloaded, if the deps file has this information.
	 * @return {integer} The total download remaining, in kilobytes.
	 * @private
	 * @since 0.0.20-alpha
	 */
	var _getBytes = function() {
		var seen = [];
		var sum = 0;
		for(var i = _importSet.length-1; i >= 0; i --) {
			if(_names[_importSet[i]].length > 3
			&& seen.indexOf(_names[_importSet[i]][0]) === -1) {
				sum += _names[_importSet[i]][3];
				seen[seen.length] = _names[_importSet[i]][0];
			}
		};
		return ~~(sum/1024);
	};
	
	self.addEventListener("error", function(e) {
		if(!e.error) return;
		_uncaughtErrors.push([e.error, e]);
		load.abort();
	});
	
	return load;
})(self);

load.addDependency("", ["load"], [], 0);
load.provide("load", load);
