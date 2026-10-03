// Spoken directions using the device's built-in voices (Web Speech API).

export class Voice {
  constructor() {
    this.enabled = true;
    this.voiceName = null;
    this.rate = 1;
    this.unlocked = false;
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.voices = [];
    this.inFlight = 0;
    if (this.supported) {
      this._loadVoices();
      window.speechSynthesis.addEventListener?.('voiceschanged', () => this._loadVoices());
    }
  }

  _loadVoices() {
    const all = window.speechSynthesis.getVoices() || [];
    this.voices = all
      .filter((v) => /^en[-_]/i.test(v.lang))
      .sort((a, b) => {
        const score = (v) => (/en[-_]GB/i.test(v.lang) ? 0 : /en[-_](IE|AU|NZ)/i.test(v.lang) ? 1 : 2);
        return score(a) - score(b) || a.name.localeCompare(b.name);
      });
  }

  /** Voices to offer in settings, British English first. */
  list() {
    if (this.supported && !this.voices.length) this._loadVoices();
    return this.voices;
  }

  _pick() {
    const list = this.list();
    if (this.voiceName) {
      const v = list.find((x) => x.name === this.voiceName);
      if (v) return v;
    }
    const gb = list.filter((v) => /en[-_]GB/i.test(v.lang));
    return gb.find((v) => /daniel|arthur|serena|kate|martha/i.test(v.name)) || gb[0] || list[0] || null;
  }

  /** Must be called from a tap so iOS allows speech later on. */
  unlock() {
    if (!this.supported || this.unlocked) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
      this.unlocked = true;
    } catch { /* ignore */ }
  }

  say(text, { priority = 'normal' } = {}) {
    if (!this.supported || !this.enabled || !text) return;
    const synth = window.speechSynthesis;
    const speakNow = () => {
      const u = new SpeechSynthesisUtterance(text);
      const v = this._pick();
      if (v) u.voice = v;
      u.lang = v?.lang || 'en-GB';
      u.rate = this.rate;
      this.inFlight++;
      const done = () => { this.inFlight = Math.max(0, this.inFlight - 1); };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    };
    // A direction that's queued behind two others would be late: drop the backlog.
    const backlog = this.inFlight >= 2 && (synth.speaking || synth.pending);
    if ((priority === 'high' || backlog) && (synth.speaking || synth.pending)) {
      this.inFlight = 0;
      synth.cancel();
      // Safari can drop an utterance queued straight after cancel().
      setTimeout(speakNow, 80);
    } else {
      speakNow();
    }
  }

  stop() {
    if (this.supported) window.speechSynthesis.cancel();
  }
}
