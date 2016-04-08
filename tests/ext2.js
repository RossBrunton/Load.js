"use strict";

load.provide("test.ext2", function() {
    var b = load.require("test.b");
    var res = load.requireResource("./message.txt");
    var jquery = load.requireExternal("https://code.jquery.com/jquery-2.2.3.min.js");
    var lodash = load.requireExternal("https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.9.0/lodash.js", ["https://code.jquery.com/jquery-2.2.3.min.js"]);
    
    console.log("External resource, $ is "+$+", _ is "+_);
    
    return $;
});
