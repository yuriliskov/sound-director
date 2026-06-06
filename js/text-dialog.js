import { $ } from './util.js';

const dlg = $('#textDialog');
const title = $('#textDialogTitle');
const area = $('#textDialogArea');
const input = $('#textDialogInput');
const form = $('#textForm');
const cancel = $('#textCancelBtn');

let resolver = null;

function done(value) {
  if (resolver) { resolver(value); resolver = null; }
  dlg.close();
}

cancel.addEventListener('click', () => done(null));
dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const multiline = !area.hidden;
  done((multiline ? area.value : input.value));
});

// opts: { title, multiline, value, placeholder }
export function openTextDialog(opts = {}) {
  return new Promise((resolve) => {
    resolver = resolve;
    title.textContent = opts.title || 'Enter text';
    const multiline = opts.multiline !== false;
    area.hidden = !multiline;
    input.hidden = multiline;
    if (multiline) {
      area.value = opts.value || '';
      area.placeholder = opts.placeholder || 'Paste here…';
    } else {
      input.value = opts.value || '';
      input.placeholder = opts.placeholder || '';
      input.type = 'text';
    }
    dlg.showModal();
    setTimeout(() => (multiline ? area : input).focus(), 50);
  });
}
