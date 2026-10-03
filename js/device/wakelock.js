// Keeps the screen on while driving.
// Uses the Screen Wake Lock API (iOS 16.4+, and in Home Screen apps from
// iOS 18.4), falling back to a muted looping inline video on older devices.

import { Emitter } from '../lib/events.js';
import { MP4, WEBM } from './nosleep-media.js';

export class ScreenWake extends Emitter {
  constructor() {
    super();
    this.wanted = false;
    this.sentinel = null;
    this.video = null;
    this.mode = 'off'; // 'native' | 'video' | 'off'
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.wanted) this._acquire();
      });
    }
  }

  get active() {
    return this.mode !== 'off';
  }

  /** Call from a tap handler the first time so the video fallback may play. */
  async enable() {
    this.wanted = true;
    return this._acquire();
  }

  async _acquire() {
    if (this.sentinel && !this.sentinel.released) return true;
    if ('wakeLock' in navigator) {
      try {
        const s = await navigator.wakeLock.request('screen');
        this.sentinel = s;
        this._set('native');
        s.addEventListener('release', () => {
          if (this.sentinel === s) this.sentinel = null;
          if (this.mode === 'native') this._set('off');
          // The lock is dropped when the app is hidden; take it back once visible.
          if (this.wanted && document.visibilityState === 'visible') setTimeout(() => this._acquire(), 500);
        });
        this._stopVideo();
        return true;
      } catch (err) {
        console.warn('Wake lock request failed, trying video fallback', err);
      }
    }
    return this._startVideo();
  }

  async _startVideo() {
    try {
      if (!this.video) {
        const v = document.createElement('video');
        v.setAttribute('playsinline', '');
        v.setAttribute('muted', '');
        v.muted = true;
        v.setAttribute('title', 'Keep screen on');
        v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0;';
        for (const [type, src] of [['webm', WEBM], ['mp4', MP4]]) {
          const s = document.createElement('source');
          s.src = src;
          s.type = `video/${type}`;
          v.appendChild(s);
        }
        v.addEventListener('loadedmetadata', () => {
          if (v.duration <= 1) v.setAttribute('loop', '');
          else v.addEventListener('timeupdate', () => { if (v.currentTime > 0.5) v.currentTime = Math.random(); });
        });
        document.body.appendChild(v);
        this.video = v;
      }
      await this.video.play();
      this._set('video');
      return true;
    } catch (err) {
      console.warn('Could not keep the screen on', err);
      this._set('off');
      return false;
    }
  }

  _stopVideo() {
    if (this.video && !this.video.paused) this.video.pause();
  }

  disable() {
    this.wanted = false;
    try {
      this.sentinel?.release();
    } catch { /* ignore */ }
    this.sentinel = null;
    this._stopVideo();
    this._set('off');
  }

  _set(mode) {
    if (this.mode !== mode) {
      this.mode = mode;
      this.emit('change', mode);
    }
  }
}
