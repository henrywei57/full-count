# Full Count

A broadcast-style 3D baseball game that runs in the browser. Zone hitting with a PCI, meter pitching, real ball-flight physics, user-controlled fielding and baserunning, online 1v1 against a friend, and online squads of up to ten people who each play one player, with text and proximity voice chat.

**Play it:** https://henrywei57.github.io/full-count/

All 30 MLB clubs with their real current rosters. Every player's ratings come from his real numbers (see [Real teams and players](#real-teams-and-players)). The ballpark sponsors are made up.

*Unofficial fan project, free and non-commercial. Not affiliated with or endorsed by Major League Baseball, the MLB Players Association, or any club. Team and player names belong to their owners. Stats come from the MLB Stats API and Baseball Savant.*

## Modes

- **Tutorial** – five short hands-on lessons: hitting, pitching, fielding, baserunning and pickoffs. Each step asks you to do the thing (make contact, throw a strike, make a throw, call a steal) and moves on once you have. Play them all in order or pick one; skip any step.
- **Play Ball** – exhibition game (3, 6 or 9 innings) as the home or away team.
- **Season** – take a real club through a 12, 30, 60 or 162-game schedule, the standings and the playoffs (see [Season](#season)).
- **Player Lock** – pick one player (any spot in your batting order, or your starting pitcher). You only play when he's involved: at bat, on base, or when the ball is hit to the outfield or his way. Everything else is skipped behind a SIMULATING card (set Not Involved to Watch to see it fast-forwarded instead). Fielding and baserunning use a third-person camera behind your player, like Road to the Show: it faces home plate before the pitch, then follows the ball, the base you're running to, or the base you're about to throw to. First person and broadcast cameras are also available, and V cycles between them. At-bats use the strike-zone view. Set Your Role to Bat only to sim all of your fielding, or press Tab to skip any single at-bat.
- **Online** – one player hosts and gets a 5-character room code (or invite link); friends join with it. Signed in, you can invite friends straight from your friends list. Works across devices and networks. Two ways to play:
  - **1v1**: you against one friend, each with your own team, custom rosters included.
  - **Squad**: you and up to nine friends, each playing one player (see [Online squad](#online-squad)).
- **Practice** – endless drills with your team against any opponent:
  - **Batting**: live pitching, as many at-bats as you want, with contact rate, hits and average exit velocity tracked.
  - **Pitching**: work a full lineup; strike %, strikeouts, walks and hits tracked. Your pitcher never tires.
  - **Baserunning**: you start on base while the CPU bats. Steal, take the extra base, or hold.
  - **Fielding**: a ball comes off the bat every few seconds; outs and errors tracked.

  Three outs just clears the bases and keeps going; quit from the pause menu.
- **Home Run Derby** – you bat with your team's lineup (pick the batter under **BATTER**) against batting practice from the away club's pitchers. You get 10 outs: a swing that misses, and any ball put in play that isn't a home run, uses one up. Taking a pitch is free. The round ends with a tally of your home runs and your longest.
- **CPU vs CPU** – watch a full simulated game. Press `F` for triple speed, and again to slow back down.

## Setup options

The setup panel on the main menu changes with the mode. This is every option and where it applies:

| Option | Choices | Applies to |
|---|---|---|
| Lessons | All, in order; Hitting; Pitching; Fielding; Baserunning; Pickoffs | Tutorial |
| Drill | Batting; Pitching; Baserunning; Fielding | Practice |
| Play | 1v1 or Squad | Online |
| Nobody in the play | Skip ahead; Watch (fast); Real time | Online squad |
| You play as | Away or Home | Play Ball, Player Lock, Online 1v1 |
| Season | 12, 30, 60 or 162 games | Season setup |
| Innings | 3, 6 or 9 | Play Ball, Season, Player Lock, Online, CPU vs CPU |
| Hitting | Rookie, Veteran, All-Star, Hall of Fame | all except CPU vs CPU and Tutorial |
| Pitching | Rookie, Veteran, All-Star, Hall of Fame | all except CPU vs CPU, Derby and Tutorial |
| Umpire | Human ump (92%), ABS challenge, Robot ABS | all except Derby and Tutorial |
| Ballpark | The home team's park, or any MLB or classic park | all except Tutorial and Season |
| Throws | Manual or Auto | Play Ball, Player Lock, Practice, a new season |
| Your player | Any spot in your batting order, or the starting pitcher | Player Lock |
| Your role | Bat & field, or Bat only (sim fielding) | Player Lock |
| Not involved | Skip ahead, or Watch (fast) | Player Lock |
| Camera | Third person, First person or Broadcast | Player Lock, online squad |
| Batter | Any of your lineup | Home Run Derby |
| Batting cam | Strike Zone, Strike Zone 2 or Strike Zone High | every game (also on the pause menu) |

**Throws**: on Manual, a THROW prompt waits for your base key (1–4) whenever you're holding the ball. On Auto, the CPU makes the throw unless you press a base first. Either way you steer your fielders and dive.

## Online squad

Pick **Online**, set **Play** to **Squad**, and host. Up to nine friends join with the room code, so there can be ten of you in one game.

- **Pick your player.** The host picks both teams. Then everyone clicks a spot: any spot in either batting order (the catcher, the DH, anyone) or either starting pitcher. You can be on the same team as your friends, against them, or a mix (say, three of you on the home team against two on the away team). Click your spot again to give it up. The CPU plays everyone nobody picks and manages both clubs. The host starts once everyone has a spot.
- **Your player only.** Like Player Lock, you bat when he's up, pitch when he's on the mound, field when the ball comes his way and run when he's on base. Everyone does it at the same time on their own device: the shortstop and the center fielder can both be chasing the same ball.
- **Third-person camera, MLB The Show style.** The camera sits behind your player and turns toward the play: home plate before the pitch, then the ball, the base you're running to or the base you're about to throw to. Hitting uses the strike-zone view, pitching the view from behind the mound. V cycles third person, first person and broadcast, and the mouse or right stick swings the camera around.
- **Name tags.** Every player a friend is playing has a tag over his head in that friend's color (YOU over your own), with a speaker icon while they're talking. The mini diamond rings them in the same colors.
- **Nobody in the play.** When none of you is batting, pitching, on base or in the way of the ball, the game skips ahead behind the SIMULATING card. The host can instead have it play fast or in real time (**Nobody in the play**).
- **The CPU manager** goes to the bullpen and makes pinch-hit and pinch-run moves, but never takes out one of you. A pitcher stays in until he's out of gas, and then his player takes over the reliever. A friend who leaves the mound alone for 30 seconds gets a CPU pitch thrown for him. ABS challenges are up to the batter (a called strike) or the pitcher or catcher (a called ball).
- **Dropped connection.** If a friend's connection drops, the CPU plays their man and the game goes on. They reconnect on their own and pick up where they left off. Rematch keeps everyone's spots.

## Chat and voice

Online, in the lobby and during the game (1v1 and squad):

- **Text chat**: press **Y** (or the chat button by pause) and type; Enter sends. In a squad game, Tab switches between **All** and **Team** (just the friends on your side). Lines fade after a few seconds. Spectators can chat too.
- **Voice chat**: press **Join voice chat** in the online panel or the mic button in the game. Your browser asks for the microphone once; without one you can still listen. **G** mutes and unmutes, or with **Push to talk** on (Options) you're live only while you hold G. Voice is a direct call between each pair of players, so it doesn't go through the host. Click someone's mic icon in the room list to mute them just for you.
- **Proximity voice** (squad games): you hear a friend louder the closer his player is to yours. Full volume within about 35 feet, fading out across the field (around 250 feet). Teammates in the dugout together hear each other fine, and the other team's dugout is across the field. Turn it off in Options to hear everyone at full volume.

## Controls

| | Keyboard / mouse | Gamepad |
|---|---|---|
| Move PCI / aim pitch | Mouse (or WASD or the arrow keys) | Left stick |
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
| Run one runner | Click him (on the field, his tag, his dot on the mini diamond, or his row in the runner panel), then E / Q. Click him again for everyone. Holding his base key (1–4) + E / Q works too | Hold the D-pad toward his base + RB / LB |
| Challenge: ABS (a ball/strike call) or replay review (a close play on the bases) | C | Y (right after the call) |
| Team panel: pinch hit, pinch run, defensive subs, bullpen, intentional walk | U, the team button by pause, or the pause menu | |
| Intentional walk (your team in the field, before a pitch) | I | |
| Swing the camera (Player Lock, squad) | Mouse (click to grab it), right-click or T to re-center | Right stick, R3 |
| Cycle third person / first person / broadcast (Player Lock, squad) | V | |
| Chat (online): open, send, everyone / team | Y, Enter, Tab | |
| Voice chat (online): mute, or hold to talk | G | |
| Skip this at-bat (Player Lock) | Tab or the Skip button | Back |
| Replay the last play, skip ahead | R, Enter | Back, A |
| Pause | Esc or P | Start |
| Skip a home run trot | Space or click | A |
| Strike zone overlay on / off | Z | |
| Sound on / off | M | |
| Fast-forward (CPU vs CPU): triple speed, and back | F | |

The AI moves your fielder until you touch the controls. Any ball that comes inside the gold ring (7.5 ft) around your fielder is yours. In Player Lock, W runs the way the camera faces. When you field the ball, the best throw is ringed in green and the camera turns toward it; press 1–4 to throw. A live mini diamond shows where every runner, fielder and the ball are.

When you're batting, a runner panel lists every runner with where he's headed, and a tag floats over each runner. Click a runner to pick him (a blue ring marks him); E and Q then run just him. With nobody picked they run everyone. Each E sends a runner one base further; each Q takes a base back (stop at the next bag, then turn around). Runners you don't touch are run by the AI. Only force plays are outs on the bag; everyone else has to be tagged when he gets there.

After a fielder gloves the ball he gathers into his throw, and your throw comes out as soon as the ball is out of the glove. Throws go to whichever fielder can get to that base first: on the bag if he gets there in time, otherwise out in front of him on his way, and he still has to step on the bag.

Every base is covered for the whole play. When the man covering a bag goes after the ball, takes a throw somewhere else, makes a throw or gets steered away by you, the nearest free fielder takes the bag: the pitcher covers first when the first baseman fields it, the second baseman covers second behind the pivot, the shortstop takes third when the third baseman charges. When you press a base and nobody can beat you to that bag (the first baseman fielding a grounder near first, the shortstop a step from second), you run it there yourself instead of throwing.

Defense comes from the actual player: his glove (FLD) sets how quickly he reads the ball, how far he can reach, how fast he gets it out of his glove and how often he boots it or throws it away; his arm sets how hard he throws; his speed sets his range. A player out of position loses some of each.

On a ball to the outfield the free middle infielder goes out to be the relay man, lined up between the ball and the base it's likely going to. A throw of more than about 225 feet from an outfielder goes to him, and he turns and fires it on to the base you picked. On defense the AI can cut it off and go somewhere else instead.

## On screen

- **Scoreboard** (top left): both clubs' runs, the inning, the runners on the diamond, the count, the outs, and the pitch count of the current pitcher. With ABS on, the dots by each club are its challenges left.
- **Pitch info** (top right): speed and type of the last pitch, for a few seconds.
- **Pitch tracker**: every pitch of the at-bat on a mini strike zone, numbered and colored by result (ball, called strike, swinging strike, foul or in play), with the last five pitches listed below.
- **Name plates**: the batter on the left (his line today and his CON, POW, EYE and SPD). The pitcher on the right (pitches, innings, strikeouts, and his arsenal with speeds). His stamina bar goes from green to gold to red as he tires.
- **Hitting feedback**: after each swing a card shows the timing (PERFECT, GOOD, EARLY, LATE, VERY EARLY, VERY LATE) and the contact (SQUARED UP, SOLID, DECENT, WEAK, TIPPED). Once the ball is in play it adds exit velocity, launch angle and distance.
- **Calls and banners**: a big call on each pitch (BALL 2, STRIKE, SWINGING STRIKE, FOUL BALL and so on), and banners for the big moments (HOME RUN, DOUBLE PLAY, PITCHING CHANGE and more).
- **Captions**: the play-by-play shows along the bottom, and is read aloud when the commentary voice is on.
- **Hint line**: under the scoreboard, it tells you what to press right now.
- **Break card**: between the halves, with the linescore and who leads.
- **Replay**: press R after a play to watch it again from a camera that follows the ball. Enter or a click stops it.
- **ABS card**: when a ball or strike is challenged, the pitch is shown on the zone with the result, and the card says whether the call stands or is overturned.
- **Pause menu** (Esc or P, or Start): resume, controls, options, commentary voice on or off, strike zone on or off, batting cam, the team panel, the box score, and quit to the menu. Quitting an online 1v1 ends it for both of you. In a squad, if a friend quits, the CPU plays their player; if the host leaves, the game ends for everyone.
- **Sound**: crowd and hit sounds, and commentary. `M` mutes everything, and the sound drops out while the SIMULATING card is up.

## Bench and bullpen

Every club carries a 5-man rotation, a 7-man bullpen (closer first) and a 4-man bench, all real players. Press **U** (or the team button next to pause) between pitches to open the Team panel:

- **Pinch hit** for the batter before his first pitch.
- **Pinch run** for anyone on base.
- **Replace** any player in the field with a bench player. Someone playing a position he doesn't play loses some arm and glove there.
- **Bring in** a reliever. Each one shows his stamina and pitches, and your starter's fatigue shows at the top.

A player who comes out can't go back in. CPU managers go to the bullpen when their pitcher tires (the closer for a save chance, the best arms late and close), pinch-hit for weak bats late in close games, and pinch-run for slow runners in scoring position. Online, each player manages his own team.

## Stealing and pickoffs

Call a steal any time before the pitch: the runner breaks on the pitcher's first move. Call it once the pitcher is already delivering and he gets a late jump. If the batter doesn't put the ball in play, the catcher has to throw him out, and it's a tag play at the bag. A strikeout plus a runner thrown out is a double play. If the ball is put in play, the runner already has his jump: a hit-and-run.

Who wins the race comes down to the runner's speed (fast runners also get better jumps), the pitch, and the catcher's arm. Against a typical catcher an average runner makes it a bit more than half the time, a burner almost always, and a slow runner almost never. A runner can't steal a base another runner is standing on unless that runner goes too. CPU teams steal when they have an edge, and with two outs and a full count their forced runners go on the pitch.

When you're pitching with runners on, Shift + 1 / 2 / 3 throws over. The runner dives back and is usually safe, but a runner who was going on that pitch gets caught leaning: he's either picked off or hung up between bases. CPU pitchers throw over too, mostly to fast runners.

## Season

Pick **Season** on the main menu, choose your club and a length (12, 30, 60 or the full 162), and play a schedule of three-game series against the other 29 real clubs. Everyone plays every day, and every team runs a five-man rotation, so you face whoever's turn it is.

- **Play next game** plays it out like any other game, in the home team's park, with that day's starters. **Sim game**, **Sim 7 days** and **Sim to the playoffs** let the computer play it for you. The panel shows your next opponent, the park and both starting pitchers. Once you're out, **Sim the postseason** plays out the playoffs.
- Every other game in the league is played out by a quick plate-appearance sim: each batter against each pitcher from their ratings and the park, with pitching changes, steals, double plays and sac flies. Across a season it lands on big-league rates (about a .245 average, 22% strikeouts, 3% homers and 4 to 4.5 runs a team).
- **Standings** by division (W, L, PCT, GB, runs, last 10, streak), **league leaders** (AVG, HR, RBI, OPS, SB, W, RA9, K, SV, WHIP) from every game in the league, and **your games**, each with its box score.
- **Playoffs**, MLB style: six teams a league (three division winners and three wild cards), a wild-card round, the Division Series, the Championship Series and the World Series. A short season gets shorter series. If your club misses out, sim ahead to see who wins it all.
- A season uses each club's current roster. The classic decade teams and custom rosters aren't in it.
- The season saves after every game, on this device and to your Google account. A season game you quit partway through resumes where you left it. **Standings, leaders & schedule** opens the hub from the season panel, and **Abandon season** ends it (click twice). Once it's over, the same button reads **Start a new season**.

## Box scores, saved games and stats

- **Box score**: from the pause menu during a game, or the final screen. The final screen also has the linescore, the player of the game (the best hitter or pitcher on the winning side), and buttons to play again, open the box score or go to the main menu. Every batter (subs indented) with AB, R, H, RBI, BB and K, then doubles, triples, homers and steals, and every pitcher with IP, H, R, BB, K, HR and pitch count, plus the win, loss and save.
- **Saved games**: Play Ball and Player Lock games save themselves before every batter. Quit whenever you like (or close the tab) and press **Resume** on the main menu to pick up with the same batter, score, lineups, bullpen and pitch counts. Starting another game replaces the save, and **Discard** on the main menu deletes it.
- **Stats**: every finished game (Play Ball, Player Lock, Online 1v1 and squad, and Season, including the league games you simmed) is kept with its box score. Practice and CPU vs CPU games aren't kept. **Stats** on the main menu is about you, game by game:
  - **You**: your record, your hitting (AVG, HR, RBI, OBP, SLG, OPS) and your pitching (ERA, strikeouts, WHIP, W-L-SV) across your games, filtered by mode, and your game history with how you hit and pitched in each one. In Player Lock it's just your player.
  - **Head to head**: every opponent you've played online, with your record against them, your AVG, HR and ERA against them and theirs against you. Click one for every game you've played each other.
  - **All games**: every game in your records, newest first, with the date, final score, park, mode, your result and a box score button. Season games you simmed are marked (sim).
  - **Hitters** and **Pitchers**: every MLB player's totals, sortable by any column. Choose **All your games** (including the simmed season games) or **Only games you played in**.
  ERA counts earned runs only: runs that score on an error or a passed ball, or by a runner who got on by an error, are unearned (box scores show both R and ER). Signed in with Google, your games are saved to your account and come with you to any device. (If you set up Firebase before this version, publish the updated `firestore.rules` so the account can store games.)

## Classic teams

Every club also has a team for each decade from the 1960s to the 2010s: the 1970s Dodgers (Garvey, Cey, Lopes, Russell, Sutton), the Big Red Machine, the 1990s Braves rotation, the Montreal Expos, the Washington Senators. Pick one with the era menu under any team in the matchup; the arrows then go club to club in that decade. 158 decade teams in all (a club that barely existed in a decade, like the 1977 Blue Jays, doesn't get one).

A decade team is the franchise's best players of those ten years, with their numbers for that club: the regular at each position, a DH, a bench, five starters and a bullpen. Ratings are against the league of that decade, on the same scale as today's players, so a .290 hitter in the low-scoring 1960s rates higher than one in the 1990s. There are no radar guns or Statcast that far back, so fastball speed is estimated from strikeouts and the era (the 1960s ran a couple of mph slower than today), and speed comes from steals and triples. They play in their ballpark of the time: Crosley Field, Forbes Field, Connie Mack Stadium, the Astrodome, Shea, Three Rivers, the Vet, Candlestick, Riverfront, Tiger Stadium, old Comiskey, the Kingdome, the Metrodome, Memorial Stadium, Fulton County, County Stadium, Olympic Stadium, Jarry Park and more (all pickable from the Ballpark menu, approximate dimensions). Built by `tools/classic-import.mjs` from the MLB Stats API.

## Ballparks

Games are played in the home team's real ballpark: all 30 MLB parks, with their wall distances down each line, in the alleys and to center, and their wall heights. Pick any park from the **Ballpark** menu instead. (The dimensions are close approximations.)

- **Fenway Park**: the 37-foot Green Monster in left (Monster seats on top), Pesky's short porch in right.
- **Yankee Stadium**: the short porch in right; **Oracle Park**: the 24-foot brick wall in right and deep Triples Alley.
- **PNC Park**: the 21-foot Clemente Wall; **Daikin Park**: the Crawford Boxes in left; **Target Field**, **Camden Yards** and **Angel Stadium**: tall walls in right.
- **Coors Field**: deep fences, but the ball carries in the thin air (about 7% farther), and breaking balls break a little less. Chase Field and Truist Park get a touch of that too.

Balls hit the wall or clear it according to its height where they get there, outfielders play deeper in big parks and shallower in small ones, and the distance markers, foul poles and outfield seats follow the park. Custom teams play at Full Count Park unless you pick another one. Online, the host's pick is used.

## More rules

- **Wild pitches and passed balls.** A pitch in the dirt or far off the plate can get past the catcher, more often with a weak glove behind the plate, and now and then he just misses one. The ball rolls toward the backstop, the catcher chases it, the pitcher covers home, and the runners can go (they have a secondary lead). On defense you can steer the catcher and throw like any other play.
- **Dropped third strike.** If strike three gets away and first base is open, or there are two outs, the batter can run for first. It still counts as a strikeout.
- **Intentional walks.** No pitches: press **I** (or use the Team panel) and the batter takes first. CPU managers put a dangerous hitter on late in close games when first base is open, a runner is in scoring position and a much weaker hitter is up next.
- **Replay review.** The base umpires call the bang-bang plays at the bags, and they miss a few of the closest. After a close play, the team the call went against can challenge it: press **C** while the prompt is up (Enter plays on). The play is shown again from a camera on that bag, then the call stands or is overturned, and the outs, runners and runs are fixed to match. Each team gets one challenge a game and keeps it when the call is overturned. CPU managers challenge most missed calls. In Player Lock, your manager decides.
- **Extra innings.** A tie after the last inning goes on, and the batter who batted last in the inning before starts on second base.
- **Infield in.** With a runner on third, fewer than two outs, in the last two innings and the game within a run, the infielders play in.
- **Scoring plays.** Double plays, fielder's choices, sacrifice flies, ground-rule doubles and inside-the-park home runs are all scored as such. A batter hit by a pitch takes first.
- **Walk-off.** When the home team takes the lead in the bottom of the last inning, the game ends right there.

## Options

**Options** (main menu, or the pause menu) is saved on this device:

- **Sound**: game sound and commentary volume sliders, and the play-by-play voice on or off.
- **Colorblind-friendly colors**: pitch types, and balls and strikes on the pitch tracker, switch to colors that stay distinct with red-green colorblindness.
- **Strike zone overlay**: draws the strike zone over the plate (`Z`, or the pause menu).
- **Hitting guide**: on Rookie and Veteran, a ring shows where the pitch will cross once it's part-way in. The fly-ball landing spot shows on every level except Hall of Fame. One checkbox turns both off.
- **Online voice chat**: voice volume, push to talk and proximity voice (see [Chat and voice](#chat-and-voice)).
- **Keys**: give any keyboard control a different key. Your key does everything the default one did (Space is the swing, the pitch meter and the dive), and the hints on screen show your keys. Reset puts them all back.

**Difficulty** has four levels (Rookie, Veteran, All-Star and Hall of Fame), set separately for hitting and for pitching. For hitting, they change pitch speed, the PCI size, the timing windows, swing assist and the CPU pitcher's control. Rookie is the most forgiving (the biggest PCI, the most swing assist, the widest timing windows) and Hall of Fame the least (the smallest PCI, no swing assist, the tightest timing). For pitching, they change the meter (Rookie's is slowest, Hall of Fame's fastest), how well CPU hitters make contact, and how well they lay off bad pitches.

## Roster Builder

Build your own team out of real MLB players from the **Roster Builder** button on the main menu. Start from any club's roster, then sign whoever you want for each spot: nine hitters (one per position plus a DH) in your batting order, up to four bench players, a rotation of up to five starters and a bullpen of up to seven. Name the team and pick its colors. Release a bench player or pitcher (&times;) to free up points.

**Change** next to a player opens the signing list for that spot: every MLB player who plays there, with his real ratings, overall and cost. You can search by name or team, filter by club, and sort by overall, cost or any rating. Tick the box next to up to three players to compare them side by side with whoever has the spot now: every rating as a bar with the best lit up, overall and what each would cost. The player pool is everyone on a 40-man roster who played this season or last: about 530 hitters and 660 pitchers. Hitters are rated at each position they actually play; anyone can DH, and a player moved somewhere he doesn't play loses some arm and glove there.

Every player costs points from his ratings: a point a step above 40, two above 70 and three above 85, so stars are expensive. The whole roster has to fit under the cap, which is what the priciest real club costs. Any real team fits, and beating it means choosing where to spend. Online, a roster over the cap can't be used. Rosters save automatically on your device, and to your Google account when you're signed in. They pick up the latest real ratings whenever the player data is refreshed. Custom teams show up in every team picker.

## Friends

Sign in with Google (top right of the main menu) to save rosters to your account and add friends. Everyone gets a 6-character friend code; enter a friend's code under **Friends** to add them. Your friends list shows who's online, and **Invite to play** opens a room (or uses the one you have open) and sends them the invite. They get a pop-up with a Join button.

Requests and invites are listed under **Requests & invites**: **Add back** befriends someone who added you, **Join** takes you to their room, and **Dismiss** clears the entry. **Remove** (click it twice) takes someone off your list. Next to each friend you'll see your record against them. Signed in, your account also keeps your finished games and stats, your season in progress and your head-to-head records. **Sign out** is at the top right of the main menu.

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

The badge next to the pause button shows the round-trip time to your opponent (and how many people are watching). Some strict corporate or school networks block peer-to-peer connections; a home or mobile connection usually works.

- **Join by link**: an invite link opens the game with the room code filled in, ready to join.
- **Rematch**: on the final screen, a rematch starts the same game with the same teams and spots. In a squad, anyone who left is out.
- **Same version**: both players need the same version of the game. If one of you has an older copy cached, joining stops with a message to refresh the page on both devices.
- **Can't connect?** If the room is found but the two devices can't open a connection, the game says so: some school, work and mobile networks block peer-to-peer play. Both on the same Wi-Fi usually works.
- **Reconnecting**: if the connection drops mid-game, the host's game pauses and waits up to 90 seconds while the guest reconnects on its own (for up to a minute), then picks up exactly where it was. Only the same player can take the spot back. Quitting on purpose ends the game for both of you right away.
- **Spectators**: anyone with the room code can press **Watch** instead of Join and see the game live, from the broadcast camera (up to six at a time). Spectators can come and go at any point, even mid-game.
- **Head to head**: when you're both signed in with Google, your record against each other is kept. It shows in the lobby when you connect, on the final screen, and next to each friend on your friends list. (Squad games are kept as **Online Squad** in your stats, with just your player's numbers.)
- **Squads**: the host sends fewer snapshots to each friend the more friends there are (about 30 a second with four or more), and each guest fills in the frames in between.

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

`src/12-mlb.js` holds the player pool (everyone on a 40-man roster who played) and all 30 clubs: each one's nine regulars (one per position plus a DH, the best player who actually plays each spot) in batting order, a four-man bench, a five-man rotation and a seven-man bullpen, with real names, numbers and handedness. It's generated by `tools/mlb-import.mjs` from the latest season's stats (blended with the season before, so a hot month doesn't make a superstar):

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

- Source lives in `src/` (`page.html` plus numbered JS modules; `12-mlb.js` is the generated MLB data, `64-squad.js` is the online squad, `65-net.js` the online play, `65-talk.js` chat and voice, `66-roster.js` is the Roster Builder, `67-cloud.js` is sign-in and friends, `68-tutorial.js` is the tutorial).
- `./build.sh` concatenates them into a single `index.html`, which is what GitHub Pages serves. Edit `src/`, not `index.html`.
- To run locally, serve the folder (for example `python3 -m http.server`) and open it in a browser.
