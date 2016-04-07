"use strict";

// Really basic test file

load.provide("test.a", function() {
    console.log("A imported and ran");
    
    return "a";
});
