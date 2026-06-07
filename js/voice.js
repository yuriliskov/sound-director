// Voice assist: continuous Russian speech recognition. It NEVER fires a cue —
// it only reports what it heard so the perform view can highlight/arm the next
// cue. Uses the Web Speech API (Chrome/Android). Requires a network connection.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

let rec = null;
let running = false;
let onText = null;
let restartTimer = null;
let lastStart = 0;
let backoff = 600;            // ms between restarts; grows when idle to stop the chime spam
const MIN_BACKOFF = 600;
const MAX_BACKOFF = 4000;

export const voice = {
  supported() { return !!SR; },
  isRunning() { return running; },

  start(cb) {
    if (!SR) return false;
    onText = cb;
    if (running) return true;
    running = true;
    backoff = MIN_BACKOFF;
    spin();
    return true;
  },

  stop() {
    running = false;
    clearTimeout(restartTimer);
    if (rec) { try { rec.abort(); } catch {} rec = null; }
  },
};

function spin() {
  if (!running) return;
  rec = new SR();
  rec.lang = 'ru-RU';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  lastStart = Date.now();

  rec.onresult = (e) => {
    backoff = MIN_BACKOFF; // actively hearing speech -> stay responsive
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) final += r[0].transcript + ' ';
      else interim += r[0].transcript + ' ';
    }
    if (onText) onText({ interim: interim.trim(), final: final.trim() });
  };

  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      running = false;
      if (onText) onText({ error: 'Microphone permission denied' });
    }
    // 'no-speech' / 'aborted' / 'network' are handled by onend's backoff.
  };

  rec.onend = () => {
    if (!running) return;
    // If the recognizer dies almost immediately (quiet room / can't sustain),
    // each restart makes Android's chime — so slow the restarts way down.
    const alive = Date.now() - lastStart;
    backoff = alive < 1500 ? Math.min(MAX_BACKOFF, Math.round(backoff * 1.6)) : MIN_BACKOFF;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(spin, backoff);
  };

  try { rec.start(); } catch { /* will retry via onend */ }
}
