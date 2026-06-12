/* ====================================================================
   PadelMatch — pure scoring engine for padel / tennis scoring.
   No DOM, no audio. Emits plain result objects the UI can react to.
   ==================================================================== */
(function (global) {
  "use strict";

  const POINT_LABELS = ["0", "15", "30", "40"]; // index = raw point count

  const DEFAULTS = {
    setsToWin: 2,           // 1 = best of 1, 2 = best of 3, 3 = best of 5
    deuce: "advantage",     // "advantage" | "golden"
    tiebreak: true,         // play a 7-point tiebreak at 6-6
    gamesPerSet: 6,         // games needed (with 2-game margin) to win a set
    tiebreakTo: 7           // points needed (with 2 margin) to win a tiebreak
  };

  class PadelMatch {
    constructor(config) {
      this.config = Object.assign({}, DEFAULTS, config || {});
      this.history = [];     // stack of serialized snapshots for undo
      this.reset(true);
    }

    /* ---------------------------------------------------------------- */
    reset(keepConfig) {
      if (!keepConfig) this.config = Object.assign({}, DEFAULTS);
      this.points = [0, 0];        // raw point counters for current game / tiebreak
      this.games = [0, 0];         // games in current set
      this.sets = [0, 0];          // sets won
      this.completedSets = [];     // [[a,b], ...]
      this.server = 0;             // team index currently serving (cosmetic)
      this.tbServer = 0;           // server within tiebreak
      this.tbPointCount = 0;       // points played in current tiebreak
      this.inTiebreak = false;
      this.matchOver = false;
      this.winner = null;          // 0 | 1 | null
      this.history = [];
    }

    /* ----- config updates (applied to a fresh match) ---------------- */
    configure(partial) {
      this.config = Object.assign({}, this.config, partial);
    }

    /* ---------------------------------------------------------------- */
    _snapshot() {
      return JSON.stringify({
        points: this.points, games: this.games, sets: this.sets,
        completedSets: this.completedSets, server: this.server,
        tbServer: this.tbServer, tbPointCount: this.tbPointCount,
        inTiebreak: this.inTiebreak, matchOver: this.matchOver, winner: this.winner
      });
    }

    _restore(snap) {
      const s = JSON.parse(snap);
      Object.assign(this, s);
    }

    canUndo() { return this.history.length > 0; }

    undo() {
      if (!this.history.length) return false;
      this._restore(this.history.pop());
      return true;
    }

    /* ----- main entry point ---------------------------------------- */
    // team: 0 (A) or 1 (B). Returns a result describing the outcome.
    addPoint(team) {
      if (this.matchOver) return { type: "noop", reason: "match-over" };
      this.history.push(this._snapshot());
      if (this.history.length > 100) this.history.shift();

      return this.inTiebreak ? this._addTiebreakPoint(team) : this._addGamePoint(team);
    }

    /* ----- normal game scoring ------------------------------------- */
    _addGamePoint(team) {
      const other = team ^ 1;
      const a = this.points[team];
      const b = this.points[other];

      let gameWon = false;

      if (a < 3 || b < 3) {
        // simple progression up to 40
        this.points[team] = a + 1;
        if (this.points[team] === 4) gameWon = true; // won from 40 vs <40
      } else {
        // both at 40 or beyond -> deuce territory
        if (this.config.deuce === "golden") {
          gameWon = true; // sudden death
        } else if (a === b) {
          this.points[team] = a + 1; // advantage
        } else if (a > b) {
          gameWon = true;            // had advantage, win game
        } else {
          this.points[team] = a + 1; // back to deuce (equalize)
        }
      }

      if (gameWon) return this._winGame(team);
      return { type: "point", team, score: this.getDisplay() };
    }

    /* ----- tiebreak scoring ---------------------------------------- */
    _addTiebreakPoint(team) {
      this.points[team] += 1;
      this.tbPointCount += 1;

      // Tiebreak serve rotation: base server takes point 1, then serve
      // switches every 2 points (1, 2-3, 4-5, ...). Cosmetic only.
      this.server = this.tbServer ^ (Math.floor((this.tbPointCount + 1) / 2) % 2);

      const need = this.config.tiebreakTo;
      const a = this.points[team], b = this.points[team ^ 1];
      if (a >= need && a - b >= 2) {
        return this._winGame(team, /*viaTiebreak*/ true);
      }
      return { type: "point", team, tiebreak: true, score: this.getDisplay() };
    }

    /* ----- award a game -------------------------------------------- */
    _winGame(team, viaTiebreak) {
      this.games[team] += 1;
      this.points = [0, 0];
      this.inTiebreak = false;
      this.tbPointCount = 0;

      const setResult = this._checkSet(team, viaTiebreak);
      if (setResult) return setResult;

      // alternate server each new game
      this.server ^= 1;

      // entering a tiebreak?
      if (this.config.tiebreak &&
          this.games[0] === this.config.gamesPerSet &&
          this.games[1] === this.config.gamesPerSet) {
        this.inTiebreak = true;
        this.tbServer = this.server;
      }

      return { type: "game", team, score: this.getDisplay() };
    }

    /* ----- check set / match completion ---------------------------- */
    _checkSet(team, viaTiebreak) {
      const g = this.games[team], og = this.games[team ^ 1];
      const target = this.config.gamesPerSet;

      const wonBySets = (g >= target && g - og >= 2);
      const wonByTiebreak = viaTiebreak; // tiebreak win => 7-6, set over

      if (!wonBySets && !wonByTiebreak) return null;

      // record completed set
      this.completedSets.push([this.games[0], this.games[1]]);
      this.sets[team] += 1;
      this.games = [0, 0];
      this.points = [0, 0];
      this.inTiebreak = false;

      if (this.sets[team] >= this.config.setsToWin) {
        this.matchOver = true;
        this.winner = team;
        return { type: "match", team, score: this.getDisplay() };
      }

      // server for new set: alternates from last game server
      this.server ^= 1;
      return { type: "set", team, score: this.getDisplay() };
    }

    /* ----- display state for the UI / announcements ---------------- */
    getDisplay() {
      const labels = this._pointLabels();
      return {
        points: labels,                   // ["40", "Ad"] etc, or numbers in tiebreak
        games: this.games.slice(),
        sets: this.sets.slice(),
        completedSets: this.completedSets.map(s => s.slice()),
        server: this.server,
        inTiebreak: this.inTiebreak,
        setNumber: this.completedSets.length + 1,
        matchOver: this.matchOver,
        winner: this.winner,
        isDeuce: this._isDeuce(),
        advantageTeam: this._advantageTeam()
      };
    }

    _pointLabels() {
      if (this.inTiebreak) return [String(this.points[0]), String(this.points[1])];

      const [a, b] = this.points;
      // deuce / advantage handling for display
      if (a >= 3 && b >= 3 && this.config.deuce === "advantage") {
        if (a === b) return ["40", "40"];
        return a > b ? ["Ad", "40"] : ["40", "Ad"];
      }
      return [POINT_LABELS[Math.min(a, 3)], POINT_LABELS[Math.min(b, 3)]];
    }

    _isDeuce() {
      const [a, b] = this.points;
      return !this.inTiebreak && a >= 3 && b >= 3 && a === b &&
        this.config.deuce === "advantage";
    }

    _advantageTeam() {
      const [a, b] = this.points;
      if (this.inTiebreak || this.config.deuce !== "advantage") return null;
      if (a >= 3 && b >= 3 && a !== b) return a > b ? 0 : 1;
      return null;
    }
  }

  global.PadelMatch = PadelMatch;
})(typeof window !== "undefined" ? window : this);
