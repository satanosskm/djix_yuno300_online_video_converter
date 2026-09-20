#!/usr/bin/env bash
# Rebuilds the Yuno 300 WebAssembly engine exactly as the shipped one was built.
# Usage: ./build.sh <workdir>   (workdir must be an absolute path, ~10 GB free)
set -e
W="$(cd "$1" && pwd)"
E="$(cd "$(dirname "$0")" && pwd)"   # this script's folder (engine/)
EMS="$W/emsdk"
[ -d "$EMS" ] || { echo "git clone https://github.com/emscripten-core/emsdk $EMS"; exit 1; }

# ── 1. Emscripten 3.1.50 ──────────────────────────────────────────────────────
cd "$EMS" && ./emsdk install 3.1.50 && ./emsdk activate 3.1.50 && source emsdk_env.sh

# ── 2. xvidcore 1.3.7 (GPL encoder) ──────────────────────────────────────────
cd "$W"
[ -d xvidsrc ] || { mkdir xvidsrc && cd xvidsrc \
  && wget https://downloads.xvid.com/downloads/xvidcore-1.3.7.tar.gz && tar xf xvidcore-1.3.7.tar.gz; }
cd "$W/xvidsrc/xvidcore/build/generic"
[ -f Makefile ] || ./configure
make -j"$(nproc)"
cp "$W/xvidsrc/xvidcore/build/generic/=build/libxvidcore.a" "$W/libxvidcore.a"

# ── 3. FFmpeg 5.1.4 + Yuno patches ───────────────────────────────────────────
cd "$W"
[ -d ffmpeg-5.1.4 ] || {
  wget https://ffmpeg.org/releases/ffmpeg-5.1.4.tar.xz && tar xf ffmpeg-5.1.4.tar.xz
  cd ffmpeg-5.1.4 && patch -p1 < "$E/patches/ffmpeg-5.1.4-yuno300.patch" && cd "$W"
}

# ── 4. Configure (see engine/BUILD.md for the flag rationale) ────────────────
cd "$W/ffmpeg-5.1.4"
emmake ./configure \
  --target-os=none --arch=x86_32 --disable-everything \
  --enable-gpl --enable-libxvid \
  --extra-cflags="-I$W/xvidsrc/xvidcore/src" \
  --disable-asm --disable-x86asm --disable-inline-asm \
  --disable-network --disable-autodetect --disable-iconv \
  --disable-pthreads --disable-w32threads \
  --disable-ffprobe --disable-ffplay --disable-doc --disable-debug --disable-hwaccels \
  --enable-swscale --enable-protocol=file \
  --enable-demuxer=mov,matroska,avi,asf,flv,mpegts,mp3,wav,ogg,aac,flac,m4v,h264,hevc,mpegvideo \
  --enable-muxer=avi,asf \
  --enable-decoder=h264,hevc,mpeg4,mpeg1video,mpeg2video,h263,vp8,vp9,aac,mp3,flac,opus,vorbis,theora,ac3,eac3,mjpeg,png,rawvideo,wmv1,wmv2,wmv3,vc1,msmpeg4v2,msmpeg4v3 \
  --enable-decoder=pcm_u8,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s32le,pcm_f32le,pcm_alaw,pcm_mulaw \
  --enable-encoder=libxvid,mpeg4,mp2,wmv2,wmav2 \
  --enable-parser=h264,hevc,mpeg4video,aac,mp3,vorbis,opus,vp8,vp9,flac,mjpeg,mpegvideo,ac3,vc1 \
  --enable-filter=scale,pad,transpose,crop,format,aformat,null,anull,aresample,fps,setpts,setsar,rotate,hflip,vflip,volume \
  --extra-ldflags="-L$W -lxvidcore -lworkerfs.js -sMODULARIZE -sEXPORT_NAME=createFFmpegCore \
    -sEXPORTED_FUNCTIONS=[_main,_malloc,_free] -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
    -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 -sENVIRONMENT=web,worker,node \
    -sSTACK_SIZE=4194304 -sINITIAL_MEMORY=33554432 \
    --pre-js=$E/pre.js --post-js=$E/glue.js"

# ── 5. Adjust the Emscripten flags configure got wrong ───────────────────────
# EXIT_RUNTIME must stay 0 (the module survives between runs); longjmp needs
# SUPPORT_LONGJMP=wasm; ASSERTIONS/TABLE_GROWTH help catch regressions.
sed -i 's/-sEXIT_RUNTIME=1/-sEXIT_RUNTIME=0/g' ffbuild/config.mak
sed -i 's/^LDFLAGS=/LDFLAGS=+ASSERTIONS=2 -sALLOW_TABLE_GROWTH=1 -sSUPPORT_LONGJMP=wasm /' ffbuild/config.mak
sed -i 's/^CFLAGS=/CFLAGS=-g2 /' ffbuild/config.mak

# ── 6. Recompile the two patched fftools objects with SUPPORT_LONGJMP ────────
# (mixing longjmp modes at link time fails with "undefined symbol: emscripten_longjmp")
EMCC_CFLAGS="" emcc -c -I. -I./ -D_ISOC11_SOURCE -D_FILE_OFFSET_BITS=64 -D_LARGEFILE_SOURCE \
  -D_POSIX_C_SOURCE=200112 -D_XOPEN_SOURCE=600 -DPIC -DZLIB_CONST -DHAVE_AV_CONFIG_H \
  -std=gnu11 -Os -g2 -sSUPPORT_LONGJMP=wasm \
  fftools/ffmpeg.c -o fftools/ffmpeg.o
emcc -c -I. -I./ -D_ISOC11_SOURCE -D_FILE_OFFSET_BITS=64 -D_LARGEFILE_SOURCE \
  -D_POSIX_C_SOURCE=200112 -D_XOPEN_SOURCE=600 -DPIC -DZLIB_CONST -DHAVE_AV_CONFIG_H \
  -std=gnu11 -Os -g2 -sSUPPORT_LONGJMP=wasm \
  fftools/cmdutils.c -o fftools/cmdutils.o

# ── 7. Link (STRIP=true: stripping a wasm with host strip fails) ─────────────
emmake make -j"$(nproc)" STRIP=true

echo "── done ──"
ls -la ffmpeg_g ffmpeg_g.wasm
echo "Deploy into vendor/core/: see engine/BUILD.md"
