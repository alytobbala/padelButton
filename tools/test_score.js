/* Minimal test harness for the scoring engine (run with: node tools/test_score.js) */
const fs = require("fs");
const path = require("path");

// Load score.js into the global scope (it attaches PadelMatch to `this`).
const code = fs.readFileSync(path.join(__dirname, "..", "js", "score.js"), "utf8");
(0, eval)(code);
const PadelMatch = globalThis.PadelMatch;

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   expected ${e}\n   got      ${a}`); }
}

/* ---- 1. basic point progression ---- */
let m = new PadelMatch({ setsToWin: 1, deuce: "advantage", tiebreak: true });
m.addPoint(0); eq(m.getDisplay().points, ["15", "0"], "15-0");
m.addPoint(0); eq(m.getDisplay().points, ["30", "0"], "30-0");
m.addPoint(1); eq(m.getDisplay().points, ["30", "15"], "30-15");
m.addPoint(0); eq(m.getDisplay().points, ["40", "15"], "40-15");
let r = m.addPoint(0);
eq(r.type, "game", "game won");
eq(m.getDisplay().games, [1, 0], "games 1-0");
eq(m.getDisplay().points, ["0", "0"], "points reset after game");

/* ---- 2. deuce + advantage ---- */
m = new PadelMatch({ setsToWin: 1, deuce: "advantage", tiebreak: true });
for (let i = 0; i < 3; i++) { m.addPoint(0); m.addPoint(1); }
eq(m.getDisplay().points, ["40", "40"], "deuce");
eq(m.getDisplay().isDeuce, true, "isDeuce true");
m.addPoint(0); eq(m.getDisplay().points, ["Ad", "40"], "advantage A");
m.addPoint(1); eq(m.getDisplay().points, ["40", "40"], "back to deuce");
m.addPoint(1); eq(m.getDisplay().points, ["40", "Ad"], "advantage B");
r = m.addPoint(1);
eq(r.type, "game", "B wins after advantage");
eq(m.getDisplay().games, [0, 1], "games 0-1");

/* ---- 3. golden point ---- */
m = new PadelMatch({ setsToWin: 1, deuce: "golden", tiebreak: true });
for (let i = 0; i < 3; i++) { m.addPoint(0); m.addPoint(1); }
eq(m.getDisplay().points, ["40", "40"], "golden 40-40");
r = m.addPoint(0);
eq(r.type, "game", "golden point decides game");
eq(m.getDisplay().games, [1, 0], "games 1-0 golden");

/* ---- 4. winning a set 6-0 ---- */
m = new PadelMatch({ setsToWin: 1, deuce: "golden", tiebreak: true });
function winGame(match, team) { for (let i = 0; i < 4; i++) match.addPoint(team); }
for (let i = 0; i < 5; i++) winGame(m, 0);
eq(m.getDisplay().games, [5, 0], "games 5-0");
r = winGame(m, 0) || m; // last addPoint returned by winGame? recompute
let last;
m = new PadelMatch({ setsToWin: 1, deuce: "golden", tiebreak: true });
for (let i = 0; i < 6; i++) { for (let j = 0; j < 4; j++) last = m.addPoint(0); }
eq(last.type, "match", "match won 6-0 in best-of-1");
eq(m.getDisplay().sets, [1, 0], "sets 1-0");
eq(m.matchOver, true, "match over");

/* ---- 5. tiebreak at 6-6 ---- */
m = new PadelMatch({ setsToWin: 1, deuce: "golden", tiebreak: true });
for (let i = 0; i < 5; i++) winGame(m, 0);     // 5-0
for (let i = 0; i < 5; i++) winGame(m, 1);     // 5-5
winGame(m, 0); winGame(m, 1);                  // 6-6
eq(m.getDisplay().inTiebreak, true, "entered tiebreak at 6-6");
for (let i = 0; i < 6; i++) m.addPoint(0);      // 6-0 in TB
eq(m.getDisplay().points, ["6", "0"], "tiebreak 6-0");
last = m.addPoint(0);                            // 7-0 wins TB and set+match
eq(last.type, "match", "tiebreak wins match");
eq(m.completedSets[0], [7, 6], "set recorded 7-6");

/* ---- 6. tiebreak OFF requires 2-game margin ---- */
m = new PadelMatch({ setsToWin: 1, deuce: "golden", tiebreak: false });
for (let i = 0; i < 6; i++) winGame(m, 0);     // 6-0... wait need margin scenario
m = new PadelMatch({ setsToWin: 1, deuce: "golden", tiebreak: false });
for (let i = 0; i < 5; i++) { winGame(m, 0); winGame(m, 1); } // 5-5
winGame(m, 0); winGame(m, 1);  // 6-6, no tiebreak -> continue
eq(m.getDisplay().inTiebreak, false, "no tiebreak when off");
eq(m.getDisplay().games, [6, 6], "6-6 continues");
winGame(m, 0); // 7-6 not enough
eq(m.matchOver, false, "7-6 not enough without margin");
last = winGame(m, 0); // 8-6 wins
eq(m.matchOver, true, "8-6 wins set (margin 2)");

/* ---- 7. undo ---- */
m = new PadelMatch({ setsToWin: 1, deuce: "advantage", tiebreak: true });
m.addPoint(0); m.addPoint(0);
eq(m.getDisplay().points, ["30", "0"], "before undo 30-0");
m.undo();
eq(m.getDisplay().points, ["15", "0"], "after undo 15-0");
m.undo();
eq(m.getDisplay().points, ["0", "0"], "after 2nd undo 0-0");
eq(m.canUndo(), false, "no more undo");

/* ---- 8. best of 3 needs 2 sets ---- */
m = new PadelMatch({ setsToWin: 2, deuce: "golden", tiebreak: true });
function winSet(match, team) { for (let g = 0; g < 6; g++) winGame(match, team); }
winSet(m, 0); eq(m.getDisplay().sets, [1, 0], "set 1 to A");
eq(m.matchOver, false, "not over after 1 set in bo3");
winSet(m, 0); eq(m.matchOver, true, "over after 2 sets in bo3");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
