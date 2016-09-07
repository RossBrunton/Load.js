"use strict";

// Problems with defered deps

load.provide("test.d3", function() {
    var d1 = load.require("test.d1");
    console.log("d3 imported");
    
    return d1;
});
