// Tests for the pure functions in index.html and source guards for the manual-entry sticker page.
// Loads the code between /* @pure-start */ and /* @pure-end */ markers from the real file.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
// Normalize CRLF so the source guards pass on Windows checkouts with core.autocrlf.
const src = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
const m = src.match(/\/\* @pure-start \*\/([\s\S]*?)\/\* @pure-end \*\//);
if (!m) throw new Error('pure markers not found in index.html');

const NAMES = [
  'escapeXml', 'buildFileStamp', 'toastDurationMs', 'parseNumberInput',
  'computeStickerLayout', 'stickerFontHalfPoints', 'buildStickerDocumentXml'
];
const ctx = {};
vm.createContext(ctx);
// typeof guard: a missing function is reported by its test instead of aborting the whole suite.
vm.runInContext(m[1] + '\n;' + NAMES.map((n) => `this.${n} = typeof ${n} === 'function' ? ${n} : undefined;`).join('\n'), ctx);

let failed = 0, passed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log('PASS', name); }
  else { failed++; console.log('FAIL', name, '\n  expected', e, '\n  actual  ', a); }
}
// Like eq, but a thrown error (for example a function that does not exist yet) is a failure, not a crash.
function tryEq(name, thunk, expected) {
  let actual;
  try { actual = thunk(); } catch (err) { actual = 'THREW: ' + err.message; }
  eq(name, actual, expected);
}

// well-formedness: balanced tags (simple stack check)
function wellFormed(s) {
  const re = /<(\/?)([A-Za-z:]+)[^>]*?(\/?)>/g;
  const stack = []; let t;
  while ((t = re.exec(s))) {
    if (t[3] === '/' || t[0].startsWith('<?')) continue;
    if (t[1] === '/') { if (stack.pop() !== t[2]) return false; }
    else stack.push(t[2]);
  }
  return stack.length === 0;
}

// --- toastDurationMs: 1.5 s plus 70 ms per character, between 2.8 s and 10 s ---
tryEq('toast: empty message stays at the 2.8 s floor', () => ctx.toastDurationMs(''), 2800);
tryEq('toast: short message stays at the 2.8 s floor', () => ctx.toastDurationMs('x'.repeat(10)), 2800);
tryEq('toast: 40 characters -> 4.3 s', () => ctx.toastDurationMs('x'.repeat(40)), 4300);
tryEq('toast: 100 characters -> 8.5 s', () => ctx.toastDurationMs('x'.repeat(100)), 8500);
tryEq('toast: long message is capped at 10 s', () => ctx.toastDurationMs('x'.repeat(200)), 10000);

