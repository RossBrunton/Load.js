"use strict";

// Depedency loop

load.provide("test.l3", function() {
    return new Promise(function(fulfill, reject) {
        load.require(">test.l1", function(p) {fulfill("l3")});
        console.log("l3 imported");
    });
});
