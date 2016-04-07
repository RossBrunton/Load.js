"use strict";

// Depedency loop

load.provide("test.l3", function() {
    load.require(">test.l1", function(p) {debugger;console.log("Defer, got "+p)});
    console.log("l3 imported");
    
    return "l3";
});
