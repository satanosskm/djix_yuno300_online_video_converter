# Engine build instructions (FFmpeg 5.1.4 → WebAssembly)

This folder contains everything needed to rebuild the bundled engine
`vendor/core/ffmpeg-core.{js,wasm}` from source, as required by the
GNU GPL (the engine is compiled with Xvid enabled, which makes this
build GPL-2.0-or-later).

## Contents

| File | Role |
|---|---|
| `patches/ffmpeg-5.1.4-yuno300.patch` | The only modifications made to the FFmpeg 5.1.4 sources (2 files: `fftools/ffmpeg.c`, `fftools/cmdutils.c`). They add: a `setjmp`/`longjmp` guard so the wasm module can run many conversions in a row, a line-buffered log bridge to JavaScript (`Module.logger`), and global-counter resets in `ffmpeg_cleanup()`. |
| `pre.js` | Small Emscripten pre-js: resolves the `.wasm` location through `Module.mainScriptUrlOrBlob` (contract used by the ffmpeg.wasm 0.12 wrapper). |
| `glue.js` | Emscripten post-js: exposes `exec()`, `setLogger()`, `setProgress()`, `reset()`, `writeFile/readFile/deleteFile/renameFile` — the API the app drives the engine with. |
| `build.sh` | The whole build, scripted exactly as performed. |

## Prerequisites

- [Emscripten SDK](https://github.com/emscripten-core/emsdk) — **version 3.1.50**
- [xvidcore 1.3.7](https://labs.xvid.com/source/) sources
- [FFmpeg 5.1.4](https://ffmpeg.org/releases/ffmpeg-5.1.4.tar.xz) sources
- ~20 GB disk, several minutes of build time

## The three modifications, in short

1. **Re-entrancy** — `exit_program()` in `cmdutils.c` cannot call `exit()`
   inside a wasm module (it would kill the whole JavaScript VM). It now
   `longjmp()`s back to a guard at the top of `main()` (ffmpeg.c).
2. **Clean re-runs** — `ffmpeg_cleanup()` (ffmpeg.c) resets the global
   `nb_input_files / nb_output_files / nb_input_streams / nb_output_streams /
   nb_filtergraphs` counters and `ffmpeg_exited`, otherwise the second
   conversion in the same instance traps ("table index out of bounds").
3. **Complete log lines** — `yuno_log()` (ffmpeg.c) replaces the default
   callback: fragments from `av_log_format_line()` are buffered and only
   complete lines are forwarded to `Module.logger` (the app parses these
   lines to display media info and progress).

## Build

```bash
./build.sh /absolute/path/to/workdir
```

Then deploy:

```bash
cp $W/ffmpeg-5.1.4/ffmpeg_g        vendor/core/ffmpeg-core.js
cp $W/ffmpeg-5.1.4/ffmpeg_g.wasm   vendor/core/ffmpeg-core.wasm
gzip -9 -kf -c vendor/core/ffmpeg-core.wasm > vendor/core/ffmpeg-core.wasm.gz
```