// --- escapeXml / buildFileStamp ---
tryEq('escapeXml: escapes & < > " and apostrophe', () => ctx.escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
tryEq('escapeXml: drops control characters XML rejects', () => ctx.escapeXml('a\u0001b\u000Bc'), 'abc');
tryEq('buildFileStamp: yyyymmdd-hhmm with zero padding', () => ctx.buildFileStamp(new Date(2026, 0, 3, 4, 5)), '20260103-0405');

// --- parseNumberInput: one phone number per line. Spaces, tabs, '-', '.', '(' and ')' are ignored.
// Valid numbers stay strings (leading zeros kept). Line numbers are 1-based against the original text. ---
const pni = (text) => ctx.parseNumberInput(text);
const EMPTY_PARSE = { valid: [], invalid: [], duplicates: [] };
tryEq('parse: plain 10 digits are valid', () => pni('0812345678').valid, ['0812345678']);
tryEq('parse: hyphenated number is valid as 10 digits', () => pni('081-234-5678').valid, ['0812345678']);
tryEq('parse: spaced number is valid as 10 digits', () => pni('081 234 5678').valid, ['0812345678']);
tryEq('parse: bracketed number is valid as 10 digits', () => pni('(081) 234-5678').valid, ['0812345678']);
tryEq('parse: dotted and tabbed number is valid as 10 digits', () => pni('081.234\t5678').valid, ['0812345678']);
tryEq('parse: leading zeros kept as a string', () => pni('0000000001').valid, ['0000000001']);
tryEq('parse: valid entries are strings',
  () => pni('0812345678\n0000000001').valid.every((v) => typeof v === 'string'), true);
tryEq('parse: blank and whitespace-only lines are skipped, not invalid',
  () => pni('\n0812345678\n\n   \n0898765432\n').invalid, []);
tryEq('parse: blank lines skipped, valid kept in order',
  () => pni('\n0812345678\n\n   \n0898765432\n').valid, ['0812345678', '0898765432']);
tryEq('parse: line numbers are 1-based against the original text',
  () => pni('0812345678\n\n08123\n\n0898765432').invalid.map((x) => x.line), [3]);
tryEq('parse: 5-digit line is invalid with digits 5',
  () => pni('08123').invalid, [{ line: 1, text: '08123', digits: 5 }]);
tryEq('parse: 11-digit line is invalid with digits 11',
  () => pni('08123456789').invalid, [{ line: 1, text: '08123456789', digits: 11 }]);
tryEq('parse: a line with letters is invalid',
  () => pni('abc0812345678').invalid, [{ line: 1, text: 'abc0812345678', digits: 10 }]);
tryEq('parse: a line with letters is not in valid', () => pni('abc0812345678').valid, []);
tryEq('parse: CRLF input is read line by line',
  () => pni('0812345678\r\n081-234-5678\r\n').valid, ['0812345678', '0812345678']);
tryEq('parse: CRLF keeps 1-based line numbers for invalid lines',
  () => pni('0812345678\r\n08123\r\n').invalid.map((x) => x.line), [2]);
tryEq('parse: invalid text is the trimmed original line', () => pni('   08123   ').invalid[0].text, '08123');
tryEq('parse: duplicates reported with counts',
  () => pni('0812345678\n0898765432\n081-234-5678').duplicates, [{ value: '0812345678', count: 2 }]);
tryEq('parse: duplicates still present twice in valid',
  () => pni('0812345678\n0898765432\n081-234-5678').valid, ['0812345678', '0898765432', '0812345678']);
tryEq('parse: duplicates in first-seen order, only counts of 2 or more',
  () => pni('0898765432\n0812345678\n0812345678\n0898765432\n0811111111').duplicates,
  [{ value: '0898765432', count: 2 }, { value: '0812345678', count: 2 }]);
tryEq('parse: empty text -> nothing', () => pni(''), EMPTY_PARSE);
tryEq('parse: null text -> nothing', () => pni(null), EMPTY_PARSE);

// --- sticker sheet (pure): A4 grid of equal cells, one number per cell ---
tryEq('sticker layout: 45x25 -> 4 cols x 11 rows = 44 per page', () => ctx.computeStickerLayout(45, 25), { cols: 4, rows: 11, perPage: 44 });
tryEq('sticker layout: 45x12 -> 4 cols x 23 rows = 92 per page', () => ctx.computeStickerLayout(45, 12), { cols: 4, rows: 23, perPage: 92 });
tryEq('sticker layout: width under 10 mm -> null', () => ctx.computeStickerLayout(9, 25), null);
tryEq('sticker layout: height under 5 mm -> null', () => ctx.computeStickerLayout(45, 4), null);
tryEq('sticker layout: wider than the usable 200 mm -> null', () => ctx.computeStickerLayout(201, 25), null);
tryEq('sticker layout: NaN width -> null', () => ctx.computeStickerLayout(NaN, 25), null);
tryEq('sticker font: 45x25 -> 42 half-points (21 pt)', () => ctx.stickerFontHalfPoints(45, 25), 42);
tryEq('sticker font: 45x12 -> 42 half-points (21 pt)', () => ctx.stickerFontHalfPoints(45, 12), 42);
tryEq('sticker font: 45x25 is an integer in 16..56',
  () => { const hp = ctx.stickerFontHalfPoints(45, 25); return Number.isInteger(hp) && hp >= 16 && hp <= 56; }, true);
tryEq('sticker font: 45x12 is an integer in 16..56',
  () => { const hp = ctx.stickerFontHalfPoints(45, 12); return Number.isInteger(hp) && hp >= 16 && hp <= 56; }, true);

const STICKER_VALUES = ['0012345678', '0000000001', '0999999999', '0812345678', '0898765432'];
let stickerXml = '';
try { stickerXml = ctx.buildStickerDocumentXml(STICKER_VALUES, 45, 25); } catch (err) { stickerXml = 'THREW: ' + err.message; }
eq('sticker xml: builds a document (XML declaration)', stickerXml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), true);
eq('sticker xml: well-formed', wellFormed(stickerXml), true);
eq('sticker xml: leading zero 0012345678 kept verbatim', stickerXml.includes('<w:t xml:space="preserve">0012345678</w:t>'), true);
eq('sticker xml: leading zero 0000000001 kept verbatim', stickerXml.includes('<w:t xml:space="preserve">0000000001</w:t>'), true);
eq('sticker xml: A4 page size', stickerXml.includes('w:pgSz w:w="11906" w:h="16838"'), true);
eq('sticker xml: exact row height', stickerXml.includes('w:hRule="exact"'), true);
eq('sticker xml: dashed cut-line borders', stickerXml.includes('w:val="dashed"'), true);
eq('sticker xml: 5 values in 4 cols -> 2 rows', (stickerXml.match(/<w:tr>/g) || []).length, 2);
eq('sticker xml: last row padded to 8 cells', (stickerXml.match(/<w:tc>/g) || []).length, 8);
const buildSticker = (...args) => { try { return ctx.buildStickerDocumentXml(...args); } catch (err) { return 'THREW: ' + err.message; } };
eq('sticker xml: escapes <&>', buildSticker(['<&>'], 45, 25).includes('&lt;&amp;&gt;'), true);
eq('sticker xml: escaped input is well-formed', wellFormed(buildSticker(['<&>'], 45, 25)), true);
tryEq('sticker xml: layout 9x25 throws',
  () => { try { ctx.buildStickerDocumentXml(STICKER_VALUES, 9, 25); return 'no throw'; } catch (e) { return 'threw'; } }, 'threw');
