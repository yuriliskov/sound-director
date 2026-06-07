import { db } from './db.js';
import { uid } from './util.js';

// Audio engine: each playing sound = an <audio> element routed through a
// GainNode so we can fade. Long files stream (low memory) which matters when a
// show has many backing tracks. Players are tracked so the UI can show a rack.

let ctx = null;
const urlCache = new Map();   // audioId -> objectURL
const players = new Map();    // playerId -> player
const listeners = new Set();
let unlocked = false;

function emit() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }

async function urlFor(audioId) {
  if (urlCache.has(audioId)) return urlCache.get(audioId);
  const rec = await db.getAudio(audioId);
  if (!rec) throw new Error('Audio not found in library');
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(audioId, url);
  return url;
}

export const audio = {
  players,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // Must be called from a user gesture (Android requires it).
  unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    unlocked = true;
    return ctx;
  },

  isUnlocked() { return unlocked && ctx && ctx.state === 'running'; },

  // spec: { audioId, name, volume(0..1), loop, fadeMs, restart, key }
  async play(spec) {
    this.unlock();
    const { audioId, name = 'audio', volume = 1, loop = false, fadeMs = 0, restart = true } = spec;
    const key = spec.key || audioId;

    // restart policy: stop existing players that share this key
    if (restart) {
      for (const [pid, p] of players) if (p.key === key) this.stop(pid, 0);
    } else {
      // if already playing and not restart, leave it
      for (const p of players.values()) if (p.key === key) return p;
    }

    const url = await urlFor(audioId);
    const elem = new Audio(url);
    elem.crossOrigin = 'anonymous';
    elem.loop = loop;
    elem.preload = 'auto';

    const src = ctx.createMediaElementSource(elem);
    const gain = ctx.createGain();
    src.connect(gain).connect(ctx.destination);

    const target = Math.max(0, Math.min(1, volume));
    const now = ctx.currentTime;
    if (fadeMs > 0) {
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, target), now + fadeMs / 1000);
    } else {
      gain.gain.setValueAtTime(target, now);
    }

    const id = uid('ply');
    const player = { id, key, name, audioId, elem, gain, loop, volume: target, startedAt: Date.now() };
    players.set(id, player);

    elem.addEventListener('ended', () => { if (!elem.loop) { players.delete(id); emit(); } });
    elem.play().catch(err => { console.warn('play() blocked', err); });
    emit();
    return player;
  },

  setVolume(playerId, volume) {
    const p = players.get(playerId);
    if (!p) return;
    p.volume = Math.max(0, Math.min(1, volume));
    p.gain.gain.setTargetAtTime(Math.max(0.0001, p.volume), ctx.currentTime, 0.02);
    emit();
  },

  stop(playerId, fadeMs = 0) {
    const p = players.get(playerId);
    if (!p) return;
    const finish = () => { try { p.elem.pause(); p.elem.src = ''; } catch {} players.delete(playerId); emit(); };
    if (fadeMs > 0 && ctx) {
      const now = ctx.currentTime;
      try {
        p.gain.gain.cancelScheduledValues(now);
        p.gain.gain.setValueAtTime(Math.max(0.0001, p.gain.gain.value), now);
        p.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeMs / 1000);
      } catch {}
      setTimeout(finish, fadeMs + 30);
    } else {
      finish();
    }
  },

  // Stop every player whose key matches (used by a STOP cue tied to an audioId).
  stopByKey(key, fadeMs = 0) {
    for (const [pid, p] of players) if (p.key === key) this.stop(pid, fadeMs);
  },

  stopAll(fadeMs = 0) {
    for (const pid of [...players.keys()]) this.stop(pid, fadeMs);
  },

  isPlayingKey(key) {
    for (const p of players.values()) if (p.key === key) return true;
    return false;
  },

  // Decode just enough to read duration; used when adding to library.
  probeDuration(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio();
      a.preload = 'metadata';
      let done = false;
      const finish = (d) => { if (done) return; done = true; clearTimeout(t); try { URL.revokeObjectURL(url); } catch {} resolve(d); };
      const t = setTimeout(() => finish(0), 4000); // never hang the import
      a.addEventListener('loadedmetadata', () => finish(isFinite(a.duration) ? a.duration : 0), { once: true });
      a.addEventListener('error', () => finish(0), { once: true });
      a.src = url;
    });
  },

  // Drop cached object URL (e.g. after deleting from library).
  forget(audioId) {
    const u = urlCache.get(audioId);
    if (u) { URL.revokeObjectURL(u); urlCache.delete(audioId); }
  },
};
