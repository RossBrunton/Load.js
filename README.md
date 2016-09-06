## Load.js ##
Load.js is a library that allows browser based JavaScript files to automatically download other JS files and resources.

### Structure ###
Your code is broken down into `packages`. Multiple packages can be stored in the same file, but a package can only be in
one file. These packages also have dependencies, either to other code packages, resources, or external libraries.

The script `tools/generateDeps.py` then reads the code, searching for the functions that create these packages. This
information is stored in a so called `deps.json` file (although it can have any name), which Load.js uses to import
those packages.

### Requirements ###
ES6 promises in the browser (which you can pollyfil) should be the only requirement, however the Python scripts have not
been tested on anything except Linux.

### Example ###
index.html:
```html
<!DOCTYPE html>
<html>
    <head>
        <script src='Load.js'></script>
        <script>
            window.onload = function() {
                load.lie("deps.json", "printer");
            }
        </script>
    </head>
    <body></body>
</html>
```

printer.js:
```javascript
"use strict";

load.provide("printer", function(self) {
    var message = load.require("message");
    
    console.log(message);
    
    return {};
});
```

message.js:
```javascript
"use strict";

load.provide("message", function(self) {
    return "Hello world!";
});
```

The `deps.json` file is generated as follows:
```bash
tools/generateDeps.py . > deps.json
```

### Other Package Types ###
There are two other package types that can be used:
- Resources: These are simply text files, requiring a package (via `load.requireResource("/path/to/file.txt")`) of this
 type gets you a string with its content, rather than trying to execute it as JS.
- External libraries: These are scripts that are not neatly divided into packages (their loss), they are included via
 `load.requireExternal(name, url, deps)`, which returns nothing. The arguments are as follows:
  - `name`: A string package name, for example `"jquery"`. Two packages (external or not) with the same name are the same
package.
  - `url`: The path to the library, this will be put into a script tag before the package containing the call is
imported.
  - `deps`: An array of package names to act as the dependencies of this external library. These can be the names of
other external resources.

### Tools ###

#### generateDeps.py ####
```bash
generateDeps.py path [rel] [obj] [indent]
```
This generates the deps.json file and writes it to stdout, with the following options:
- `path`: The path to (recursivley) generate dependancies for.
- `rel`: The paths output will be relative to this directory, set it to the location deps.json is being written to.
- `obj`: Will be merged with the root json object, copying over any properties it has.
- `indent`: If this is set to an integer, pretty printing will be enabled, with an indent of that many spaces.

#### catter.py ####
```bash
catter.py deps.json pack
```
This takes a deps.json and a package name, and outputs (to stdout) a JS file with all the packages in it, set up so
that nothing else needs to be downloaded. This file automatically imports and executes the specified package, and does
not require any other libraries (besides Promise).

Load.js's package (`load`) must be in the deps file.

#### load.py ####
An internal library which contains LoadState, a port of load.js. Instead of adding files to the head of a HTML page,
this object calls functions on a given LoadHandler object. This is what powers `catter.py`.

### Links ###
- [GitHub](https://github.com/RossBrunton/Load.js)
- [Docs](http://docs.bruntonross.co.uk/Load.js/)
