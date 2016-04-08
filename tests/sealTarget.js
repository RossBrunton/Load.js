"use strict";

// Target for testing whether sealing works

load.provide("test.sealTarget", function() {
    return {
        sub:{}
    };
}, {"alsoSeal":["sub"]});
