/* ====================================================================
   Announcer — pluggable score announcements.

   An "announcement pack" implements a small interface:
     {
       id:    string,
       name:  string,
       async ready(): Promise<void>      // load voices / preload audio
       speak(text, opts): void           // announce a line of text
       cancel(): void                    // stop current announcement
       listVoices(): [{id,name}]         // optional, for UI
     }

   Today we ship a Web Speech (TTS) pack. Pre-recorded file packs can be
   added later by registering another object with the same shape.
   ==================================================================== */
(function (global) {
  "use strict";

  /* ---------------- Web Speech (text-to-speech) pack ---------------- */
  const SpeechPack = {
    id: "tts",
    name: "Voice (Text-to-Speech)",
    _voices: [],
    _voiceId: null,

    ready() {
      return new Promise((resolve) => {
        if (!("speechSynthesis" in global)) return resolve();
        const load = () => {
          this._voices = global.speechSynthesis.getVoices() || [];
          resolve();
        };
        const v = global.speechSynthesis.getVoices();
        if (v && v.length) { this._voices = v; resolve(); }
        else global.speechSynthesis.onvoiceschanged = load;
        // Safari sometimes never fires the event; resolve after a beat.
        setTimeout(load, 600);
      });
    },

    listVoices() {
      return this._voices.map(v => ({ id: v.voiceURI, name: `${v.name} (${v.lang})` }));
    },

    setVoice(id) { this._voiceId = id; },

    speak(text) {
      if (!("speechSynthesis" in global)) return;
      this.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.pitch = 1.0;
      u.volume = 1.0;
      const voice = this._voices.find(v => v.voiceURI === this._voiceId);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      global.speechSynthesis.speak(u);
    },

    cancel() {
      if ("speechSynthesis" in global) global.speechSynthesis.cancel();
    }
  };

  /* ---------------- Announcer facade ------------------------------- */
  class Announcer {
    constructor() {
      this.packs = {};
      this.activeId = null;
      this.muted = false;
      this.register(SpeechPack);
      this.activeId = SpeechPack.id;
    }

    register(pack) { this.packs[pack.id] = pack; }

    listPacks() {
      return Object.values(this.packs).map(p => ({ id: p.id, name: p.name }));
    }

    get active() { return this.packs[this.activeId]; }

    async usePack(id) {
      if (!this.packs[id]) return;
      this.activeId = id;
      await this.active.ready();
    }

    async ready() { if (this.active) await this.active.ready(); }

    listVoices() {
      return this.active && this.active.listVoices ? this.active.listVoices() : [];
    }

    setVoice(id) {
      if (this.active && this.active.setVoice) this.active.setVoice(id);
    }

    setMuted(m) { this.muted = !!m; if (this.muted) this.cancel(); }

    announce(text) {
      if (this.muted || !text || !this.active) return;
      try { this.active.speak(text); } catch (e) { /* ignore TTS errors */ }
    }

    cancel() { if (this.active) this.active.cancel(); }
  }

  /* ---------------- Spoken-text formatting ------------------------- */
  // Builds the line to announce from a scoring result + team names.
  function buildAnnouncement(result, names) {
    if (!result || result.type === "noop") return "";
    const s = result.score;
    const winnerName = names[result.team] || (result.team === 0 ? "Team A" : "Team B");

    switch (result.type) {
      case "match":
        return `Game, set and match. ${winnerName} win${plural(winnerName)} the match.`;

      case "set": {
        const last = s.completedSets[s.completedSets.length - 1];
        return `Game and set, ${winnerName}. ${last[0]}, ${last[1]}. ` +
               `Sets, ${s.sets[0]} ${s.sets[1]}.`;
      }

      case "game":
        if (s.inTiebreak) return `Game ${winnerName}. Tiebreak.`;
        return `Game ${winnerName}. ${s.games[0]}, ${s.games[1]}.`;

      case "point":
      default:
        if (s.inTiebreak) return `${s.points[0]}, ${s.points[1]}.`;
        if (s.isDeuce) return "Deuce.";
        if (s.advantageTeam !== null) {
          const adv = names[s.advantageTeam] ||
            (s.advantageTeam === 0 ? "Team A" : "Team B");
          return `Advantage ${adv}.`;
        }
        // Server's score is announced first by convention.
        return announceGameScore(s);
    }
  }

  function announceGameScore(s) {
    const serverPts = s.points[s.server];
    const receiverPts = s.points[s.server ^ 1];
    if (serverPts === receiverPts) {
      return serverPts === "40" ? "Forty all." : `${spoken(serverPts)} all.`;
    }
    return `${spoken(serverPts)}, ${spoken(receiverPts)}.`;
  }

  function spoken(p) {
    if (p === "0") return "Love";
    if (p === "Ad") return "Advantage";
    return p;
  }

  function plural() { return ""; } // placeholder for future name-based grammar

  global.Announcer = Announcer;
  global.buildAnnouncement = buildAnnouncement;
})(typeof window !== "undefined" ? window : this);
