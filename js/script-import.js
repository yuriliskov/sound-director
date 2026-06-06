// Turn a .docx / .txt File (or pasted text) into an array of script lines.
// Each line: { i, type:'scene'|'stage'|'line', text }

const SCENE_RE = /^(сцена|действие|картина|акт|пролог|эпилог)\b/i;

function classify(text) {
  const t = text.trim();
  if (SCENE_RE.test(t)) return 'scene';
  // Stage direction heuristic: whole line wrapped in parentheses, or
  // descriptive narration with no SCREAMING-CAPS speaker prefix.
  if (/^\(.*\)$/.test(t)) return 'stage';
  return 'line';
}

export function textToLines(raw) {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(s => s.replace(/ /g, ' ').trimEnd())
    .filter(s => s.trim() !== '')
    .map((text, i) => ({ i, type: classify(text), text }));
}

export async function parseDocx(file) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded — cannot read .docx');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const docXml = zip.file('word/document.xml');
  if (!docXml) throw new Error('Not a valid .docx (missing word/document.xml)');
  let xml = await docXml.async('string');

  // Convert structure to plain text: paragraphs -> newlines, tabs, line breaks.
  xml = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n');

  // Extract only the visible run text inside <w:t>…</w:t>, in order.
  let out = '';
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<\/w:p>|\n|\t/g;
  // Simpler & robust: strip all tags but keep the newlines/tabs we injected.
  out = xml.replace(/<[^>]+>/g, '');
  out = decodeEntities(out);
  return textToLines(out);
}

export async function parseFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.docx')) return parseDocx(file);
  if (name.endsWith('.txt') || file.type.startsWith('text/')) {
    return textToLines(await file.text());
  }
  // last resort: try as text
  return textToLines(await file.text());
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
