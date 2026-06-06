# Sound Director — Звукорежиссёр

A script-driven **sound cue board** for live theater, built to run on an Android
Samsung phone or tablet as an installable web app (PWA). Tag a play's script with
**start / stop / fade** cues, build a library of mp3/wav backing tracks
(минусовки) and sound effects, then fire them during the show with one big **GO**
button. Optional **voice assist** listens to the Russian dialogue and lights up
GO when it hears the next cue — but you always tap GO yourself.

Built for the Purimshpil, reusable for any play.

---

## Try it now (on this PC)

A local server is already (or can be) running:

```powershell
cd "C:\Users\yuril\Downloads\Automated Script Player"
python -m http.server 8123 --bind 127.0.0.1
```

Open **http://127.0.0.1:8123** in Chrome/Edge. (Must be served over http — opening
`index.html` by double-click will **not** work, because browsers block ES-module
scripts on `file://`.)

---

## How to use

1. **📜 Script** — Import the play (`.docx` or `.txt`) or paste the text. Each line
   becomes tappable.
2. **🎵 Audio** — Add your mp3/wav files (backing tracks + SFX). They're stored on
   the device. Preview, rename, delete. Supported: mp3, wav, m4a, ogg, aac, flac.
3. **🎬 Cues** — Tap a script line (or **+ Add cue**) → choose **START / STOP /
   FADE / STOP ALL**, pick the audio, set volume / fade time / loop. Press
   **✨ Auto-detect cues** to scan the script for likely sound moments
   (фонограмма, песня, музыка обрывается, тишина, …) and pre-create cues you then
   assign audio to.
4. **🎛 Show** — The live board. The next cue is highlighted in the scrolling
   script; the big **GO** fires it and auto-advances. The **NOW PLAYING** rack
   shows every running track with progress + per-track fade/stop, and **◼ STOP
   ALL** fades everything. **Skip ▶ / ◀ Prev** move the playhead without firing.

### Voice assist
Toggle 🎙 in the Show tab. It listens (Russian) and, when it hears the next cue's
trigger phrase, the GO button pulses + the device vibrates — a reminder, never an
automatic trigger. **Requires a microphone permission and an internet connection**
(uses the browser's speech service). The rest of the app works fully offline.

### Don't lose your work
Menu (⋯) → **Export full backup (.zip)** bundles the script, cues **and** all audio
into one file. **Import full backup** restores it — perfect for moving a finished
show from the PC to the Samsung tablet. (Export show .json saves structure only,
without audio.)

---

## Put it on the Samsung phone / tablet (real use)

To get install + offline + microphone on the device, the app must be served over
**HTTPS** (a plain `http://192.168.x.x` LAN address is not a "secure context", so
install/voice won't work there). Easiest free options:

- **Netlify Drop** — go to https://app.netlify.com/drop and drag this whole folder
  in. You get an `https://…netlify.app` URL instantly.
- **GitHub Pages**, **Cloudflare Pages**, or **Vercel** — also free static hosting.

Then on the Samsung, open that URL in Chrome → menu → **Add to Home screen /
Install app**. It now launches full-screen, works offline, and keeps the screen
awake during a show.

> Tip: add your audio and build the cues **on the device** (or use Import full
> backup), since audio is stored per-device in the browser.

---

## Project layout

```
index.html              app shell (tabs: Show / Cues / Audio / Script)
app.css                 dark, big-touch-target styling
manifest.webmanifest    PWA metadata
sw.js                   service worker (offline app shell)
vendor/jszip.min.js     reads .docx and builds .zip backups
icons/                  app icons
js/
  main.js               boot, navigation, menu, install, wake-lock
  store.js              show model (script + cues + audioMeta), persistence, events
  db.js                 IndexedDB (audio blobs + shows)
  audio.js              playback engine: multi-track, gain-node fades
  voice.js              Russian speech recognition (assist only)
  script-import.js      .docx / .txt / paste -> classified lines
  script-view.js        Script tab + auto-detect cues
  library-view.js       Audio tab
  cues-view.js          Cues tab (ordered list, reorder, test)
  cue-editor.js         add/edit cue dialog
  perform-view.js       Show tab: GO logic, playhead, now-playing rack
  show-io.js            export/import (.json structure + .zip full backup)
  text-dialog.js        paste / rename dialog helper
script_extracted.txt    plain-text dump of the Purimshpil script (reference)
```

Data model: a **show** = `{ script[], cues[], audioMeta[] }`. Cues are an ordered
list; each cue has an `action`, optional `audioId`, `volume`, `fadeMs`, `loop`, an
`anchorLine` into the script, and a voice `trigger` phrase. Audio files live as
blobs in IndexedDB keyed by id; `audioMeta` holds their names/durations.

No build step, no framework — plain ES modules, so it's easy to edit and re-host.
