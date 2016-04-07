"use strict";

// Depends on b

load.provide("test.c", function() {
    var b = load.require("test.b");
    var res = load.requireResource("./message.txt");
    
    console.log("C imported and ran, b is "+b+" and message is "+res);
    
    return "c";
});
