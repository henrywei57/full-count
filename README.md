# Full Count

A broadcast-style 3D baseball game that runs in the browser. Zone hitting with a PCI, meter pitching, real ball-flight physics, user-controlled fielding and baserunning, and online 1v1 against a friend.

**Play it:** https://henrywei57.github.io/full-count/

Teams, players and sponsors are fictional.

## Modes

- **Play Ball** – exhibition game (3, 6 or 9 innings) as the home or away team.
- **Player Lock** – pick one player. You only bat, pitch, field and run as him; the rest of the game sims quickly until you're involved. Played in first person by default (fielding, running, and from the dugout rail); at-bats use the strike-zone view. Set Your Role to Bat only to sim all of your fielding, or press Tab to skip any single at-bat.
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
| ABS challenge | C | Y (right after the call) |
| Look around (first person) | Mouse (click to grab it), right-click or T to re-center | Right stick, R3 |
| Throw where you look (first person) | Space or click while holding the ball | RT |
| Switch first person / broadcast (Player Lock) | V | |
| Skip this at-bat (Player Lock) | Tab or the Skip button | Back |
| Replay, skip, pause | R, Enter, Esc | Back, A, Start |

The AI moves your fielder until you touch the controls. Any ball that comes inside the gold ring (7.5 ft) around your fielder is yours. In first person, W runs wherever you're looking. A live mini diamond shows where every runner, fielder and the ball are.

## Umpires

- **Human ump** – right on about 92% of called pitches; misses cluster on the edges of the zone.
- **ABS challenge** – the same human ump, plus MLB's 2026 challenge system: each team gets 2 challenges, kept when the call is overturned. Press `C` right after a called ball or strike. In Player Lock only the batter, pitcher or catcher can challenge.
- **Robot ABS** – every ball and strike is called exactly.

## Online play notes

The host runs the game and streams it to the guest over a peer-to-peer WebRTC connection (matchmaking via the free PeerJS cloud server). Each player's swing and pitch timing is measured on their own device, so lag doesn't cost a hitter. Some strict corporate or school networks block peer-to-peer connections; a home or mobile connection usually works.

## Development

The game is plain JavaScript with [three.js](https://threejs.org) loaded from a CDN; there is no install step.

- Source lives in `src/` (`page.html` plus numbered JS modules).
- `./build.sh` concatenates them into a single `index.html`, which is what GitHub Pages serves. Edit `src/`, not `index.html`.
- To run locally, serve the folder (for example `python3 -m http.server`) and open it in a browser.
