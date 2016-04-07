"use strict";

// Depends on b

load.provide("test.b", function() {
    var a = load.require("test.a");
    
    console.log("B imported and ran, a is "+a);
    
    return "b";
});
