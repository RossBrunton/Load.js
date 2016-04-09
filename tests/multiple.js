"use strict";

//  Multiple packages in same file

load.provide("test.multiple1", function() {
    load.require("test.l2");
    
    console.log("multiple1 ran");
    
    return "multiple1";
});

load.provide("test.multiple2", function() {
    load.require("test.c");
    
    console.log("multiple2 ran");
    
    return "multiple2";
});
