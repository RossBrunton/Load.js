"use strict";

// Depedency loop

load.provide("test.l2", function() {
    load.require("test.l3");
    console.log("l2 imported");
    
    return "l2";
});
