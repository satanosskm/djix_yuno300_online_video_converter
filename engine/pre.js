// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)
// résolution du .wasm via mainScriptUrlOrBlob (contrat wrapper 0.12)
Module["_yunoLocateFile"] = function(path, prefix){
  const m = Module["mainScriptUrlOrBlob"];
  if (m) {
    try {
      const h = m.slice(m.lastIndexOf('#') + 1);
      const o = JSON.parse(atob(h));
      if (path.endsWith('.wasm') && o.wasmURL) return o.wasmURL;
      if (path.endsWith('.worker.js') && o.workerURL) return o.workerURL;
    } catch (e) {}
  }
  return (prefix || '') + path;
};
Module["locateFile"] = Module["_yunoLocateFile"];
