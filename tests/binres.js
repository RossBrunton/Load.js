"use strict";

// Binary resources

load.provide("test.binres", function() {
    var img = load.requireBinaryResource("Image.png");
    var msg = load.requireBinaryResource("message.txt");
    console.log("binres imported, image is %o, message is %o", img);
    
    return img;
});
