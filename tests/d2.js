"use strict";

// Problems with defered deps

load.provide("test.d2", function() {
    return new Promise(function(fulfill, reject) {
        load.require(">test.d3", function(p) {fulfill("d3")});
        console.log("d3 imported");
    });
});
