/*
 * Emscripten pre-js: runs before the module is initialised.
 *
 * Use this file to inject small JavaScript helpers or to set default
 * module properties that must be present before the WASM binary loads.
 */

// Ensure the module object exists even if the consumer does not provide one.
if (typeof Module === 'undefined') {
  var Module = {};
}

// Suppress verbose Ghostscript bbox logs (%BoundingBox, %HiResBoundingBox)
if (typeof Module.print === 'undefined') {
  Module.print = function(msg) {
    if (typeof msg === 'string' && msg.charAt(0) === '%') return;
    if (typeof console !== 'undefined' && console.log) console.log(msg);
  };
} else {
  var _origPrint = Module.print;
  Module.print = function(msg) {
    if (typeof msg === 'string' && msg.charAt(0) === '%') return;
    return _origPrint(msg);
  };
}

// Allow the host page or worker to set the locateFile callback to resolve
// the .wasm path relative to the worker/script location.
if (typeof Module.locateFile === 'undefined') {
  Module.locateFile = function(filename) {
    if (typeof __dirname !== 'undefined') {
      return __dirname + '/' + filename;
    }
    return filename;
  };
}
