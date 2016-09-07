"use strict";

// Problems with defered deps

load.provide("test.d1", function() {
    load.require("test.d2");
    console.log("l1 imported");
    
    return "d1";
});
