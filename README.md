# Full Count

A broadcast-style 3D baseball game that runs in the browser. Zone hitting with a PCI, meter pitching, real ball-flight physics, user-controlled fielding and baserunning, and online 1v1 against a friend.

**Play it:** https://henrywei57.github.io/full-count/

All 30 MLB clubs with their real current rosters. Every player's ratings come from his real numbers (see [Real teams and players](#real-teams-and-players)). The ballpark sponsors are made up.

*Unofficial fan project, free and non-commercial. Not affiliated with or endorsed by Major League Baseball, the MLB Players Association, or any club. Team and player names belong to their owners. Stats come from the MLB Stats API and Baseball Savant.*

## Modes

- **Tutorial** – five short hands-on lessons: hitting, pitching, fielding, baserunning and pickoffs. Each step asks you to do the thing (make contact, throw a strike, make a throw, call a steal) and moves on once you have. Play them all in order or pick one; skip any step.
- **Play Ball** – exhibition game (3, 6 or 9 innings) as the home or away team.
- **Player Lock** – pick one player. You only play when he's involved: at bat, on base, or when the ball is hit to the outfield or his way. Everything else is skipped behind a SIMULATING card (set Not Involved to Watch to see it fast-forwarded instead). Fielding and baserunning use a third-person camera behind your player, like Road to the Show: it faces home plate before the pitch, then follows the ball, the base you're running to, or the base you're about to throw to. First person and broadcast cameras are also available, and V cycles between them. At-bats use the strike-zone view. Set Your Role to Bat only to sim all of your fielding, or press Tab to skip any single at-bat.
- **Online 1v1** – one player hosts and gets a 5-character room code (or invite link); the other joins with it. Each player picks their own team, custom rosters included. Signed in, you can invite a friend straight from your friends list. Works across devices and networks.
- **Practice** – endless drills with your team against any opponent:
  - **Batting**: live pitching, as many at-bats as you want, with contact rate, hits and average exit velocity tracked.
  - **Pitching**: work a full lineup; strike %, strikeouts, walks and hits tracked. Your pitcher never tires.
  - **Baserunning**: you start on base while the CPU bats. Steal, take the extra base, or hold.
  - **Fielding**: a ball comes off the bat every few seconds; outs and errors tracked.

  Three outs just clears the bases and keeps going; quit from the pause menu.
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
| Pickoff throw to 1B / 2B / 3B | Shift + 1 / 2 / 3, or the PICKOFF buttons | Hold LT + B / Y / X |
| Steal (before or during the pitch) | E (everyone), hold 1–3 + E for one runner; Q calls it off | RB, hold the D-pad toward his base; LB calls it off |
| Move fielder | WASD | Left stick |
| Dive / switch fielder | Space / Q | RB / LB |
| Throw to 1B, 2B, 3B, home | 1 2 3 4 (or → ↑ ← ↓) | B, Y, X, A |
| Advance / send back all runners | E / Q | RB / LB |
| Run one runner | Hold his base key (1 2 3 4 or arrows) + E / Q, or click ◀ ▶ in the runner panel | Hold the D-pad toward his base + RB / LB |
| ABS challenge | C | Y (right after the call) |
| Swing the camera (Player Lock) | Mouse (click to grab it), right-click or T to re-center | Right stick, R3 |
| Cycle third person / first person / broadcast (Player Lock) | V | |
| Skip this at-bat (Player Lock) | Tab or the Skip button | Back |
| Replay, skip, pause | R, Enter, Esc | Back, A, Start |

The AI moves your fielder until you touch the controls. Any ball that comes inside the gold ring (7.5 ft) around your fielder is yours. In Player Lock, W runs the way the camera faces. When you field the ball, the best throw is ringed in green and the camera turns toward it; press 1–4 to throw. A live mini diamond shows where every runner, fielder and the ball are.

When you're batting, a runner panel lists every runner with where he's headed, and a tag over each runner shows his key. Each E sends a runner one base further; each Q takes a base back (stop at the next bag, then turn around). Runners you don't touch are run by the AI. Only force plays are outs on the bag; everyone else has to be tagged when he gets there.

## Stealing and pickoffs

Call a steal any time before the pitch: the runner breaks on the pitcher's first move. Call it once the pitcher is already delivering and he gets a late jump. If the batter doesn't put the ball in play, the catcher has to throw him out, and it's a tag play at the bag. A strikeout plus a runner thrown out is a double play. If the ball is put in play, the runner already has his jump: a hit-and-run.

Who wins the race comes down to the runner's speed (fast runners also get better jumps), the pitch, and the catcher's arm. Against a typical catcher an average runner makes it a bit more than half the time, a burner almost always, and a slow runner almost never. A runner can't steal a base another runner is standing on unless that runner goes too. CPU teams steal when they have an edge, and with two outs and a full count their forced runners go on the pitch.

When you're pitching with runners on, Shift + 1 / 2 / 3 throws over. The runner dives back and is usually safe, but a runner who was going on that pitch gets caught leaning: he's either picked off or hung up between bases. CPU pitchers throw over too, mostly to fast runners.

## Roster Builder

