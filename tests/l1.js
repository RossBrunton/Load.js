"use strict";

// Depedency loop

load.provide("test.l1", function() {
    load.require("test.l2");
    console.log("l1 imported");
    
    return "l1";
});
