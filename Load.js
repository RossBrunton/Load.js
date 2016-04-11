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
	 * Each key is an import name, and the value is an object with the following properties:
	 *  file: Filename that provides the file 
	 *  state: A state value, as shown below
	 *  deps: An array of all the dependancies of the namespace
	 * 	size: The size of the file
	 *  obj: The type dependant thing that is being provided
	 *  type: The type of the package, see below
	 *  evalOnImport: For script packages only, run as soon as imported
	 * 
	 * Possible values for the state are either 0 (not imported), 
	 *  1 (currently in the proccess of importing) or 2 (successfully imported and ran).
	 * @type object
	 * @private
	 * @since 0.0.12-alpha
	 */
	var _packs = {};
	
	var STATE_NONE = 0;
	var STATE_SEEN = 1;
	var STATE_IMPORTING = 2;
	var STATE_IMPORTED = 3;
	var STATE_RUNNING = 4;
	var STATE_RAN = 5;
	
	/** A package of this type is executable code
	 * 
	 * It is in a file which contains a call to "load.provide" with a package name and function. The function will be
	 * called when the package is required (not when it is provided), and the return value of that function will be the
	 * package's object.
	 * 
	 * The package's object will be the function itself before it is evaluated. Whether or not it is the function is
	 *  given by the state; if it is imported, it will be the function, if it is ran, it will be the object.
	 */
	var TYPE_PACK = 0;
	/** A package of this type is a string
	 * 
	 * It is in a file, which is downloaded via AJAX. The package object is a string with the contents of this file.
	 */
	var TYPE_RES = 1;
	/** External resource file
	 * 
	 * That is, a library file that is not managed using the ``load.js`` system. It will be downloaded when required,
	 *  and as soon as the script is executed (via the ``load`` event) it will be marked as provided, and start
	 *  downloading anything that depends on it.
	 */
	var TYPE_EXT = 2;
	
	var USE_THREADING = false;
	
	/** The functions that will be called after the given package is evaluated.
	 * @type object
	 * @private
	 * @since 0.0.21-alpha
	 */
	var _readies = {};
	
	/** The functions that will be called after the given package is downoladed.
	 * @type object
	 * @private
	 * @since 0.0.21-alpha
	 */
	var _onImport = {};
	
	var _currentEval = null;
	
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
	
	/** If true, all messages will be supressed
	 * @type boolean
	 * @private
	 * @default false
	 */
	var _noisy = false;
	
	/** Helper function for network requests
	 * 
	 * @param {string} url The url to get
	 * @param {string="json"} type The responseType value
	 * @return {Promise(*, *)} A promise that resolves to the result of that XHR request.
	 */
	var _xhrGet = function(url, type) {
		return new Promise(function(fulfill, reject) {
			var xhr = new XMLHttpRequest();
		
			xhr.onreadystatechange = function() {
				if(xhr.readyState == 4 && xhr.status > 100 && xhr.status < 400) {
					fulfill(xhr.response);
				}else if(xhr.readyState == 4) {
					reject(xhr);
				}
			}
			
			xhr.open("GET", url, true);
			xhr.responseType = type?type:"json";
			xhr.send();
		});
	};
	
	/** Helper function for firing the various listener things
	 * 
	 * Basically, given an object, key and argument, calls all the functions in the array specified by the key (if it
	 *  exists) with the argument. It then sets that array to empty.
	 * 
	 * @param {object} listener The object with the listeners in it.
	 * @param {string} name The property of that object to call the listeners for.
	 * @param {*} arg The argument to call them with.
	 */
	var _fireListeners = function(listener, name, arg) {
		if(name in listener) {
			for(var i = 0; i < listener[name].length; i ++) {
				listener[name][i](_packs[name].obj);
			}
			
			listener[name] = [];
		}
	};
	
	/** Prints the message to console.log in gray
	 * 
	 * @param {string} message The message to log
	 */
	var _log = function(message) {
		if(!_noisy) console.log("%c"+message, "color:#999999");
	}
	
	
	
	// ----
	// Multithreading
	// ----
	
	// Set up multithreading
	load.worker = !("document" in self) && !("window" in self);
	
	if(load.worker) {
		// A worker
		
		self.onmessage = function(e) {
			if(e.data[0] == "_load_packss") {
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
	
	
	// ----
	// Providing Packages
	// ----
	
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
		_log("Provided: "+name);
		
		if(!options) options = {};
		
		//Set object and imported
		if(name in _packs) {
			_packs[name].obj = [pack, options];
			if(_packs[name].state == STATE_IMPORTING) {
				_packs[name].state = STATE_IMPORTED;
			}else{
				_packs[name].state = STATE_SEEN;
			}
		}else{
			_packs[name] = {file:"about:blank", state:STATE_SEEN, deps:[], size:0, obj:[pack, options], type:TYPE_PACK};
		}
		
		if(_packs[name].state == STATE_SEEN) return;
		
		//Fire all the onImport handlers
		_fireListeners(_onImport, name, true);
		
		// Evaluate if we need to
		if(_packs[name].evalOnImport) {
			load.evaluate(name);
		}
		
		// And try to import more if possible
		_tryImport();
	};
	
	load.provideResource = function(name, data) {
		_log("Provided resource: "+name);
		
		//Set object and imported
		if(name in _packs) {
			_packs[name].obj = data;
			_packs[name].state = STATE_RAN;
		}else{
			_packs[name] = {file:"about:blank", state:STATE_RAN, deps:[], size:0, obj:data, type:TYPE_RES};
		}
		
		//Fire all the onImport handlers
		_fireListeners(_onImport, name, true);
		
		load.evaluate(name);
		
		// And try to import more if possible
		_tryImport();
	};
	
	load.provideExternal = function(name, script) {
		_log("Provided external library: "+name);
		
		//Set object and imported
		if(name in _packs) {
			_packs[name].obj = script;
			if(_packs[name].state == STATE_IMPORTING) {
				_packs[name].state = STATE_IMPORTED;
			}else{
				_packs[name].state = STATE_SEEN;
			}
		}else{
			_packs[name] = {file:"about:blank", state:STATE_SEEN, deps:[], size:0, obj:script, type:TYPE_EXT};
		}
		
		//Fire all the onImport handlers
		_fireListeners(_onImport, name, true);
		
		load.evaluate(name);
		
		// And try to import more if possible
		_tryImport();
	};
	
	
	
	// ----
	// Requiring Packages
	// ----
	
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
		var defer = name.charAt(0) == ">";
		if(name.charAt(0) == ">") name = name.substring(1);
		
		if(onReady) {
			if(name in _packs && _packs[name].state >= STATE_RAN) {
				onReady(load.require(name));
			}else{
				if(!(name in _readies)) _readies[name] = [];
				_readies[name].push(onReady);
			}
		}
		
		if(name in _packs && !defer) {
			return load.evaluate(name);
		}else if(name in _packs) {
			_packs[name].evalOnImport = true;
		}
	};
	
	/** Marks the current file as requiring the specified resource as a dependency.
	 * 
	 * @param {string} name The path to the file to add.
	 */
	load.requireResource = function(name) {
		return load.require(name);
	};
	
	/** Marks the current file as requiring the specified external script as a dependency.
	 * 
	 * @param {string} name The package name for this library.
	 * @param {string} name The path to the library to add.
	 * @param {?array<string>} deps An array of dependencies of this library.
	 */
	load.requireExternal = function(name, path, deps) {
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
	
	
	
	// ----
	// Running package Contents
	// ----
	
	/** For code packages, this actually runs the code contained in their function, as if they were required by another
	 * package.
	 * 
	 * If it is already evaluated, it is not evaluated again.
	 * 
	 * @param {string} pack The package name.
	 * @return {*} The package's value.
	 */
	load.evaluate = function(name) {
		if(_packs[name].state == STATE_RUNNING) return;
		
		if(_packs[name].state == STATE_IMPORTED && _packs[name].type == TYPE_PACK) {
			var _oldCur = _currentEval;
			_currentEval = name;
			_packs[name].state = STATE_RUNNING;
			
			var funct = _packs[name].obj[0];
			var options = _packs[name].obj[1];
			var pack = _packs[name].obj = funct(self);
			
			
			//Seal objects
			if(pack && (!("noSeal" in options) || !options.noSeal)) {
				Object.seal(pack);
				if(typeof pack == "object" && "prototype" in pack) {
					Object.seal(pack.prototype);
				}
				
				if("alsoSeal" in options) {
					options.alsoSeal.forEach(function(v) {
						Object.seal(pack[v]);
						if("prototype" in pack[v]) Object.seal(pack[v].prototype);
					});
				}
			}
			
			// Cleanup
			_packs[name].state = STATE_RAN;
			_currentEval = _oldCur;
		}
		
		//Fire all the functions
		_fireListeners(_readies, name, _packs[name].obj);
		
		return _packs[name].obj;
	};
	
	
	
	// ----
	// Importing Packages
	// ----
	
	/** Imports a package and returns it.
	 * 
	 * The package must have been previously registered using `addDependency` or `loadDeps`.
	 * 
	 * The namespace will NOT be immediately available after this function call unless it has already been imported
	 *  (in which case the call does not import anything else).
	 * @param {string} name The package to import, as a string name.
	 * @return {promise(*)} A promise that fulfills to true when the package is imported
	 * @since 0.0.15-alpha
	 */
	load.import = function(name) {
		return new Promise(function(fulfill, reject) {
			if(!load.isImported(name)) {
				var oldname = name;
				if(name.charAt(0) == ">") name = name.substring(1);
				
				if(!(name in _onImport)) _onImport[name] = [];
				_onImport[name].push(fulfill);
				
				_addToImportSet(oldname);
				_tryImport();
			}else{
				if(name.charAt(0) == ">") name = name.substring(1);
				
				return fulfill(true);
			}
		});
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
		if(!(pack in _packs)) {
			throw new load.DependencyError(pack + " required but not found.");
			return;
		}
		if(_packs[pack].state >= STATE_IMPORTING) return;
		
		_importSet.push(pack);
		var p = _packs[pack];
		
		for(var i = 0; i < p.deps.length; i ++) {
			if(p.deps[i].charAt(0) == ">") {
				_addToImportSet(p.deps[i].substring(1));
			}else{
				_addToImportSet(p.deps[i]);
			}
		}
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
			var now = _packs[_importSet[i]];
			var nowName = _importSet[i];
			
			var okay = true;
			for(var d = 0; d < now.deps.length; d ++) {
				if(now.deps[d].charAt(0) == ">") {
					//Okay
				}else if(!(now.deps[d] in _packs)) {
					console.warn(now.file + " depends on "+now.deps[d]+", which is not available.");
					okay = false;
					break;
				}else if(_packs[now.deps[d]].state < STATE_IMPORTED) {
					// Check if they are from the same file
					if(_packs[now.deps[d]].file != now.file) {
						okay = false;
						if(trace)
							_log(
								nowName + " ("+now.file+")"
								+" depends on "
								+now.deps[d] + " ("+_packs[now.deps[d]].file+")"
							);
						break;
					}
				}
			}
			
			if(okay) {
				if(now.state <= STATE_SEEN) _packagesToImport.push(_importSet[i]);
				_importSet.splice(i, 1);
				i --;
			}
		}
		
		//And then import them all
		if(_packagesToImport.length) _log("Importing: "+_packagesToImport.join(", "));
		
		for(var i = _packagesToImport.length-1; i >= 0; i --) {
			_doImportFile(_packs[_packagesToImport[i]].file, _packs[_packagesToImport[i]].type, _packagesToImport[i]);
		}
		
		// Check for problems
		// This can trigger while something is being downloaded, and other things are running
		/*if(!_packagesToImport.length && _importSet.length && !trace) {
			console.log("Dependency problem!");
			console.log("This means you likely have a dependency loop somewhere.");
			_tryImport(true);
		}*/
	}
	
	/** Adds the file to the HTML documents head in a script tag, actually importing the file.
	 * @param {string} file The file to add. If it starts with "@" that character is stripped.
	 * @param {int} type The type of the file; is it a resource (TYPE_RES) or package (TYPE_PACK).
	 * @param {string} name The name of the package.
	 * @private
	 * @since 0.0.21-alpha
	 */
	var _doImportFile = function(file, type, pack) {
		var f = _files[file];
		
		switch(type) {
			case TYPE_PACK:
				if(_packs[pack].state == STATE_SEEN) {
					_packs[pack].state = STATE_IMPORTING;
					
					load.provide(pack, _packs[pack].obj[0], _packs[pack].obj[1]);
					
					break;
				}
				
				if(!(file in _files)) {
					_files[file] = [[], [], false];
				}
				
				if(f[2]) return;
				f[2] = true;
				
				for(var i = 0; i < f[0].length; i ++) {
					_packs[f[0][i]].state = STATE_IMPORTING;
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
				break;
			
			case TYPE_RES:
				for(var i = 0; i < f[0].length; i ++) {
					_packs[f[0][i]].state = STATE_IMPORTING;
				}
				
				_xhrGet(file, "text").then(function(content) {
					load.provideResource(pack, content);
					
					_tryImport();
				}, function() {
					console.error("Error getting resource "+file+", "+xhr.statusText);
				});
				break;
			
			case TYPE_EXT:
				if(_packs[pack].state == STATE_SEEN) {
					_packs[pack].state = STATE_IMPORTING;
					
					var js = document.createElement("script");
					js.innerHTML = _packs[pack].obj;
					document.head.appendChild(js);
					
					load.provideExternal(pack);
					
					break;
				}
				
				if(f[2]) return;
				f[2] = true;
				
				for(var i = 0; i < f[0].length; i ++) {
					_packs[f[0][i]].state = STATE_IMPORTING;
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
					js.addEventListener("load", function(e) {
						load.provideExternal(pack);
					});
					document.head.appendChild(js);
				}
				break;
			
			default:
				throw new load.ImportError("Package in "+file+" is of invalid type "+type);
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
		if(name in _packs && _packs[name].state >= STATE_IMPORTED) {
			return true;
		}
		
		return false;
	};
	
	
	
	// ----
	// Working with dependency files
	// ----
	
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
			if(!_packs[provided[i]]
			|| (_packs[provided[i]].state <= STATE_NONE &&
				(!(_packs[provided[i]].file in _files) || provided.length > _files[_packs[provided[i]].file][0].length))
			){
				_packs[provided[i]] = {file:file, state:STATE_NONE, deps:required, size:size, obj:undefined, type:type};
			}
		}
		
		// Add them to the workers as well
		if(!this.worker) {
			for(var w of _workers) {
				w.postMessage(["_load_packss", Array.prototype.slice.call(arguments)]);
			}
		}
		
		_files[file] = [provided, required, false];
	};
	
	/** todo: Write me
	 */
	load.loadDepsObject = function(data, absolutePath) {
		var pfunct = function(fulfill, reject) {
			if(typeof(data) == "string") data = JSON.parse(data);
			
			if(Array.isArray(data)) {
				//Convert into new format
				data = {"version":0, "packages":data};
			}
			
			var deps = data.packages;
			for(var i = deps.length-1; i >= 0; i--) {
				var now = deps[i]
				
				if(deps[i][0].indexOf(":") === -1 && deps[i][0][0] != "/") deps[i][0] = absolutePath+deps[i][0];
				
				var dlist = now[2];
				load.addDependency(now[0], now[1], dlist, now[3], now[4]);
			}
			
			if("dependencies" in data) {
				return Promise.all(data.dependencies.map(function(e) {
					return load.loadDeps(e);
				})).then(fulfill.bind(undefined, data));
			}else{
				fulfill(data);
			}
		};
		
		return new Promise(pfunct);
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
	load.loadDeps = function(path, callback, errorCallback) {
		if(path in _depFiles) return Promise.resolve(_depFiles[path]);
		
		_log("Downloading dependency file: "+path);
		
		// Get paths
		var relativePath = "./";
		if(path.indexOf("/") !== -1) {
			relativePath = path.split("/").slice(0, -1).join("/")+"/";
		}
		
		// Hack to get the absolute path
		var a = document.createElement("a");
		a.href = relativePath;
		var absolutePath = a.href;
		
		var pfunct = function(fullfill, reject) {
			var union = function(data) {
				if(callback) callback(data);
				if(fullfill) fullfill(data);
			}
			
			var unione = function(data) {
				if(errorCallback) errorCallback(data);
				if(reject) reject(data);
			}
			
			_xhrGet(path).then(function(data) {
				load.loadDepsObject(data, absolutePath).then(function(o) {
					_depFiles[path] = o;
					union(o);
				}, function(e) {unione(e);});
			}, function() {
				console.error("Error getting import file, "+xhr.statusText);
				unione(xhr);
			});
		}
		
		return new Promise(pfunct);
	};
	
	load.alsoDepends = function(pack, extraDeps) {
		_packs[pack].deps = _packs[pack].deps.concat(extraDeps);
	};
	
	
	// ----
	// Error Handling
	// ----
	
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
	
	self.addEventListener("error", function(e) {
		if(!e.error) return;
		_uncaughtErrors.push([e.error, e]);
		load.abort();
	});
	
	
	
	// ----
	// Bells and Whistles
	// ----
	/** Returns the total size of files that are being downloaded, if the deps file has this information.
	 * @return {integer} The total download remaining, in bytes.
	 * @since 0.0.20-alpha
	 */
	load.getBytes = function() {
		var seen = [];
		var sum = 0;
		for(var i = _importSet.length-1; i >= 0; i --) {
			sum += _packs[_importSet[i]].size;
		};
		return sum;
	};
	
	
	// ----
	// Shortcut Functions
	// ----
	
	/** Invokes the debugger (via the `debugger` operator)
	 * 
	 * To get access to the local closure.
	 */
	load.debug = function() {
		debugger;
	};
	
	/** Imports all packages, useful for debugging or something.
	 * @since 0.0.15-alpha
	 */
	load.importAll = function() {
		for(var f in _packs) {
			load.import(f);
		}
	};
	
	/** Imports all packages that match a given regular expression.
	 * @since 0.0.21-alpha
	 */
	load.importMatch = function(patt) {
		for(var f in _packs) {
			if(patt.test(f))
				load.import(f);
		}
	};
	
	/** Imports and evaluates the given package.
	 * 
	 * Sugar for load.import(pack).then(function() {load.evaluate(pack);})
	 * 
	 * @param {string} pack The package to import and then run.
	 * @return {Promise(*)} A promise that resolves with the package.
	 */
	load.importAndEvaluate = function(pack) {
		return load.import(pack).then(function() {
			return load.evaluate(pack);
		});
	};
	
	/** Downloads the dependency file, then imports and evaluates the given package.
	 * 
	 * Sugar for load.loadDeps(list).then(function() {load.importAndEvaluate(pack);}).
	 * 
	 * Stands for "load-import-evaluate"
	 * 
	 * @param {string} list The package list to import.
	 * @param {string} pack The package to import and then run.
	 * @return {Promise(*)} A promise that resolves with the package.
	 */
	load.lie = function(list, pack) {
		return load.loadDeps(list).then(function() {return load.importAndEvaluate(pack);});
	};
	
	return load;
})(self);

load.provide("load", function(self) {return load;});
