"use strict";

// Target for testing whether sealing works

load.provide("test.sealTest", function() {
    var target = load.require("test.sealTarget");
    
    try {
        target.myprop = 1;
        
        throw new Error("target not sealed correctly!");
    } catch(e) {
        return true;
    }
    
    try {
        target.sub.myprop = 1;
        
        throw new Error("target.sub not sealed correctly!");
    } catch(e) {
        return true;
    }
    
    return false;
});
