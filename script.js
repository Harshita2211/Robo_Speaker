(() => {
  "use strict";

  /* ------------------------------------------------------------------
     Robo Speaker
     Uses the browser's built-in Web Speech API (speechSynthesis).
     ------------------------------------------------------------------ */

  const MAX_CHARS = 5000;
  const CHUNK_MAX = 220;
  const DEFAULTS = { voiceURI: "", rate: 1, pitch: 1, volume: 1 };

  const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const $ = (id) => document.getElementById(id);
  const el = {
    html: document.documentElement,
    theme: $("theme"),
    robot: $("robot"),
    status: $("status"),
    detail: $("detail"),
    meter: $("meterFill"),
    speak: $("speak"),
    speakLabel: $("speakLabel"),
    speakIcon: $("speakIcon"),
    stop: $("stop"),
    modKey: $("modKey"),
    editor: $("editor"),
    text: $("text"),
    reader: $("reader"),
    stats: $("stats"),
    clear: $("clear"),
    notice: $("notice"),
    chips: $("chips"),
    voice: $("voice"),
    rate: $("rate"),
    pitch: $("pitch"),
    volume: $("volume"),
    rateOut: $("rateOut"),
    pitchOut: $("pitchOut"),
    volumeOut: $("volumeOut"),
    reset: $("reset"),
    recentList: $("recentList"),
    recentEmpty: $("recentEmpty"),
    clearRecent: $("clearRecent")
  };

  /* ---------- Storage (safe if blocked) ---------- */

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem("robospeaker:" + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("robospeaker:" + key, JSON.stringify(value));
      } catch (_) {
        /* storage unavailable: ignore */
      }
    }
  };

  /* ---------- State ---------- */

  const clamp = (v, min, max, fallback) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  const saved = store.get("settings", {});
  const state = {
    status: "idle", // idle | speaking | paused
    run: 0, // increments to invalidate stale speech events
    utterances: [], // keep references so they are not garbage collected
    chunks: [],
    words: [],
    wordEls: [],
    builtFor: null,
    text: "",
    pos: 0,
    wordIdx: -1,
    nowEl: null,
    chunkRange: null,
    heard: false, // true once the browser reports word boundaries
    voices: [],
    note: "",
    fatal: false,
    boost: 0,
    amp: 0,
    settings: {
      voiceURI: typeof saved.voiceURI === "string" ? saved.voiceURI : DEFAULTS.voiceURI,
      rate: clamp(saved.rate, 0.5, 2, DEFAULTS.rate),
      pitch: clamp(saved.pitch, 0, 2, DEFAULTS.pitch),
      volume: clamp(saved.volume, 0, 1, DEFAULTS.volume)
    },
    history: Array.isArray(store.get("history", [])) ? store.get("history", []) : []
  };

  /* ---------- Theme ---------- */

  function applyTheme(theme) {
    el.html.setAttribute("data-theme", theme);
    el.theme.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }
  applyTheme(el.html.getAttribute("data-theme") === "dark" ? "dark" : "light");
  el.theme.addEventListener("click", () => {
    const next = el.html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    store.set("theme", next);
  });

  /* ---------- Small helpers ---------- */

  function countWords(t) {
    const s = t.trim();
    return s ? s.split(/\s+/).length : 0;
  }

  function fmtDuration(sec) {
    if (sec < 60) return Math.max(1, Math.round(sec)) + " sec";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return m + ":" + String(s).padStart(2, "0") + " min";
  }

  const fmtRate = (v) => Number(v).toFixed(2).replace(/(\.\d)0$/, "$1");

  function showNotice(message) {
    el.notice.textContent = message;
    el.notice.hidden = false;
  }
  function hideNotice() {
    if (state.fatal) return;
    el.notice.hidden = true;
    el.notice.textContent = "";
  }

  /* ---------- Rendering ---------- */

  const LABELS = { idle: "Ready", speaking: "Speaking", paused: "Paused" };

  function updateStats() {
    if (state.status !== "idle") {
      el.stats.textContent = "Click any word to start from there.";
      return;
    }
    const t = el.text.value;
    const w = countWords(t);
    if (!w) {
      el.stats.textContent = "0 words";
      return;
    }
    const seconds = (w / (170 * state.settings.rate)) * 60;
    el.stats.textContent =
      w + (w === 1 ? " word, " : " words, ") +
      t.length.toLocaleString() + " of " + MAX_CHARS.toLocaleString() +
      " characters, about " + fmtDuration(seconds);
  }

  function updateDetail() {
    if (state.fatal) {
      el.detail.textContent = "Text to speech is not available in this browser.";
      return;
    }
    if (state.status === "idle") {
      el.detail.textContent = state.note || "Type or pick a sample, then press Speak.";
      el.meter.style.transform = "scaleX(0)";
      return;
    }
    const total = state.words.length;
    const n = Math.max(0, state.wordIdx) + 1;
    el.detail.textContent = (state.status === "paused" ? "Paused at word " : "Word ") + n + " of " + total;
    el.meter.style.transform = "scaleX(" + Math.min(1, n / Math.max(1, total)) + ")";
  }

  function render() {
    const s = state.status;
    el.robot.setAttribute("data-state", s);
    el.status.textContent = state.fatal ? "Unavailable" : LABELS[s];
    el.speakLabel.textContent = s === "speaking" ? "Pause" : s === "paused" ? "Resume" : "Speak";
    el.speakIcon.setAttribute("href", s === "speaking" ? "#i-pause" : "#i-play");
    el.stop.disabled = s === "idle";

    if (s !== "idle" && document.activeElement === el.text) el.speak.focus();
    el.editor.setAttribute("data-mode", s === "idle" ? "edit" : "read");
    el.text.hidden = s !== "idle";
    el.reader.hidden = s === "idle";

    updateDetail();
    updateStats();
    kick();
  }

  /* ---------- Voices ---------- */

  function populateVoices() {
    if (!synth) return;
    const list = synth.getVoices().slice();
    if (!list.length && state.voices.length) return;
    state.voices = list;

    const base = (navigator.language || "en").toLowerCase().split("-")[0];
    const byName = (a, b) => a.name.localeCompare(b.name);
    const mine = list.filter((v) => v.lang.toLowerCase().startsWith(base)).sort(byName);
    const others = list.filter((v) => !mine.includes(v)).sort(byName);

    el.voice.textContent = "";
    el.voice.add(new Option("Browser default", ""));
    const addGroup = (label, voices) => {
      if (!voices.length) return;
      const group = document.createElement("optgroup");
      group.label = label;
      voices.forEach((v) => group.appendChild(new Option(v.name + " (" + v.lang + ")", v.voiceURI)));
      el.voice.appendChild(group);
    };
    addGroup("Your language", mine);
    addGroup("Other languages", others);

    const wanted = state.settings.voiceURI;
    el.voice.value = wanted && list.some((v) => v.voiceURI === wanted) ? wanted : "";
  }

  function selectedVoice() {
    const uri = state.settings.voiceURI;
    return uri ? state.voices.find((v) => v.voiceURI === uri) || null : null;
  }

  /* ---------- Settings controls ---------- */

  function paintSlider(input) {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const pct = ((parseFloat(input.value) - min) / (max - min)) * 100;
    input.style.setProperty("--fill", pct + "%");
  }

  function updateOutputs() {
    el.rateOut.textContent = fmtRate(state.settings.rate) + "x";
    el.pitchOut.textContent = fmtRate(state.settings.pitch);
    el.volumeOut.textContent = Math.round(state.settings.volume * 100) + "%";
  }

  function syncControls() {
    ["rate", "pitch", "volume"].forEach((key) => {
      el[key].value = state.settings[key];
      paintSlider(el[key]);
    });
    updateOutputs();
    if (el.voice.querySelector('option[value="' + CSS.escape(state.settings.voiceURI) + '"]')) {
      el.voice.value = state.settings.voiceURI;
    } else {
      el.voice.value = "";
    }
  }

  function settingsChanged() {
    store.set("settings", state.settings);
    if (state.status !== "idle") startFrom(Math.max(0, state.pos));
  }

  ["rate", "pitch", "volume"].forEach((key) => {
    el[key].addEventListener("input", () => {
      state.settings[key] = parseFloat(el[key].value);
      paintSlider(el[key]);
      updateOutputs();
      if (key === "rate") updateStats();
    });
    el[key].addEventListener("change", settingsChanged);
  });

  el.voice.addEventListener("change", () => {
    state.settings.voiceURI = el.voice.value;
    settingsChanged();
  });

  el.reset.addEventListener("click", () => {
    state.settings = Object.assign({}, DEFAULTS);
    syncControls();
    settingsChanged();
  });

  /* ---------- Reading view ---------- */

  function buildReader(text) {
    state.words = [];
    state.wordEls = [];
    state.nowEl = null;
    state.chunkRange = null;
    el.reader.textContent = "";
    el.reader.scrollTop = 0;

    const frag = document.createDocumentFragment();
    const re = /\S+/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement("span");
      span.className = "w";
      span.dataset.i = String(state.words.length);
      span.textContent = m[0];
      frag.appendChild(span);
      state.words.push({ s: m.index, e: m.index + m[0].length });
      state.wordEls.push(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    el.reader.appendChild(frag);
    state.builtFor = text;
  }

  function wordAt(pos) {
    let lo = 0;
    let hi = state.words.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (state.words[mid].s <= pos) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  function keepVisible(node) {
    if (!node) return;
    const r = el.reader;
    const top = node.offsetTop;
    const bottom = top + node.offsetHeight;
    const pad = 28;
    if (top < r.scrollTop + pad) r.scrollTop = Math.max(0, top - pad);
    else if (bottom > r.scrollTop + r.clientHeight - pad) r.scrollTop = bottom - r.clientHeight + pad;
  }

  function clearChunk() {
    if (!state.chunkRange) return;
    for (let i = state.chunkRange[0]; i <= state.chunkRange[1]; i++) {
      if (state.wordEls[i]) state.wordEls[i].classList.remove("chunk");
    }
    state.chunkRange = null;
  }

  function clearMarks() {
    if (state.nowEl) {
      state.nowEl.classList.remove("now");
      state.nowEl = null;
    }
    clearChunk();
    state.wordIdx = -1;
  }

  function markChunk(c) {
    if (!state.words.length) return;
    clearChunk();
    const a = wordAt(c.start);
    const b = wordAt(Math.max(c.start, c.end - 1));
    for (let i = a; i <= b; i++) state.wordEls[i].classList.add("chunk");
    state.chunkRange = [a, b];
    if (!state.heard) keepVisible(state.wordEls[a]);
  }

  function setPos(pos, strong) {
    state.pos = pos;
    if (!state.words.length) return;
    const idx = wordAt(pos);
    state.wordIdx = idx;
    if (strong) {
      if (state.nowEl) state.nowEl.classList.remove("now");
      state.nowEl = state.wordEls[idx];
      state.nowEl.classList.add("now");
      keepVisible(state.nowEl);
    }
    updateDetail();
  }

  el.reader.addEventListener("click", (e) => {
    const sel = window.getSelection();
    if (sel && String(sel).length > 0) return;
    const node = e.target.closest ? e.target.closest(".w") : null;
    if (!node) return;
    const word = state.words[parseInt(node.dataset.i, 10)];
    if (word) startFrom(word.s);
  });

  /* ---------- Speech ---------- */

  function makeChunks(text, from) {
    const chunks = [];
    const n = text.length;
    let i = from;
    while (i < n) {
      while (i < n && /\s/.test(text.charAt(i))) i++;
      if (i >= n) break;
      const windowEnd = Math.min(n, i + CHUNK_MAX);
      const win = text.slice(i, windowEnd);
      const m = /[.!?]+["')\]]*(?=\s|$)|\n/.exec(win);
      let end;
      if (m) {
        end = i + m.index + m[0].length;
      } else if (windowEnd < n) {
        const sp = win.lastIndexOf(" ");
        end = sp > 20 ? i + sp : windowEnd;
      } else {
        end = n;
      }
      chunks.push({ start: i, end });
      i = end;
    }
    return chunks;
  }

  const ERRORS = {
    "not-allowed": "Your browser blocked audio. Press Speak again to allow it.",
    "voice-unavailable": "That voice is not available on this device. Pick another one in Voice settings.",
    "language-unavailable": "That language is not available on this device. Pick another voice in Voice settings.",
    "synthesis-unavailable": "This device cannot generate speech right now. Try again in a moment.",
    "audio-busy": "Another app is using the audio output. Close it and try again.",
    "audio-hardware": "No audio output was found. Check your speakers or headphones.",
    network: "This voice needs an internet connection. Reconnect or pick an offline voice."
  };

  function pushHistory(text) {
    const t = text.trim();
    if (!t) return;
    state.history = [t, ...state.history.filter((x) => x !== t)].slice(0, 6);
    store.set("history", state.history);
    renderHistory();
  }

  function startFrom(from) {
    if (!synth || state.fatal) return;
    const fresh = state.status === "idle";
    const text = fresh ? el.text.value : state.text;

    if (!text.trim()) {
      showNotice("Type something first, then press Speak.");
      el.text.focus();
      return;
    }

    hideNotice();
    state.note = "";
    const run = ++state.run;
    synth.cancel();
    if (synth.paused) synth.resume();

    const chunks = makeChunks(text, from);
    if (!chunks.length) {
      stop();
      return;
    }

    state.text = text;
    state.chunks = chunks;
    if (fresh) pushHistory(text);

    if (state.builtFor !== text) buildReader(text);
    else clearMarks();

    state.heard = false;
    state.pos = from;
    state.wordIdx = wordAt(from);

    const voice = selectedVoice();
    const fallbackLang = document.documentElement.lang || navigator.language || "en";

    state.utterances = chunks.map((c, idx) => {
      const u = new SpeechSynthesisUtterance(text.slice(c.start, c.end));
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = fallbackLang;
      }
      u.rate = state.settings.rate;
      u.pitch = state.settings.pitch;
      u.volume = state.settings.volume;

      u.onstart = () => {
        if (run !== state.run) return;
        markChunk(c);
        setPos(c.start, state.heard);
      };
      u.onboundary = (e) => {
        if (run !== state.run) return;
        if (e.name && e.name !== "word") return;
        state.heard = true;
        setPos(c.start + e.charIndex, true);
        state.boost = 1;
        kick();
      };
      u.onend = () => {
        if (run !== state.run) return;
        if (idx === chunks.length - 1) finish();
      };
      u.onerror = (e) => {
        if (run !== state.run) return;
        if (e.error === "canceled" || e.error === "interrupted") return;
        fail(e.error);
      };
      return u;
    });

    state.status = "speaking";
    render();
    state.utterances.forEach((u) => synth.speak(u));
  }

  function finish() {
    state.run++;
    state.status = "idle";
    state.note = "Finished. Press Speak to hear it again.";
    clearMarks();
    render();
  }

  function fail(code) {
    state.run++;
    if (synth) synth.cancel();
    state.status = "idle";
    clearMarks();
    render();
    showNotice(ERRORS[code] || "Robo could not speak that. Try a different voice or reload the page.");
  }

  function stop() {
    if (!synth || state.status === "idle") return;
    state.run++;
    synth.cancel();
    if (synth.paused) synth.resume();
    state.status = "idle";
    state.note = "";
    clearMarks();
    render();
  }

  function toggle() {
    if (!synth || state.fatal) return;
    if (state.status === "idle") {
      startFrom(0);
    } else if (state.status === "speaking") {
      synth.pause();
      state.status = "paused";
      render();
    } else {
      synth.resume();
      state.status = "speaking";
      render();
    }
  }

  el.speak.addEventListener("click", toggle);
  el.stop.addEventListener("click", stop);

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      toggle();
    } else if (e.key === "Escape" && state.status !== "idle" && !(e.target && e.target.tagName === "SELECT")) {
      stop();
    }
  });

  window.addEventListener("pagehide", () => {
    if (synth) synth.cancel();
  });

  /* ---------- Text box, samples, history ---------- */

  let draftTimer = 0;
  function onInput() {
    state.note = "";
    hideNotice();
    updateStats();
    updateDetail();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => store.set("draft", el.text.value), 300);
  }
  el.text.addEventListener("input", onInput);

  function loadText(value) {
    stop();
    el.text.value = value.slice(0, MAX_CHARS);
    onInput();
    el.text.focus();
  }

  el.clear.addEventListener("click", () => loadText(""));

  el.chips.addEventListener("click", (e) => {
    const chip = e.target.closest ? e.target.closest(".chip") : null;
    if (chip) loadText(chip.dataset.text || "");
  });

  function renderHistory() {
    el.recentList.textContent = "";
    state.history.forEach((t) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "recent-item";
      b.textContent = t;
      b.title = "Load this text";
      b.addEventListener("click", () => loadText(t));
      li.appendChild(b);
      el.recentList.appendChild(li);
    });
    const has = state.history.length > 0;
    el.recentList.hidden = !has;
    el.clearRecent.hidden = !has;
    el.recentEmpty.hidden = has;
  }

  el.clearRecent.addEventListener("click", () => {
    state.history = [];
    store.set("history", []);
    renderHistory();
  });

  /* ---------- Robot mouth animation ---------- */

  const bars = Array.from(document.querySelectorAll("#mouth rect"));
  const MID = 210;
  const MIN_H = 6;
  const MAX_H = 38;
  const centre = (bars.length - 1) / 2;
  const envelope = bars.map((_, i) => 1 - (Math.abs(i - centre) / (centre + 1)) * 0.7);
  let raf = 0;

  function tick(ts) {
    const speaking = state.status === "speaking";
    const still = reduceMotion.matches;
    state.amp += ((speaking ? 1 : 0) - state.amp) * 0.14;
    state.boost *= 0.9;

    const level = still ? state.amp * 0.8 : state.amp * (state.heard ? 0.45 + 0.55 * state.boost : 0.85);

    bars.forEach((bar, i) => {
      const wave = still ? 0.6 : (Math.sin(ts / 110 + i * 0.85) + Math.sin(ts / 67 + i * 1.9) + 2) / 4;
      const h = MIN_H + (MAX_H - MIN_H) * level * envelope[i] * wave;
      bar.setAttribute("height", h.toFixed(1));
      bar.setAttribute("y", (MID - h / 2).toFixed(1));
    });

    raf = speaking || state.amp > 0.01 || state.boost > 0.01 ? requestAnimationFrame(tick) : 0;
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  /* ---------- Init ---------- */

  function init() {
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) el.modKey.textContent = "Cmd";

    el.text.value = String(store.get("draft", "")).slice(0, MAX_CHARS);
    syncControls();
    renderHistory();

    if (!synth) {
      state.fatal = true;
      [el.speak, el.stop, el.voice, el.rate, el.pitch, el.volume, el.reset].forEach((node) => {
        node.disabled = true;
      });
      showNotice("This browser cannot do text to speech. Try a recent version of Chrome, Edge, Safari or Firefox.");
    } else {
      populateVoices();
      synth.onvoiceschanged = () => {
        populateVoices();
        syncControls();
      };
    }

    render();
  }

  init();
})();
