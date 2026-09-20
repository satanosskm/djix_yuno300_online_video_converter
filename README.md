# Online video converter for D-JIX YUNO 3000

Turn your modern videos (MP4, MKV, WebM, HEVC…) into AVI files that play on the **D-JIX YUNO 3000** — right in your browser, with nothing uploaded anywhere.

## How to use

1. **Start the local server** (from this folder):
   ```
   python3 server.py 8080
   ```
2. Open **http://localhost:8080** in a recent Chrome, Edge or Firefox.
3. **Drop your videos** (or click to browse) and hit **▶ Convert all**.
4. **⬇ Download** each `*_yuno300.avi` file, copy them to your player over USB, and enjoy.

That's it — every setting is already tuned for the device, so you don't have to touch anything.

## Settings (optional)

| Setting | What it does |
|---|---|
| **Video quality** | 350 / 500 / 800 kbps — smaller file or sharper picture |
| **Framing** | Black bars (no image loss, default), fill the screen (crops), or stretch |
| **Volume** | Normal, +3/+6/+9 dB or −6 dB |
| **Clip start / max duration** | Convert only a portion of the video |
| **Remove audio** | Produce a silent video |

## Good to know

- **100% private** — the videos never leave your computer. The FFmpeg engine runs locally in WebAssembly; there is no server and no upload.
- **First use** downloads the conversion engine (~31 MB) once; after that it is cached and works offline.
- **Supported inputs**: MP4, M4V, MKV, WebM, MOV, AVI, WMV, FLV, TS/M2TS, MPG, VOB, 3GP… (AV1 decoding is not included — rare for personal use.)
- **File size limit**: about 1.5 GB per source file (32-bit memory limit). Split larger videos first.
- **Output recipe** (validated on a real device): AVI · XviD 800 kbps, all keyframes · 20 fps · MP2 64 kbps, 44.1 kHz stereo · framed for the 220×176 screen.

## Troubleshooting

- **The engine fails to load** — make sure the page is opened through the local server (`http://localhost:8080`), not by double-clicking `index.html`, and that the first engine download finished.
- **A conversion stalls or fails on a huge file** — lower the quality, or split the video (set a max duration) and convert it in parts.
- **Something else?** Open **Technical log (ffmpeg)** at the bottom of the page and copy its content when asking for help.

## Technical specifications

The exact ffmpeg command for each conversion is visible in the app (expand **"ffmpeg command"** under a file). Output settings:

**Video**

