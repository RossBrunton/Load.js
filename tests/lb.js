"use strict";

// Depedency loop

load.provide("test.lb", function() {
    return new Promise(function(fulfill, reject) {
        load.require(">test.la", function(p) {fulfill("lb,"+p)});
        console.log("lb imported");
    });
});
