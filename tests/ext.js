"use strict";

load.provide("test.ext", function() {
    var b = load.require("test.b");
    var res = load.requireResource("./message.txt");
    var jquery = load.requireExternal("https://code.jquery.com/jquery-2.2.3.min.js");
    
    console.log("External resource, $ is "+$);
    
    return $;
});
