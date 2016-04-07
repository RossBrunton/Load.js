"use strict";

// Depedency loop

load.provide("test.l3", function() {
    load.require("test.l1");
    console.log("l3 imported");
    
    return "l3";
});
