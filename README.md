# Full Count

A broadcast-style 3D baseball game that runs in the browser. Zone hitting with a PCI, meter pitching, real ball-flight physics, user-controlled fielding and baserunning, and online 1v1 against a friend.

**Play it:** https://henrywei57.github.io/full-count/

Teams, players and sponsors are fictional.

## Modes

- **Play Ball** – exhibition game (3, 6 or 9 innings) as the home or away team.
- **Player Lock** – pick one player. You only bat, pitch, field and run as him; the rest of the game sims quickly until you're involved.
- **Online 1v1** – one player hosts and gets a 5-character room code (or invite link); the other joins with it. Works across devices and networks.
- **Home Run Derby** – 10 outs, every non-homer swing is an out.
- **CPU vs CPU** – watch a full simulated game (press `F` to fast-forward).

## Controls

| | Keyboard / mouse | Gamepad |
|---|---|---|
| Move PCI / aim pitch | Mouse (or WASD) | Left stick |
| Normal / power / contact swing | Click or Space / Right-click or L / J | A / X / B |
| Bunt | B | Y |
| Pick pitch | 1–5 | LB / RB |
| Pitch meter | Click 3×: start, power at the top, stop on the gold line | A |
| Move fielder | WASD | Left stick |
| Dive / switch fielder | Space / Q | RB / LB |
| Throw to 1B, 2B, 3B, home | → ↑ ← ↓ (or 1–4) | B, Y, X, A |
| Advance / send back runners | E / Q | RB / LB |
| Replay, skip, pause | R, Enter, Esc | Back, A, Start |

The AI moves your fielder until you touch the controls, and catches are automatic once you're in reach.

## Online play notes

The host runs the game and streams it to the guest over a peer-to-peer WebRTC connection (matchmaking via the free PeerJS cloud server). Each player's swing and pitch timing is measured on their own device, so lag doesn't cost a hitter. Some strict corporate or school networks block peer-to-peer connections; a home or mobile connection usually works.

## Development

The game is plain JavaScript with [three.js](https://threejs.org) loaded from a CDN; there is no install step.

- Source lives in `src/` (`page.html` plus numbered JS modules).
- `./build.sh` concatenates them into a single `index.html`, which is what GitHub Pages serves. Edit `src/`, not `index.html`.
- To run locally, serve the folder (for example `python3 -m http.server`) and open it in a browser.