Build your own team from the **Roster Builder** button on the main menu. Name the club, pick its colors, then set every player's ratings:

- **Hitters**: CON (contact), POW (power), EYE (plate discipline), SPD (speed), ARM and FLD (fielding), plus bats/throws and the batting order.
- **Pitchers** (a starter and three relievers): VELO (fastball mph), CTL (control), STF (stuff, how much the pitches move), STA (stamina), and the pitch mix.

Every rating starts at 40 for free, and you have **3,100 points** to spend on the whole roster. A point costs 1 up to 70, 2 from 70 to 85, and 3 above 85, so stars are expensive. 3,100 is about what the built-in teams are worth. You can start from a blank roster or copy a built-in team. Rosters save automatically on your device, and to your Google account when you're signed in. Custom teams show up in every team picker.

## Friends

Sign in with Google (top right of the main menu) to save rosters to your account and add friends. Everyone gets a 6-character friend code; enter a friend's code under **Friends** to add them. Your friends list shows who's online, and **Invite to 1v1** opens a room and sends them the invite. They get a pop-up with a Join button.

## Batting cameras

Three hitting views modeled on MLB The Show, all centered behind the plate: **Strike Zone** (low and tight, the default), **Strike Zone 2** (a step back, so you see the whole batter) and **Strike Zone High** (raised, looking down on the zone). Pick one in the menu or switch from the pause screen; your choice is saved.

## Umpires

- **Human ump** – right on about 92% of called pitches; misses cluster on the edges of the zone.
- **ABS challenge** – the same human ump, plus MLB's 2026 challenge system: each team gets 2 challenges, kept when the call is overturned. Press `C` right after a called ball or strike. In Player Lock only the batter, pitcher or catcher can challenge.
- **Robot ABS** – every ball and strike is called exactly.

## Online play notes

The host runs the game and streams it to the guest over a peer-to-peer WebRTC connection (matchmaking via the free PeerJS cloud server). To keep the guest's side responsive:

- Snapshots go out 60 times a second on an unreliable, unordered channel, so one lost packet never stalls the rest.
- The guest syncs its clock to the host's and draws every player where he is now, not where he was half a round trip ago.
- The batted ball and throws are simulated on the guest's device from their launch numbers, so the ball always flies smoothly.
- The fielder the guest controls moves on the guest's screen immediately; the host uses the guest's position for him.
- Each player's swing and pitch timing is measured on their own device, so lag doesn't cost a hitter.

The badge next to the pause button shows the round-trip time to your opponent. Some strict corporate or school networks block peer-to-peer connections; a home or mobile connection usually works.

## Turning on Google sign-in

Accounts, cloud rosters and friends run on Firebase, which is free at this size. Until it's set up, the game works the same and rosters stay on the device.

1. Go to the [Firebase console](https://console.firebase.google.com), **Add project**, and create one (Analytics can be off).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**, then save.
3. **Authentication → Settings → Authorized domains → Add domain**: `henrywei57.github.io` (and `localhost` is there already for testing).
4. **Build → Firestore Database → Create database** (production mode, any location). Open the **Rules** tab, paste the contents of `firestore.rules` from this repo, and **Publish**.
5. **Project settings (gear) → Your apps → Web (`</>`)**, register an app, and copy the `firebaseConfig` object it shows.
6. Paste it into `firebase-config.js` in place of `null` (`export default { apiKey: ..., authDomain: ..., projectId: ..., appId: ... };`), commit and push.

The web config is not a secret; Firestore access is controlled by the rules in step 4.

## Real teams and players

`src/12-mlb.js` holds all 30 clubs: each one's nine regulars (one per position plus a DH, the best player who actually plays each spot), its ace, and its top three relievers, with real names, numbers, handedness and batting orders. It's generated by `tools/mlb-import.mjs` from the latest season's stats (blended with the season before, so a hot month doesn't make a superstar):

| Rating | From |
|---|---|
| CON | batting average and strikeout rate |
| POW | isolated power and barrel rate |
| EYE | walk rate and strikeout rate |
| SPD | Statcast sprint speed |
| ARM | Statcast arm strength (catchers: pop time) |
| FLD | outs above average |
| VELO and pitches | each pitcher's real arsenal and average speed per pitch |
| CTL / STF / STA | walk rate / strikeout rate / pitches per outing |

To refresh the rosters (after trades, or when a new season is underway), run `node tools/mlb-import.mjs` (Node 18+), then `./build.sh`, and commit. Pass a year to use a specific season, e.g. `node tools/mlb-import.mjs 2025`. Player models' skin tones aren't matched to the real players.

## Development

The game is plain JavaScript with [three.js](https://threejs.org) loaded from a CDN; there is no install step.

- Source lives in `src/` (`page.html` plus numbered JS modules; `12-mlb.js` is the generated MLB data, `66-roster.js` is the Roster Builder, `67-cloud.js` is sign-in and friends, `68-tutorial.js` is the tutorial).
- `./build.sh` concatenates them into a single `index.html`, which is what GitHub Pages serves. Edit `src/`, not `index.html`.
- To run locally, serve the folder (for example `python3 -m http.server`) and open it in a browser.
