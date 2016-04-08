"use strict";

// Depedency loop

load.provide("test.la", function() {
    var lb = load.require("test.lb");
    console.log("la imported");
    
    return "la,"+lb;
});
