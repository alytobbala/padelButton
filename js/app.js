/* ====================================================================
   app.js — wires the scoring engine, Bluetooth and announcer to the UI.
   ==================================================================== */
(function () {
  "use strict";

  const STORE_KEY = "padelbutton.settings.v1";
  const $ = (sel) => document.querySelector(sel);

  /* ---------------- Settings (persisted) ------------------------- */
  const settings = loadSettings();

  function defaultSettings() {
    return {
      format: 3,            // best of 1 / 3 / 5
      deuce: "advantage",   // "advantage" | "golden"
      tiebreak: "on",       // "on" | "off"
      muted: false,
      pack: "tts",
      voice: null,
      names: { A: "Team A", B: "Team B" }
    };
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? Object.assign(defaultSettings(), JSON.parse(raw)) : defaultSettings();
    } catch (e) { return defaultSettings(); }
  }

  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  function setsToWin(format) { return Math.ceil(format / 2); }

  /* ---------------- Core objects --------------------------------- */
  const announcer = new Announcer();
  const bt = new PadelBluetooth();
  let match = newMatch();

  function newMatch() {
    return new PadelMatch({
      setsToWin: setsToWin(settings.format),
      deuce: settings.deuce,
      tiebreak: settings.tiebreak === "on"
    });
  }

  /* ---------------- Element refs --------------------------------- */
  const el = {
    screenGame: $("#screen-game"),
    screenSettings: $("#screen-settings"),
    pointsA: $("#pointsA"), pointsB: $("#pointsB"),
    gamesA: $("#gamesA"), gamesB: $("#gamesB"),
    setsA: $("#setsA"), setsB: $("#setsB"),
    serveA: $("#serveA"), serveB: $("#serveB"),
    teamA: $("#point-A"), teamB: $("#point-B"),
    history: $("#games-history"),
    setLabel: $("#set-label"),
    conn: $("#conn-status"),
    undo: $("#btn-undo"),
    connect: $("#btn-connect"),
    reset: $("#btn-reset"),
    mute: $("#btn-mute"),
    settingsBtn: $("#btn-settings"),
    back: $("#btn-back"),
    banner: $("#winner-banner"),
    winnerTeam: $("#winner-team"),
    newMatch: $("#btn-new-match")
  };

  /* ---------------- Rendering ------------------------------------ */
  function teamName(i) { return settings.names[i === 0 ? "A" : "B"] || (i === 0 ? "Team A" : "Team B"); }

  function applyTeamNames() {
    document.querySelectorAll('[data-team-name="A"]').forEach(n => n.textContent = teamName(0));
    document.querySelectorAll('[data-team-name="B"]').forEach(n => n.textContent = teamName(1));
  }

  function render() {
    const s = match.getDisplay();
    el.pointsA.textContent = s.points[0];
    el.pointsB.textContent = s.points[1];
    el.gamesA.textContent = s.games[0];
    el.gamesB.textContent = s.games[1];
    el.setsA.textContent = s.sets[0];
    el.setsB.textContent = s.sets[1];

    el.serveA.classList.toggle("is-serving", s.server === 0 && !s.matchOver);
    el.serveB.classList.toggle("is-serving", s.server === 1 && !s.matchOver);

    const settable = !s.matchOver && match.history.length === 0;
    el.teamA.classList.toggle("serve-settable", settable);
    el.teamB.classList.toggle("serve-settable", settable);

    el.setLabel.textContent = s.inTiebreak ? "Tiebreak" : `Set ${s.setNumber}`;

    // completed sets history
    el.history.innerHTML = "";
    s.completedSets.forEach((set, i) => {
      const div = document.createElement("div");
      div.className = "games__set";
      div.innerHTML = `S${i + 1} <b>${set[0]}</b>&ndash;<b>${set[1]}</b>`;
      el.history.appendChild(div);
    });

    el.undo.disabled = !match.canUndo();

    if (s.matchOver) showWinner(s.winner);
  }

  function flash(team) {
    const node = team === 0 ? el.teamA : el.teamB;
    node.classList.remove("flash");
    void node.offsetWidth; // reflow to restart animation
    node.classList.add("flash");
  }

  function showWinner(team) {
    el.winnerTeam.textContent = teamName(team);
    el.winnerTeam.style.color = team === 0 ? "var(--teamA)" : "var(--teamB)";
    el.banner.hidden = false;
  }

  /* ---------------- Point handling ------------------------------- */
  function addPoint(team) {
    if (match.matchOver) return;
    const result = match.addPoint(team);
    if (result.type === "noop") return;
    flash(team);
    render();
    announce(result);
    if (navigator.vibrate) navigator.vibrate(result.type === "point" ? 20 : 60);
  }

  function announce(result) {
    const line = buildAnnouncement(result, [teamName(0), teamName(1)]);
    announcer.announce(line);
  }

  /* ---------------- Connection status ---------------------------- */
  bt.on("press", ({ team }) => addPoint(team));
  bt.on("status", () => renderConnStatus());

  function renderConnStatus() {
    const connected = bt.anyConnected();
    const connecting = bt.statusOf(0) === PadelBluetooth.STATUS.CONNECTING ||
                       bt.statusOf(1) === PadelBluetooth.STATUS.CONNECTING;
    el.conn.classList.remove("conn--off", "conn--on", "conn--connecting");
    const label = el.conn.querySelector(".conn__label");
    if (connecting) { el.conn.classList.add("conn--connecting"); label.textContent = "Connecting…"; }
    else if (connected) { el.conn.classList.add("conn--on"); label.textContent = "Connected"; }
    else { el.conn.classList.add("conn--off"); label.textContent = "Disconnected"; }

    el.connect.classList.toggle("is-on", connected);
    el.connect.textContent = connected ? "Connected ✓" : "Connect Device";
  }

  async function onConnect() {
    if (!PadelBluetooth.supported) {
      alert("Web Bluetooth isn't available here. Use Chrome/Edge on Android or desktop over HTTPS.");
      return;
    }
    // Bind to the first free team slot (Team A first, then Team B).
    const team = bt.statusOf(0) !== PadelBluetooth.STATUS.ON ? 0 : 1;
    try {
      await bt.connect(team);
    } catch (err) {
      if (err && err.name === "NotFoundError") return; // user cancelled
      alert("Connection failed: " + (err && err.message ? err.message : err));
    }
  }

  /* ---------------- Mute toggle ---------------------------------- */
  function applyMute() {
    announcer.setMuted(settings.muted);
    el.mute.textContent = settings.muted ? "🔇" : "🔊";
    el.mute.setAttribute("aria-label", settings.muted ? "Unmute announcements" : "Mute announcements");
  }

  function toggleMute() {
    settings.muted = !settings.muted;
    saveSettings();
    applyMute();
    syncSettingsUI();
  }

  /* ---------------- Reset / undo --------------------------------- */
  function resetMatch() {
    if (!confirm("Reset the match? Current score will be lost.")) return;
    match = newMatch();
    el.banner.hidden = true;
    announcer.cancel();
    render();
  }

  function undo() {
    if (match.undo()) { announcer.cancel(); el.banner.hidden = true; render(); }
  }

  /* ---------------- Screen navigation ---------------------------- */
  function showSettings(show) {
    el.screenSettings.hidden = !show;
    el.screenSettings.classList.toggle("screen--active", show);
    el.screenGame.classList.toggle("screen--active", !show);
    if (show) syncSettingsUI();
  }

  /* ---------------- Settings UI ---------------------------------- */
  function initSegs() {
    bindSeg("#set-format", String(settings.format), (v) => {
      settings.format = parseInt(v, 10);
      $("#hint-sets").textContent = setsToWin(settings.format);
      onRuleChange();
    });
    bindSeg("#set-deuce", settings.deuce, (v) => { settings.deuce = v; onRuleChange(); });
    bindSeg("#set-tiebreak", settings.tiebreak, (v) => { settings.tiebreak = v; onRuleChange(); });
    bindSeg("#set-mute", settings.muted ? "off" : "on", (v) => {
      settings.muted = (v === "off"); saveSettings(); applyMute();
    });
  }

  function bindSeg(sel, value, onChange) {
    const group = $(sel);
    const btns = group.querySelectorAll(".seg__btn");
    btns.forEach(b => {
      b.classList.toggle("is-active", b.dataset.value === value);
      b.addEventListener("click", () => {
        btns.forEach(x => x.classList.remove("is-active"));
        b.classList.add("is-active");
        onChange(b.dataset.value);
        saveSettings();
      });
    });
  }

  function syncSegValue(sel, value) {
    $(sel).querySelectorAll(".seg__btn").forEach(b =>
      b.classList.toggle("is-active", b.dataset.value === value));
  }

  function syncSettingsUI() {
    syncSegValue("#set-format", String(settings.format));
    syncSegValue("#set-deuce", settings.deuce);
    syncSegValue("#set-tiebreak", settings.tiebreak);
    syncSegValue("#set-mute", settings.muted ? "off" : "on");
    $("#hint-sets").textContent = setsToWin(settings.format);
    $("#name-A").value = settings.names.A === "Team A" ? "" : settings.names.A;
    $("#name-B").value = settings.names.B === "Team B" ? "" : settings.names.B;
  }

  // When a rule changes mid-match, offer to restart so it applies cleanly.
  let ruleChangeTimer = null;
  function onRuleChange() {
    clearTimeout(ruleChangeTimer);
    ruleChangeTimer = setTimeout(() => {
      const hasProgress = match.history.length > 0 || match.completedSets.length > 0;
      if (hasProgress) {
        if (confirm("Rules changed. Start a new match with the new rules?")) {
          match = newMatch(); el.banner.hidden = true; render();
        }
      } else {
        match = newMatch(); render();
      }
    }, 250);
  }

  function initPackAndVoices() {
    const packSel = $("#set-pack");
    packSel.innerHTML = "";
    announcer.listPacks().forEach(p => {
      const o = document.createElement("option");
      o.value = p.id; o.textContent = p.name; packSel.appendChild(o);
    });
    packSel.value = settings.pack;
    packSel.addEventListener("change", async () => {
      settings.pack = packSel.value; saveSettings();
      await announcer.usePack(settings.pack);
      populateVoices();
    });

    $("#set-voice").addEventListener("change", (e) => {
      settings.voice = e.target.value; saveSettings();
      announcer.setVoice(settings.voice);
    });

    $("#btn-test-voice").addEventListener("click", () => {
      const prevMute = announcer.muted;
      announcer.setMuted(false);
      announcer.announce(`${teamName(0)} serving. Forty, thirty.`);
      announcer.muted = prevMute;
    });
  }

  function populateVoices() {
    const sel = $("#set-voice");
    const voices = announcer.listVoices();
    sel.innerHTML = "";
    if (!voices.length) {
      const o = document.createElement("option");
      o.textContent = "System default"; o.value = "";
      sel.appendChild(o); sel.disabled = true; return;
    }
    sel.disabled = false;
    const def = document.createElement("option");
    def.textContent = "System default"; def.value = "";
    sel.appendChild(def);
    voices.forEach(v => {
      const o = document.createElement("option");
      o.value = v.id; o.textContent = v.name; sel.appendChild(o);
    });
    if (settings.voice) sel.value = settings.voice;
    announcer.setVoice(settings.voice);
  }

  function initNameInputs() {
    $("#name-A").addEventListener("input", (e) => {
      settings.names.A = e.target.value.trim() || "Team A";
      saveSettings(); applyTeamNames();
    });
    $("#name-B").addEventListener("input", (e) => {
      settings.names.B = e.target.value.trim() || "Team B";
      saveSettings(); applyTeamNames();
    });
  }

  /* ---------------- Wiring --------------------------------------- */
  function bindEvents() {
    el.serveA.addEventListener("click", (e) => {
      if (match.history.length > 0) return;
      e.stopPropagation();
      match.server = 0;
      render();
    });
    el.serveB.addEventListener("click", (e) => {
      if (match.history.length > 0) return;
      e.stopPropagation();
      match.server = 1;
      render();
    });

    el.teamA.addEventListener("click", () => addPoint(0));
    el.teamB.addEventListener("click", () => addPoint(1));
    el.undo.addEventListener("click", undo);
    el.reset.addEventListener("click", resetMatch);
    el.connect.addEventListener("click", onConnect);
    el.mute.addEventListener("click", toggleMute);
    el.settingsBtn.addEventListener("click", () => showSettings(true));
    el.back.addEventListener("click", () => showSettings(false));
    el.newMatch.addEventListener("click", () => {
      match = newMatch(); el.banner.hidden = true; render();
    });

    // keyboard for desktop testing: A / L keys, Z = undo
    document.addEventListener("keydown", (e) => {
      if (el.screenSettings.classList.contains("screen--active")) return;
      if (e.key === "a" || e.key === "A") addPoint(0);
      else if (e.key === "l" || e.key === "L") addPoint(1);
      else if (e.key === "z" || e.key === "Z") undo();
    });
  }

  /* ---------------- Boot ----------------------------------------- */
  async function boot() {
    applyTeamNames();
    applyMute();
    initSegs();
    initNameInputs();
    initPackAndVoices();
    bindEvents();
    renderConnStatus();
    render();

    await announcer.ready();
    populateVoices();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
