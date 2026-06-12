# PadelButton 🎾

A mobile-first **Progressive Web App** for tracking padel scores court-side.
Large, readable scoreboard, dark by default, works offline, with **Web
Bluetooth** support for physical scoring buttons and **audio announcements**
after every point.

## Features

- **Standard padel/tennis scoring** — 0 / 15 / 30 / 40 / deuce / advantage / game.
- **Games & sets** — best of 1, 3 or 5 sets, with optional 6–6 tiebreak.
- **Golden point or traditional advantage** — configurable.
- **Two big team buttons** to add points by tapping (simulating the BLE buttons).
- **Undo** the last point and **Reset** the match.
- **Web Bluetooth** — *Connect Device* scans for a BLE peripheral named
  `PadelButton`; characteristic notifications register a point for the bound team.
- **Audio announcements** via the Web Speech API, with a pluggable
  "announcement pack" interface for adding pre-recorded packs later.
- **Installable PWA** — manifest, service worker, icons, offline-first.

## Project structure

```
index.html              # single-page UI (scoreboard + settings)
manifest.json           # PWA manifest
service-worker.js       # offline cache
css/styles.css          # dark, large-text, mobile-first styling
js/
  score.js              # PadelMatch — pure scoring engine (no DOM)
  bluetooth.js          # PadelBluetooth — Web Bluetooth, multi-device ready
  audio.js              # Announcer + announcement packs (TTS today)
  app.js                # wires engine + BLE + audio to the UI
icons/
  icon.svg              # scalable PWA / maskable icon
tools/
  test_score.js         # node tests for the scoring engine
```

## Running

It's static — serve the folder over HTTP(S) and open on a phone:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

> **Web Bluetooth** requires a secure context (HTTPS, or `localhost`) and a
> supporting browser (Chrome/Edge on Android or desktop). The on-screen team
> buttons work everywhere and double as the simulated Bluetooth buttons.

**Desktop test shortcuts:** `A` = point Team A, `L` = point Team B, `Z` = undo.

## Bluetooth firmware notes

`js/bluetooth.js` targets a device advertising the name `PadelButton`. Set the
real GATT UUIDs at the top of the file:

```js
const BUTTON_SERVICE = "0000ffe0-0000-1000-8000-00805f9b34fb";
const BUTTON_CHAR    = "0000ffe1-0000-1000-8000-00805f9b34fb";
```

The manager keeps **one device slot per team**, so adding the opposing team's
button later is just a second `bt.connect(1)` — no UI changes required. If the
custom service isn't found, it falls back to the first notifiable
characteristic so the scaffold is testable against generic dev boards.

## Adding an announcement pack

Register any object implementing the pack interface (see `js/audio.js`):

```js
announcer.register({
  id: "stadium",
  name: "Stadium voice",
  async ready() { /* preload audio files */ },
  speak(text) { /* play matching clip */ },
  cancel() { /* stop playback */ }
});
```

## Tests

```bash
node tools/test_score.js
```
