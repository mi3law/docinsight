// What the rebuilt text's special characters are, and how it compares with Google's own plain-text export. Docs keeps
// structure inline in the text: paragraph ends as \n, and control characters for tables, breaks and objects.

export const SPECIAL = Object.freeze({
  0x03: 'document start',
  0x0b: 'line break',
  0x0c: 'page or section break',
  0x10: 'table start',
  0x11: 'table end',
  0x12: 'table row',
  0x1c: 'table cell',
  0x1d: 'footnote or equation',
  0x1e: 'equation',
  0x1f: 'unknown (0x1f)',
});

// { 'U+0010 table start': 3, … } for every control character in the text other than \n and \t.
export function controlInventory(text) {
  const out = {};
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && c !== 0x0a && c !== 0x09) {
      const k = 'U+' + c.toString(16).toUpperCase().padStart(4, '0') + ' ' + (SPECIAL[c] || 'control');
      out[k] = (out[k] || 0) + 1;
    }
  }
  return out;
}

export function normalizeExport(x) {
  return String(x == null ? '' : x).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

// The rebuilt text as plain text: structure characters become line breaks, object placeholders disappear.
// objectAt(i) says whether the character at i is an inline object's placeholder.
export function toPlain(text, objectAt) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (objectAt && objectAt(i)) continue;
    if (c === 0x0b || c === 0x0c) out += '\n';
    else if (c === 0x03) continue;
    else if (c === 0x10 || c === 0x11 || c === 0x12 || c === 0x1c) out += '\n';
    else if (c < 0x20 && c !== 0x0a && c !== 0x09) continue;
    else out += text[i];
  }
  return out;
}

const loose = s => s.replace(/[\u0000-\u0008\u000b-\u001f*]/g, '\n').replace(/[ \t ]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
const bare = s => s.replace(/[\s\u0000-\u001f* ]+/g, '');

// Three levels of agreement, strictest first, and where the texts first differ at the strictest level that fails.
export function compareTexts(rebuilt, exported, objectAt) {
  const x = normalizeExport(exported);
  const plain = toPlain(rebuilt, objectAt);
  const res = {
    exact: plain === x || plain.replace(/\n$/, '') === x.replace(/\n$/, ''),
    loose: loose(rebuilt) === loose(x),
    bare: bare(rebuilt) === bare(x),
    rebuiltLength: rebuilt.length, exportLength: x.length,
  };
  const [a, b] = res.exact ? [null, null] : res.loose ? [plain, x] : [loose(rebuilt), loose(x)];
  if (a != null) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    res.firstDiff = { at: i, rebuilt: a.slice(Math.max(0, i - 30), i + 30), exported: b.slice(Math.max(0, i - 30), i + 30) };
  }
  return res;
}

// The shape of a string with the letters hidden: a for lower case, A for upper case, 9 for digits, the rest as is.
export const shape = s => String(s).replace(/[a-z]/g, 'a').replace(/[A-Z]/g, 'A').replace(/[0-9]/g, '9');
