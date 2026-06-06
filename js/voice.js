// Voice assist: continuous Russian speech recognition. It NEVER fires a cue —
// it only reports what it heard so the perform view can highlight/arm the next
// cue. Uses the Web Speech API (Chrome/Android). Requires a network connection.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

let rec = null;
let running = false;
let onText = null;
let restartTimer = null;

export const voice = {
  supported() { return !!SR; },
  isRunning() { return running; },

  start(cb) {
    if (!SR) return false;
    onText = cb;
    if (running) return true;
    rec = new SR();
    rec.lang = 'ru-RU';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript + ' ';
        else interim += r[0].transcript + ' ';
      }
      if (onText) onText({ interim: interim.trim(), final: final.trim() });
    };
    rec.onerror = (e) => {
      // 'no-speech' / 'aborted' are normal; 'not-allowed' means mic denied.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        running = false;
        if (onText) onText({ error: 'Microphone permission denied' });
      }
    };
    rec.onend = () => {
      // Chrome stops periodically; auto-restart while the user wants it on.
      if (running) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => { try { rec.start(); } catch {} }, 250);
      }
    };

    running = true;
    try { rec.start(); } catch {}
    return true;
  },

  stop() {
    running = false;
    clearTimeout(restartTimer);
    if (rec) { try { rec.abort(); } catch {} }
    rec = null;
  },
};
