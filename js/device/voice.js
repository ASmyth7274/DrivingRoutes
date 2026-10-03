// Spoken directions using the phone's built-in voices (Web Speech API).
//
// iPhone quirks handled here:
// - Speech has to be started from a tap the first time (unlock()).
// - Silent Mode mutes web speech unless the page asks for a "playback"
//   audio session (Safari 17+), which we do while speaking.
// - iOS can list voices that aren't downloaded; choosing one plays nothing
//   and reports no error. So by default no voice is picked (iOS then uses
//   its own English (UK) voice), and a chosen voice that never starts is
//   dropped in favour of the default.
// - Leaving the app mid-sentence can leave the speech queue stuck, so it is
//   cleared when the app comes back.

import { Emitter } from '../lib/events.js';

const START_TIMEOUT = 2500;

export class Voice extends Emitter {
  constructor() {
    super();
    this.enabled = true;
    this.voiceName = null;
    this.rate = 1;
    this.playThroughSilent = true;
    this.unlocked = false;
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.voices = [];
    this.badVoices = new Set();
    this.inFlight = 0;
    this.lastFailAt = 0;
    this.lastStartAt = 0;
    if (this.supported) {
      this._loadVoices();
      window.speechSynthesis.addEventListener?.('voiceschanged', () => this._loadVoices());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this._recover();
      });
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

  /** The voice the user chose, if it's still usable. Null means "let iOS choose". */
  _chosen() {
    if (!this.voiceName || this.badVoices.has(this.voiceName)) return null;
    return this.list().find((v) => v.name === this.voiceName) || null;
  }

  /** Ask iOS to play our audio even in Silent Mode (no-op elsewhere). */
  claimAudio() {
    if (!this.playThroughSilent) return;
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    } catch { /* not supported */ }
  }

  /** Hand audio back (so music apps aren't affected once guidance ends). */
  releaseAudio() {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'auto') navigator.audioSession.type = 'auto';
    } catch { /* not supported */ }
  }

  /** Call from a tap handler so iOS allows speech later on. */
  unlock() {
    if (!this.supported) return;
    this.claimAudio();
    if (this.unlocked) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.lang = 'en-GB';
      window.speechSynthesis.speak(u);
      this.unlocked = true;
    } catch { /* ignore */ }
  }

  _recover() {
    const synth = window.speechSynthesis;
    try {
      if (synth.paused) synth.resume();
      if (synth.speaking || synth.pending) synth.cancel();
    } catch { /* ignore */ }
    this.inFlight = 0;
  }

  _fail(reason) {
    const now = Date.now();
    if (now - this.lastFailAt < 60000) return;
    this.lastFailAt = now;
    this.emit('fail', { reason });
  }

  say(text, { priority = 'normal' } = {}) {
    if (!this.supported || !this.enabled || !text) return;
    this.claimAudio();
    const synth = window.speechSynthesis;
    const speakNow = (voice) => {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = 'en-GB';
      }
      u.rate = this.rate;
      let started = false;
      let finished = false;
      this.inFlight++;
      const done = () => {
        if (finished) return;
        finished = true;
        this.inFlight = Math.max(0, this.inFlight - 1);
      };
      u.onstart = () => {
        started = true;
        this.lastStartAt = Date.now();
        this.emit('start');
      };
      u.onend = done;
      u.onerror = (e) => {
        done();
        const err = e?.error || '';
        if (err && err !== 'interrupted' && err !== 'canceled') {
          if (voice) this.badVoices.add(voice.name);
          this._fail(err);
        }
      };
      // Only watch utterances that should start straight away (nothing queued ahead).
      const shouldStartNow = !synth.speaking && !synth.pending;
      synth.speak(u);
      if (shouldStartNow) {
        setTimeout(() => {
          if (started || finished || document.visibilityState !== 'visible') return;
          if (voice) {
            // Probably a listed-but-not-installed voice: retry with the default.
            this.badVoices.add(voice.name);
            this.emit('voicefallback', { name: voice.name });
            try { synth.cancel(); } catch { /* ignore */ }
            this.inFlight = 0;
            setTimeout(() => speakNow(null), 150);
          } else {
            this._fail('no-start');
          }
        }, START_TIMEOUT);
      }
    };
    // A direction queued behind two others would be late: drop the backlog.
    const busy = synth.speaking || synth.pending;
    if (busy && (priority === 'high' || this.inFlight >= 2)) {
      this.inFlight = 0;
      synth.cancel();
      // iOS can stay silent if speak() follows cancel() in the same tick.
      setTimeout(() => speakNow(this._chosen()), 150);
    } else {
      speakNow(this._chosen());
    }
  }

  /** A short spoken check, from a tap: proves the voice works before driving. */
  prime(text) {
    this.unlock();
    this.say(text, { priority: 'high' });
  }

  stop() {
    if (this.supported) window.speechSynthesis.cancel();
    this.inFlight = 0;
  }
}
