const NULL = 0, SIZE_I32 = Uint32Array.BYTES_PER_ELEMENT;
const DEFAULT_ARGS = ["./ffmpeg", "-nostdin", "-y"];
Module["NULL"] = NULL; Module["SIZE_I32"] = SIZE_I32; Module["DEFAULT_ARGS"] = DEFAULT_ARGS;
Module["ret"] = -1; Module["timeout"] = -1; Module["__dur"] = 0;
var __userLogger = function(){};
Module["logger"] = function(e){
  try {
    var m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec((e && e.message) || "");
    if (m) Module["__dur"] = (+m[1])*3600 + (+m[2])*60 + (+m[3]);
  } catch (x) {}
  __userLogger(e);
};
function stringToPtr(str){ const len = Module["lengthBytesUTF8"](str) + 1; const ptr = Module["_malloc"](len); Module["stringToUTF8"](str, ptr, len); return ptr; }
function stringsToPtr(strs){ const len = strs.length; const ptr = Module["_malloc"](len * SIZE_I32); for (let i = 0; i < len; i++) { Module["setValue"](ptr + SIZE_I32 * i, stringToPtr(strs[i]), "i32"); } return ptr; }
function exec(..._args){
  const args = [...DEFAULT_ARGS, ..._args];
  Module["ret"] = -1;
  const stack = Module["stackSave"]();
  try { Module["ret"] = Module["_main"](args.length, stringsToPtr(args)); }
  catch (e) { if (e && typeof e.status === "number") { Module["ret"] = e.status; } else if (typeof e === "number") { Module["ret"] = e; } else if (!(e && e.message && e.message.startsWith("Aborted"))) { throw e; } }
  finally { Module["stackRestore"](stack); }
  return Module["ret"];
}
function setLogger(l){ __userLogger = l || function(){}; }
function setTimeout(t){ Module["timeout"] = t; }
function setProgress(h){ Module["progress"] = h || function(){}; }
Module["progress"] = function(){};
function receiveProgress(progress, time){
  const d = Module["__dur"] || 0;
  Module["progress"]({ progress: d ? Math.max(0, Math.min(time / d, 1)) : 0, time: time * 1e6 });
}
function reset(){ Module["ret"] = -1; Module["timeout"] = -1; Module["__dur"] = 0; }
Module["exec"] = exec; Module["setLogger"] = setLogger; Module["setTimeout"] = setTimeout;
Module["setProgress"] = setProgress; Module["receiveProgress"] = receiveProgress; Module["reset"] = reset;
Module["writeFile"] = function(p, d){ FS.writeFile(p, d); };
Module["readFile"] = function(p, o){ return FS.readFile(p, o); };
Module["deleteFile"] = function(p){ FS.unlink(p); };
Module["renameFile"] = function(a, b){ FS.rename(a, b); };
Module["setLogging"] = function(){};

