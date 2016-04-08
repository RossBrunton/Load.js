"use strict";

load.provide("test.ext2", function() {
    var b = load.require("test.b");
    var res = load.requireResource("./message.txt");
    var jquery = load.requireExternal("jquery", "https://code.jquery.com/jquery-2.2.3.min.js");
    var lodash = load.requireExternal("lodash",
        "https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.9.0/lodash.js",
        [
            "jquery"
        ]
    );
    
    console.log("External resource, $ is "+$+", _ is "+_);
    
    return $;
});