| Setting | Value |
|---|---|
| Container | AVI, stream tag `XVID` |
| Codec | MPEG-4 Part 2, Simple Profile — **XviD** encoder (libxvidcore **1.3.7**) inside the bundled **FFmpeg 5.1.4** |
| Bitrate | 350 / 500 / 800 kbps selectable — default **500 kbps** |
| Frame rate | **20 fps** constant |
| GOP | **1** — every frame is a keyframe (best compatibility with the player's decoder) |
| Picture geometry | content scaled to fit the **220×176** screen (5:4) — black bars by default (crop/stretch optional) — then stored **176×220, rotated 90° + mirrored** to match the device's physically rotated screen; the picture displays upright on the player |
| Pixel format | yuv420p |

**Audio**

| Setting | Value |
|---|---|
| Codec | **MP2** (MPEG-1 Audio Layer II) — the codec the device decodes reliably in AVI |
| Bitrate / sampling | **64 kbps CBR · 44,100 Hz · stereo** |
| Volume | optional ± dB |

**Metadata & tracks**

- Title = original file name; every other metadata field and chapters are stripped.
- Sources with several audio tracks: the best one is selected automatically (no `-map` overrides).

---

## Included software & licenses (legal notices)

This repository **bundles a compiled FFmpeg engine** so the app works fully offline and client-side:

| Component | Version | License | Source |
|---|---|---|---|
| FFmpeg (engine, compiled to WebAssembly) | **5.1.4** | LGPL-2.1 — **this build includes GPL components, so the engine is distributed under GPL-2.0-or-later** | <https://ffmpeg.org/releases/ffmpeg-5.1.4.tar.xz> · <https://ffmpeg.org> |
| Xvid (xvidcore, GPL encoder used for the output files) | **1.3.7** | GPL-2.0-or-later | <https://labs.xvid.com/source/> |
| ffmpeg.wasm wrapper (`vendor/ffmpeg/`, JS loader around the engine) | 0.12.x | MIT | <https://github.com/ffmpegwasm/ffmpeg.wasm> |

License texts: [GPL-2.0](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html) · [LGPL-2.1](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.en.html) · [MIT](https://opensource.org/licenses/MIT)

> **GPL compliance note**: the WebAssembly engine in `vendor/core/` is a custom build of FFmpeg 5.1.4
> (Xvid enabled, plus a few small patches). The complete corresponding sources are provided in this
> repository under **`engine/`**: the patch applied to FFmpeg, the JS glue, and the exact build script
> (see `engine/BUILD.md`).

"D-JIX" and "YUNO" are trademarks of Logicom. This project is not affiliated with, endorsed by, or
connected to Logicom in any way.

---


# Convertisseur vidéo en ligne pour D-JIX YUNO 3000

Transformez vos vidéos modernes (MP4, MKV, WebM, HEVC…) en fichiers AVI lisibles sur le **D-JIX YUNO 3000** — directement dans votre navigateur, sans rien envoyer sur Internet.

## Mode d'emploi

1. **Lancez le serveur local** (depuis ce dossier) :
   ```
   python3 server.py 8080
   ```
2. Ouvrez **http://localhost:8080** dans un Chrome, Edge ou Firefox récent.
3. **Déposez vos vidéos** (ou cliquez pour parcourir) puis cliquez sur **▶ Convert all**.
4. **⬇ Download** chaque fichier `*_yuno300.avi`, copiez-les sur le baladeur en USB, et profitez.

C'est tout — chaque réglage est déjà optimisé pour l'appareil, vous n'avez rien à toucher.

## Réglages (facultatifs)

| Réglage | Rôle |
|---|---|
| **Video quality** | 350 / 500 / 800 kbps — fichier plus léger ou image plus fine |
| **Framing** | Bandes noires (aucune perte d'image, par défaut), remplir l'écran (recadre), ou étirer |
| **Volume** | Normal, +3/+6/+9 dB ou −6 dB |
| **Clip start / max duration** | Convertir seulement une portion de la vidéo |
| **Remove audio** | Produire une vidéo muette |

## Bon à savoir

- **100 % privé** — les vidéos ne quittent jamais votre ordinateur. Le moteur FFmpeg tourne en local en WebAssembly ; aucun serveur, aucun upload.
- **Première utilisation** : le moteur de conversion (~31 Mo) se télécharge une seule fois ; ensuite il reste en cache et fonctionne hors ligne.
- **Entrées prises en charge** : MP4, M4V, MKV, WebM, MOV, AVI, WMV, FLV, TS/M2TS, MPG, VOB, 3GP… (le décodage AV1 n'est pas embarqué — rare en usage perso.)
- **Limite de taille** : environ 1,5 Go par fichier source (limite mémoire 32 bits). Découpez les vidéos plus grandes d'abord.
- **Recette de sortie** (validée sur un appareil réel) : AVI · XviD 800 kbps, toutes images clés · 20 i/s · MP2 64 kbps, 44,1 kHz stéréo · cadrage pour l'écran 220×176.

## Dépannage

- **Le moteur ne se charge pas** — assurez-vous que la page est ouverte via le serveur local (`http://localhost:8080`), pas en double-cliquant `index.html`, et que le premier téléchargement du moteur s'est bien terminé.
- **Une conversion bloque ou échoue sur un gros fichier** — baissez la qualité, ou découpez la vidéo (durée max) et convertissez-la en plusieurs fois.
- **Autre souci ?** Ouvrez **Technical log (ffmpeg)** en bas de la page et copiez son contenu lors de votre demande d'aide.

## Spécifications techniques

La commande ffmpeg exacte de chaque conversion est visible dans l'application (dépliez **"ffmpeg command"** sous un fichier). Réglages de sortie :

**Vidéo**

| Réglage | Valeur |
|---|---|
| Conteneur | AVI, tag de flux `XVID` |
| Codec | MPEG-4 Part 2, Simple Profile — encodeur **XviD** (libxvidcore **1.3.7**) dans le **FFmpeg 5.1.4** embarqué |
| Débit | 350 / 500 / 800 kbps au choix — **500 kbps** par défaut |
| Cadence | **20 i/s** constantes |
| GOP | **1** — toutes les images sont des images clés (compatibilité maximale avec le décodeur du baladeur) |
| Géométrie | contenu mis à l'échelle pour l'écran **220×176** (5:4) — bandes noires par défaut (recadrage/étirement optionnels) — puis stocké en **176×220, pivoté 90° + miroir** pour compenser l'écran physiquement tourné de l'appareil ; l'image s'affiche à l'endroit sur le baladeur |
| Format de pixels | yuv420p |

**Audio**

| Réglage | Valeur |
|---|---|
| Codec | **MP2** (MPEG-1 Audio Layer II) — le codec que l'appareil décode de façon fiable en AVI |
| Débit / échantillonnage | **64 kbps CBR · 44 100 Hz · stéréo** |
| Volume | ± dB en option |

**Métadonnées & pistes**

- Titre = nom du fichier d'origine ; toutes les autres métadonnées et les chapitres sont retirés.
- Sources multi-pistes audio : la meilleure est sélectionnée automatiquement (aucun `-map` forcé).

---

## Logiciels inclus & licences (mentions légales)

Ce dépôt **embarque un moteur FFmpeg compilé** pour que l'application fonctionne hors ligne, 100 % côté navigateur :

| Composant | Version | Licence | Source |
|---|---|---|---|
| FFmpeg (moteur, compilé en WebAssembly) | **5.1.4** | LGPL-2.1 — **cette build inclut des composants GPL, le moteur est donc distribué sous GPL-2.0 ou supérieur** | <https://ffmpeg.org/releases/ffmpeg-5.1.4.tar.xz> · <https://ffmpeg.org> |
| Xvid (xvidcore, encodeur GPL utilisé pour les fichiers de sortie) | **1.3.7** | GPL-2.0 ou supérieur | <https://labs.xvid.com/source/> |
| ffmpeg.wasm wrapper (`vendor/ffmpeg/`, chargeur JS autour du moteur) | 0.12.x | MIT | <https://github.com/ffmpegwasm/ffmpeg.wasm> |

Textes des licences : [GPL-2.0](https://www.gnu.org/licenses/old-licenses/gpl-2.0.fr.html) · [LGPL-2.1](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.fr.html) · [MIT](https://opensource.org/licenses/MIT)

> **Note de conformité GPL** : le moteur WebAssembly dans `vendor/core/` est une compilation personnalisée
> de FFmpeg 5.1.4 (Xvid activé, plus quelques petites retouches). Les sources correspondantes complètes sont
> fournies dans ce dépôt sous **`engine/`** : le patch appliqué à FFmpeg, la colle JS et le script de build
> exact (voir `engine/BUILD.md`).

« D-JIX » et « YUNO » sont des marques de Logicom. Ce projet n'est ni affilié à Logicom, ni approuvé ou
lié à elle de quelque manière que ce soit.