tryEq('sticker xml: layout 45x4 throws',
  () => { try { ctx.buildStickerDocumentXml(STICKER_VALUES, 45, 4); return 'no throw'; } catch (e) { return 'threw'; } }, 'threw');
let emptyStickerXml = '';
try { emptyStickerXml = ctx.buildStickerDocumentXml([], 45, 25); } catch (err) { emptyStickerXml = 'THREW: ' + err.message; }
eq('sticker xml: empty values -> well-formed', wellFormed(emptyStickerXml), true);
eq('sticker xml: empty values -> no table', emptyStickerXml.includes('<w:tbl>'), false);
eq('sticker xml: empty values -> still has the page setup', emptyStickerXml.includes('w:pgSz w:w="11906" w:h="16838"'), true);

// --- sticker fit: the table plus the 20-twip trailing paragraph must fit the usable A4 area
// (16272 twips high, 11340 wide). Cell sizes are read back from the generated XML. ---
const STICKER_FIT_H = [5, 7, 12, 20.5, 25, 41, 143.5, 286.5];
const STICKER_FIT_W = [10, 12.5, 45, 200];
for (const h of STICKER_FIT_H) {
  for (const w of STICKER_FIT_W) {
    tryEq(`sticker fit: ${w}x${h} fits the A4 area`, () => {
      const layout = ctx.computeStickerLayout(w, h);
      if (layout === null) return true;
      const values = Array.from({ length: layout.perPage }, (_, i) => String(i + 1).padStart(10, '0'));
      const xml = buildSticker(values, w, h);
      if (xml.startsWith('THREW')) return false;
      const cellW = Number(xml.match(/<w:gridCol w:w="(\d+)"\/>/)[1]);
      const cellH = Number(xml.match(/<w:trHeight w:val="(\d+)"/)[1]);
      const rowsInXml = (xml.match(/<w:tr>/g) || []).length;
      return rowsInXml === layout.rows && layout.rows * cellH + 20 <= 16272 && layout.cols * cellW <= 11340;
    }, true);
  }
}
// 7 mm floors to 396 twips; 41 rows (16236) + 20-twip tail fit in 16272, which Word confirms (161 values = 1 page).
tryEq('sticker fit: 45x7 gives 41 rows (counted in twips like Word)', () => ctx.computeStickerLayout(45, 7).rows, 41);
const FORTY_FIVE = Array.from({ length: 45 }, (_, i) => String(i + 1).padStart(10, '0'));
eq('sticker xml: 45 values at 45x25 -> 12 rows (11 full + 1)', (buildSticker(FORTY_FIVE, 45, 25).match(/<w:tr>/g) || []).length, 12);

// --- source guards for the manual-entry page ---
const fnBodyAt = (sig) => {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j < 0 ? undefined : j + 3);
};
eq('page: title', src.includes('<title>เลข 10 หลัก → Word สติกเกอร์</title>'), true);
eq('page: h1', src.includes('<h1>สร้างไฟล์ Word สำหรับพิมพ์สติกเกอร์เบอร์โทร</h1>'), true);
eq('page: sub-line', src.includes('<p class="muted">ทำงานในเบราว์เซอร์ ข้อมูลไม่ถูกส่งไปที่ไหน</p>'), true);
eq('page: jszip script kept', src.includes('<script src="vendor/jszip/jszip.min.js"></script>'), true);
eq('page: no ort.wasm script or reference', /ort\.wasm/.test(src), false);
eq('page: no paddle reference', /paddle/i.test(src), false);
eq('page: no Tesseract reference', /tesseract/i.test(src), false);
eq('page: no OCR wording left', /OCR/.test(src), false);
eq('page: no image upload control', /type="file"|dropzone|accept="image/.test(src), false);
eq('page: step 1 card title', src.includes('1. กรอกเบอร์'), true);
eq('page: textarea present', src.includes('<textarea id="numbers-input"'), true);
eq('page: textarea has autocomplete off', /<textarea id="numbers-input"[^>]*autocomplete="off"/.test(src), true);
eq('page: textarea has spellcheck off', /<textarea id="numbers-input"[^>]*spellcheck="false"/.test(src), true);
eq('page: textarea is not inputmode numeric', /<textarea[^>]*inputmode/.test(src), false);
eq('page: textarea label text', src.includes('พิมพ์หรือวางเบอร์ บรรทัดละ 1 เบอร์ (เว้นวรรคหรือขีดได้ เช่น 081-234-5678)'), true);
eq('page: input summary is a status region', /id="input-summary"[^>]*role="status"[^>]*aria-live="polite"/.test(src), true);
eq('page: input errors box is an alert', /id="input-errors"[^>]*class="alert error"/.test(src), true);
eq('page: input errors heading text', src.includes('บรรทัดเหล่านี้ไม่ใช่เบอร์ 10 หลัก จะไม่ถูกใส่ใน Word:'), true);
eq('page: a line with letters says so instead of a digit count', src.includes("'มีตัวอักษรปน'"), true);
eq('page: duplicates line text', src.includes('มีเบอร์ซ้ำ'), true);
eq('page: clear button is danger small', /class="btn btn-small btn-danger"/.test(src), true);
eq('page: clear button arm text', src.includes('กดอีกครั้งเพื่อยืนยันการล้าง'), true);
eq('page: clear button label', src.includes('ล้างทั้งหมด'), true);
eq('page: step 2 card title', src.includes('2. ขนาดสติกเกอร์'), true);
eq('page: step 3 download button', /<button[^>]*id="download-docx"[^>]*btn-primary/.test(src), true);
eq('page: download button label', src.includes('สร้างไฟล์ Word (.docx)'), true);
eq('page: disabled reason for no numbers', src.includes('กรอกเบอร์อย่างน้อย 1 เบอร์'), true);
eq('page: disabled reason for size', src.includes('ขนาดสติกเกอร์ไม่ถูกต้อง'), true);
eq('page: footer flow', src.includes('กรอกเบอร์ → เลือกขนาด → สร้างไฟล์ Word → พิมพ์ที่ขนาด 100%'), true);
eq('page: draft storage key', src.includes("'ocr-sticker:draft'"), true);
eq('page: size storage key', src.includes("'ocr-sticker:size'"), true);
eq('page: no grouping UI or old document builder left', src.includes('แบ่งกลุ่ม') || src.includes('buildDocumentXml'), false);

// Dialogs are suppressed in the user's browser: no confirm/alert/prompt calls.
eq('dialogs: no window.confirm/alert/prompt call', /(^|[^A-Za-z0-9_])(confirm|alert|prompt)\s*\(/.test(src), false);

// localStorage: every access sits inside a function that has a try block.
{
  const occ = [...src.matchAll(/localStorage/g)].map((x) => x.index);
  const ok = occ.length > 0 && occ.every((at) => {
    const start = src.lastIndexOf('\nfunction ', at);
    if (start < 0) return false;
    const end = src.indexOf('\n}\n', start);
    return end > at && src.slice(start, end).includes('try {');
  });
  eq('storage: every localStorage access is inside a try block', ok, true);
}

// Sticker radio fieldset (same as before).
eq('sticker: fieldset legend present', src.includes('<legend>ขนาดสติกเกอร์ (ไฟล์ Word)</legend>'), true);
eq('sticker: 45x25 radio is checked by default', src.includes('<input type="radio" name="sticker" value="45x25" checked>'), true);
eq('sticker: 45x12 radio present', src.includes('<input type="radio" name="sticker" value="45x12">'), true);
eq('sticker: custom radio present', src.includes('<input type="radio" name="sticker" value="custom">'), true);
eq('sticker: custom wrap is hidden by default', /id="sticker-custom-wrap"[^>]*\bhidden\b/.test(src), true);
eq('sticker: width input', /<input type="number" id="sticker-w"[^>]*value="45"/.test(src), true);
eq('sticker: height input', /<input type="number" id="sticker-h"[^>]*value="25"/.test(src), true);
eq('sticker: preview is a status region', src.includes('id="sticker-preview" class="muted" role="status" aria-live="polite"'), true);
eq('sticker: invalid preview style', src.includes('#sticker-preview.field-error { color: var(--error); }'), true);
eq('sticker: invalid size message', src.includes('ขนาดไม่ถูกต้อง: กว้างอย่างน้อย 10 มม. สูงอย่างน้อย 5 มม. และต้องไม่เกินหน้า A4'), true);
eq('sticker: print hint', src.includes('ก่อนพิมพ์จริง ลองพิมพ์ลงกระดาษธรรมดา 1 แผ่นแล้วทาบกับบัตรซิม · ตอนสั่งพิมพ์ให้เลือกกระดาษ A4 และขนาด 100% (ไม่ย่อให้พอดีหน้า)'), true);
eq('sticker: preview shows columns, rows and sheet count',
  fnBodyAt('function updateStickerPreview(').includes(' คอลัมน์ × ') && fnBodyAt('function updateStickerPreview(').includes(' ดวงต่อแผ่น A4'), true);

// Download: sticker XML only, size guard, disabled rules.
const dlBody = fnBodyAt('async function downloadDocx(');
eq('sticker: downloadDocx calls buildStickerDocumentXml', dlBody.includes('buildStickerDocumentXml('), true);
eq('sticker: downloadDocx refuses an invalid size with its toast', dlBody.includes('ขนาดสติกเกอร์ไม่ถูกต้อง'), true);
eq('sticker: downloadDocx names the file stickers-<stamp>.docx', dlBody.includes("'stickers-' + buildFileStamp(new Date()) + '.docx'"), true);
eq('sticker: download button disabled when no valid numbers or size invalid',
  /els\.downloadDocx\.disabled = .*currentStickerLayout\(\)/.test(src), true);
eq('sticker: render refreshes the sticker preview', fnBodyAt('function render(').includes('updateStickerPreview()'), true);

// Toast duration comes from the pure helper.
eq('toast: duration comes from toastDurationMs', fnBodyAt('function toast(').includes('toastDurationMs(message)'), true);


console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
