// Tests for the pure functions in index.html and source guards for the PaddleOCR migration.
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
  'extractNumbers', 'buildDocumentXml', 'applyOcrSelection', 'groupValues', 'formatGroupLabel',
  'buildPlainText', 'buildWordHtml', 'mergePasses', 'collectCandidates', 'buildImageResult',
  'sortByRows', 'sortByColumns', 'ctcDecode', 'detectComponents', 'recInputWidth', 'buildRecKeys',
  'passFromPaddle', 'withTimeout', 'sniffImageType',
  'cleanSetInput', 'applySelectionToNewRows', 'withInactivityTimeout',
  'isTextEntryTarget', 'toastDurationMs', 'cleanSetEdit',
  'computeStickerLayout', 'stickerFontHalfPoints', 'buildStickerDocumentXml'
];
// setTimeout/clearTimeout are passed in so withTimeout can use them; clearTimeout is wrapped to count cleared timers.
const timerCleared = [];
const ctx = {
  setTimeout,
  clearTimeout: (t) => { timerCleared.push(t); clearTimeout(t); }
};
vm.createContext(ctx);
// typeof guard: a missing function is reported by its test instead of aborting the whole suite.
vm.runInContext(m[1] + '\n;' + NAMES.map((n) => `this.${n} = typeof ${n} === 'function' ? ${n} : undefined;`).join('\n'), ctx);
const {
  extractNumbers, buildDocumentXml, applyOcrSelection, groupValues, formatGroupLabel, buildPlainText,
  buildWordHtml, mergePasses, collectCandidates, buildImageResult, sortByRows, sortByColumns,
  ctcDecode, detectComponents, recInputWidth, buildRecKeys, passFromPaddle, sniffImageType,
  cleanSetInput, applySelectionToNewRows
} = ctx;

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

// 1. two sets separated by a space
let r = extractNumbers('0123456789 9876543210', true);
eq('two sets on one line', r.exact, ['0123456789', '9876543210']);
eq('two sets: no near miss', r.nearMiss, []);

// 2. hyphen-grouped set
eq('hyphen grouped 3-3-4', extractNumbers('012-345-6789', true).exact, ['0123456789']);
// 3. space-grouped set
eq('space grouped 3-3-4', extractNumbers('012 345 6789', true).exact, ['0123456789']);
// 4. 11 digits -> near miss, not exact
r = extractNumbers('12345678901', true);
eq('11 digits exact', r.exact, []);
eq('11 digits near miss', r.nearMiss, ['12345678901']);
// 5. OCR confusion O -> 0 when fixing
eq('confusion O->0 with fix', extractNumbers('ID: O123456789', true).exact, ['0123456789']);
// 5b. without fix the same token is a 9-digit near miss
r = extractNumbers('ID: O123456789', false);
eq('confusion not fixed when off', r.exact, []);
eq('confusion off -> near miss 9', r.nearMiss, ['123456789']);
// 6. trailing letter does not alter the set
eq('trailing letter kept out', extractNumbers('0000000001x', true).exact, ['0000000001']);
// 7. 9 digits -> near miss
r = extractNumbers('123456789', true);
eq('9 digits exact', r.exact, []);
eq('9 digits near miss', r.nearMiss, ['123456789']);
// 8. two 10-digit groups must not be merged into one 20-digit thing
eq('two 10-digit groups stay separate', extractNumbers('0123456789-9876543210', true).exact, ['0123456789', '9876543210']);
// 9. duplicates kept in order
eq('duplicates kept', extractNumbers('0123456789\n0123456789', true).exact, ['0123456789', '0123456789']);
// 10. leading zeros are strings
eq('leading zero preserved', typeof extractNumbers('0012345678', true).exact[0], 'string');
eq('leading zero value', extractNumbers('0012345678', true).exact, ['0012345678']);
// 11. confusion mapping only in tokens with >= 6 digits
eq('short token untouched', extractNumbers('O1 0123456789', true).exact, ['0123456789']);
// 12. multi-line order preserved
eq('line order', extractNumbers('9876543210\n0123456789', true).exact, ['9876543210', '0123456789']);

// 13. confusion fix is bounded to a 10-char window (letters glued to a set)
eq('letter glued before set: Tel0812345678', extractNumbers('Tel0812345678', true).exact, ['0812345678']);
eq('letter glued after set: 0812345678s', extractNumbers('0812345678s', true).exact, ['0812345678']);
eq('confusion l inside set', extractNumbers('0l23456789', true).exact, ['0123456789']);

// 14. spaced / hyphenated groups
eq('numbered list "3 123456789" is not merged', extractNumbers('3 123456789', true).exact, []);
eq('numbered list: 9-digit remainder is near miss', extractNumbers('3 123456789', true).nearMiss, ['123456789']);
eq('hyphen 3-3-4 merges to exact', extractNumbers('081-234-5678', true).exact, ['0812345678']);
r = extractNumbers('02 123 4567', true);
eq('spaced 9 digits: not exact', r.exact, []);
eq('spaced 9 digits: near miss joined', r.nearMiss, ['021234567']);

// 14c. a spaced/hyphenated sequence that holds a run of 10+ digits is never merged: the run is read on its own
// and the 2-digit groups next to it are not joined into a 12-digit near miss.
r = extractNumbers('12 0812345678', true);
eq('10-digit run after a 2-digit group: exact', r.exact, ['0812345678']);
eq('10-digit run after a 2-digit group: no near miss', r.nearMiss, []);
r = extractNumbers('0812345678 25', true);
eq('10-digit run before a 2-digit group: exact', r.exact, ['0812345678']);
eq('10-digit run before a 2-digit group: no near miss', r.nearMiss, []);
r = extractNumbers('01-0812345678', true);
eq('hyphen: 2-digit group + 10-digit run: exact', r.exact, ['0812345678']);
eq('hyphen: 2-digit group + 10-digit run: no near miss', r.nearMiss, []);
r = extractNumbers('No 10 1234567890', true);
eq('label "No 10" + 10-digit run: exact', r.exact, ['1234567890']);
eq('label "No 10" + 10-digit run: no near miss', r.nearMiss, []);
r = extractNumbers('12 0812345678 34', true);
eq('2-digit groups on both sides of a 10-digit run: exact only', r.exact, ['0812345678']);
eq('2-digit groups on both sides of a 10-digit run: no near miss', r.nearMiss, []);
// regressions for the same inputs without a 10-digit run
eq('regression: 081 234 5678 merges', extractNumbers('081 234 5678', true).exact, ['0812345678']);
eq('regression: 081-234-5678 merges', extractNumbers('081-234-5678', true).exact, ['0812345678']);
eq('regression: 02 123 4567 stays a 9-digit near miss', extractNumbers('02 123 4567', true).nearMiss, ['021234567']);
eq('regression: two 10-digit runs separated by a space stay two exact',
  extractNumbers('0123456789 9876543210', true).exact, ['0123456789', '9876543210']);

// 14d. a run of 10+ digits is a hard separator: the groups on each side are merged on their own, the run is kept.
r = extractNumbers('123 4567 890 0812345678', true);
eq('hard separator: 3-4-3 group before a 10-digit run merges, run kept', r.exact, ['1234567890', '0812345678']);
eq('hard separator: no near miss', r.nearMiss, []);

// 14e. within a sequence an exact 10-digit merge takes priority over the near-miss join.
r = extractNumbers('081 234 5678 25', true);
eq('exact before near: 081 234 5678 25 -> exact 0812345678', r.exact, ['0812345678']);
eq('exact before near: 081 234 5678 25 -> no 12-digit near miss', r.nearMiss, []);
r = extractNumbers('25 081 234 5678', true);
eq('exact before near: 25 081 234 5678 -> exact 0812345678', r.exact, ['0812345678']);
eq('exact before near: 25 081 234 5678 -> no near miss', r.nearMiss, []);
eq('near miss still joined when no exact window: 02 123 4567', extractNumbers('02 123 4567', true).nearMiss, ['021234567']);

// 14b. 10-digit runs are exact whatever their digits: repeated digits are real (lucky) SIM numbers.
r = extractNumbers('1111111111', true);
eq('ones: all-ones 10 digits -> exact', r.exact, ['1111111111']);
eq('ones: all-ones 10 digits -> no near miss', r.nearMiss, []);
r = extractNumbers('1111571110', true);
eq('ones: 7 ones in 10 digits -> exact', r.exact, ['1111571110']);
eq('ones: 7 ones in 10 digits -> no near miss', r.nearMiss, []);
eq('ones: 0111111112 is exact', extractNumbers('0111111112', true).exact, ['0111111112']);
eq('ones: 0811111111 is exact', extractNumbers('0811111111', true).exact, ['0811111111']);
eq('ones: five ones stays exact', extractNumbers('0811111234', true).exact, ['0811111234']);
eq('ones: one 1 stays exact', extractNumbers('0885715832', true).exact, ['0885715832']);
eq('ones: exactly 7 ones and 3 other digits is exact', extractNumbers('1110111100', true).exact, ['1110111100']);
eq('ones: 9-digit run is not exact', extractNumbers('111111111', true).exact, []);
eq('ones: 9-digit run is still a near miss', extractNumbers('111111111', true).nearMiss, ['111111111']);

// 15. OCR selection by counting OCR rows in order (survives deletes)
let rows = [
  { source: 'ocr', value: '0000000001', checked: false },
  { source: 'manual', value: '1', checked: true },
  { source: 'ocr', value: '0000000002', checked: false },
  { source: 'ocr', value: '0000000003', checked: false }
];
applyOcrSelection(rows, 2);
eq('target 2 selects first two OCR rows, manual untouched', rows.map((x) => x.checked), [true, true, true, false]);
rows = [
  { source: 'ocr', value: 'A', checked: false },
  { source: 'ocr', value: 'B', checked: false },
  { source: 'ocr', value: 'C', checked: false }
];
rows = rows.slice(1);
applyOcrSelection(rows, 2);
eq('after deleting first OCR row, target 2 selects B and C', rows.map((x) => x.checked), [true, true]);
rows = [{ source: 'ocr', value: 'A', checked: false }, { source: 'ocr', value: 'B', checked: false }];
applyOcrSelection(rows, Infinity);
eq('target Infinity (all) selects every OCR row', rows.map((x) => x.checked), [true, true]);
applyOcrSelection(rows, null);
eq('invalid custom target (null) selects none', rows.map((x) => x.checked), [false, false]);

// --- cleanSetInput: the row input keeps digits only, at most 10. A pasted "081-234-5678" is read in full. ---
tryEq('cleanSetInput: separators stripped from a pasted hyphen form', () => cleanSetInput('081-234-5678'), '0812345678');
tryEq('cleanSetInput: spaces stripped from a pasted space form', () => cleanSetInput('081 234 5678'), '0812345678');
tryEq('cleanSetInput: cleaned first, then cut to 10 digits', () => cleanSetInput('0812345678 9999'), '0812345678');
tryEq('cleanSetInput: 15 digits -> first 10', () => cleanSetInput('123456789012345'), '1234567890');
tryEq('cleanSetInput: letters removed', () => cleanSetInput('08x1y2'), '0812');
tryEq('cleanSetInput: leading zeros kept as a string', () => cleanSetInput('0012'), '0012');
tryEq('cleanSetInput: empty -> empty string', () => cleanSetInput(''), '');
tryEq('cleanSetInput: null -> empty string', () => cleanSetInput(null), '');

// --- isTextEntryTarget: only text entry takes a paste as text. Radio chips, checkboxes, buttons and the page do not. ---
tryEq('paste target: textarea is text entry', () => ctx.isTextEntryTarget({ tagName: 'TEXTAREA' }), true);
tryEq('paste target: contenteditable is text entry', () => ctx.isTextEntryTarget({ tagName: 'DIV', isContentEditable: true }), true);
tryEq('paste target: text input is text entry', () => ctx.isTextEntryTarget({ tagName: 'INPUT', type: 'text' }), true);
tryEq('paste target: number input is text entry', () => ctx.isTextEntryTarget({ tagName: 'INPUT', type: 'number' }), true);
tryEq('paste target: radio chip is not text entry', () => ctx.isTextEntryTarget({ tagName: 'INPUT', type: 'radio' }), false);
tryEq('paste target: radio type in other case is not text entry', () => ctx.isTextEntryTarget({ tagName: 'INPUT', type: 'Radio' }), false);
tryEq('paste target: checkbox is not text entry', () => ctx.isTextEntryTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
tryEq('paste target: button is not text entry', () => ctx.isTextEntryTarget({ tagName: 'BUTTON' }), false);
tryEq('paste target: file input is not text entry', () => ctx.isTextEntryTarget({ tagName: 'INPUT', type: 'file' }), false);
tryEq('paste target: the page body is not text entry', () => ctx.isTextEntryTarget({ tagName: 'BODY' }), false);
tryEq('paste target: no target is not text entry', () => ctx.isTextEntryTarget(null), false);

// --- toastDurationMs: 1.5 s plus 70 ms per character, between 2.8 s and 10 s ---
tryEq('toast: empty message stays at the 2.8 s floor', () => ctx.toastDurationMs(''), 2800);
tryEq('toast: short message stays at the 2.8 s floor', () => ctx.toastDurationMs('x'.repeat(10)), 2800);
tryEq('toast: 40 characters -> 4.3 s', () => ctx.toastDurationMs('x'.repeat(40)), 4300);
tryEq('toast: 100 characters -> 8.5 s', () => ctx.toastDurationMs('x'.repeat(100)), 8500);
tryEq('toast: long message is capped at 10 s', () => ctx.toastDurationMs('x'.repeat(200)), 10000);

// --- cleanSetEdit: the row value after an edit. A typed digit that makes more than 10 digits is rejected; anything
// else is cleaned, and the caret moves back by the non-digits removed before it. ---
tryEq('edit: typed 11th digit is rejected', () => ctx.cleanSetEdit('08123456789', 11, 'insertText').reject, true);
tryEq('edit: typed digit at 10 digits is not rejected when it adds nothing', () => ctx.cleanSetEdit('0812345678', 10, 'insertText').reject, false);
tryEq('edit: pasted 11 digits are cut to 10 and the caret is clamped',
  () => ctx.cleanSetEdit('08123456789', 11, 'insertFromPaste'), { reject: false, value: '0812345678', caret: 10 });
tryEq('edit: pasted hyphen form is cleaned in full, caret after the last digit',
  () => ctx.cleanSetEdit('081-234-5678', 12, 'insertFromPaste'), { reject: false, value: '0812345678', caret: 10 });
tryEq('edit: dropped text is cut to 10 digits',
  () => ctx.cleanSetEdit('12345678901234', 14, 'insertFromDrop'), { reject: false, value: '1234567890', caret: 10 });
tryEq('edit: typed letter after 3 digits: caret stays after the 3 digits',
  () => ctx.cleanSetEdit('081a-2', 3, 'insertText'), { reject: false, value: '0812', caret: 3 });
tryEq('edit: typed letter before the first digit: caret goes to 0',
  () => ctx.cleanSetEdit('a081', 1, 'insertText'), { reject: false, value: '081', caret: 0 });
tryEq('edit: deletion is never rejected', () => ctx.cleanSetEdit('0812345678', 10, 'deleteContentBackward').reject, false);
tryEq('edit: deleting from a 12-digit row keeps the other 11 digits', () => ctx.cleanSetEdit('23456789012', 0, 'deleteContentBackward').value, '23456789012');
tryEq('edit: forward delete from a 12-digit row keeps the other 11 digits', () => ctx.cleanSetEdit('12345789012', 5, 'deleteContentForward').value, '12345789012');
tryEq('edit: typing still cuts paste to 10', () => ctx.cleanSetEdit('081-234-5678-9', 14, 'insertFromPaste').value, '0812345678');
tryEq('edit: null text -> empty value', () => ctx.cleanSetEdit(null, 0, 'insertText'), { reject: false, value: '', caret: 0 });

// --- applySelectionToNewRows: the quantity rule for the rows of one newly read image. Checked OCR rows ahead of
// the new block use up part of the quota, and the new rows fill the rest in order. Other rows keep their flags. ---
{
  const oc = (value, checked = false) => ({ source: 'ocr', value, checked });
  const mn = (value, checked = false) => ({ source: 'manual', value, checked });
  tryEq('new rows: quota 3 with 2 checked ahead -> only the first new row is checked',
    () => {
      const a = oc('A', true), b = oc('B', true), c = oc('C'), d = oc('D');
      applySelectionToNewRows([a, b, c, d], [c, d], 3);
      return [a.checked, b.checked, c.checked, d.checked];
    },
    [true, true, true, false]);
  tryEq('new rows: target all -> every new row checked',
    () => {
      const a = oc('A', true), c = oc('C'), d = oc('D');
      applySelectionToNewRows([a, c, d], [c, d], Infinity);
      return [c.checked, d.checked];
    },
    [true, true]);
  tryEq('new rows: quota used up ahead -> no new row checked',
    () => {
      const a = oc('A', true), c = oc('C'), d = oc('D');
      applySelectionToNewRows([a, c, d], [c, d], 1);
      return [c.checked, d.checked];
    },
    [false, false]);
  tryEq('new rows: invalid custom target (null) -> none checked',
    () => {
      const c = oc('C'), d = oc('D');
      applySelectionToNewRows([c, d], [c, d], null);
      return [c.checked, d.checked];
    },
    [false, false]);
  tryEq('new rows: no rows ahead -> the first two new rows are checked for quota 2',
    () => {
      const c = oc('C'), d = oc('D');
      applySelectionToNewRows([c, d], [c, d], 2);
      return [c.checked, d.checked];
    },
    [true, true]);
  tryEq('new rows: manual rows and unchecked OCR rows ahead do not use up the quota',
    () => {
      const m = mn('M', true), a = oc('A'), c = oc('C'), d = oc('D');
      applySelectionToNewRows([m, a, c, d], [c, d], 1);
      return [m.checked, a.checked, c.checked, d.checked];
    },
    [true, false, true, false]);
  tryEq('new rows: checked rows of other images keep their flags',
    () => {
      const a = oc('A', true), c = oc('C'), d = oc('D'), e = oc('E', true);
      applySelectionToNewRows([a, c, d, e], [c, d], 5);
      return [a.checked, c.checked, d.checked, e.checked];
    },
    [true, true, true, true]);
  // The total of checked OCR rows is what the quota counts, wherever the checked rows are.
  // Image A (3 checked), image B (2 new, between them), image C (2 checked): target 5 is already full.
  const abcRows = (targetB) => {
    const a = [oc('a1', true), oc('a2', true), oc('a3', true)];
    const c = [oc('c1', true), oc('c2', true)];
    const b = [oc('b1'), oc('b2')];
    const rows = [...a, ...b, ...c];
    applySelectionToNewRows(rows, b, targetB);
    return { total: rows.filter((r) => r.source === 'ocr' && r.checked).length, b: b.map((r) => r.checked) };
  };
  tryEq('new rows: A/C/B example, target 5 -> total stays at 5 and the new rows stay unchecked',
    () => { const x = abcRows(5); return [x.total, x.b]; },
    [5, [false, false]]);
  tryEq('new rows: A/C/B example, target 6 -> one new row fills the spare quota, total 6',
    () => { const x = abcRows(6); return [x.total, x.b]; },
    [6, [true, false]]);
  tryEq('new rows: A/C/B example, target all -> every new row checked',
    () => { const x = abcRows(Infinity); return [x.total, x.b]; },
    [7, [true, true]]);
  tryEq('new rows: A/C/B example, target null -> no new row checked',
    () => { const x = abcRows(null); return [x.total, x.b]; },
    [5, [false, false]]);
  tryEq('new rows: total checked never exceeds the target for targets 5..7',
    () => [5, 6, 7].every((t) => abcRows(t).total <= t),
    true);
}

// buildDocumentXml: no heading, one paragraph per number
const xml = buildDocumentXml(['0123456789', '9876543210']);
eq('xml keeps leading zero', xml.includes('<w:t xml:space="preserve">0123456789</w:t>'), true);
eq('xml declaration', xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), true);
eq('xml has sectPr', xml.includes('<w:sectPr/>'), true);
eq('xml: one paragraph per number, no heading', (xml.match(/<w:p>/g) || []).length, 2);
eq('xml: no bold heading run', xml.includes('<w:b/>'), false);
eq('xml escapes text', buildDocumentXml(['<&>']).includes('&lt;&amp;&gt;'), true);
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
eq('xml well-formed', wellFormed(xml), true);
eq('xml well-formed (escaped input)', wellFormed(buildDocumentXml(['<&>'])), true);

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

// groupValues: continuous numbering, last group may be shorter
const twelve = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(10, '0'));
const g12 = groupValues(twelve, 5);
eq('groupValues 12/5: three groups', g12.length, 3);
eq('groupValues 12/5: sizes 5,5,2', g12.map((g) => g.values.length), [5, 5, 2]);
eq('groupValues 12/5: start/end', g12.map((g) => [g.start, g.end]), [[1, 5], [6, 10], [11, 12]]);
eq('groupValues 12/5: indexes', g12.map((g) => g.index), [1, 2, 3]);
eq('groupValues keeps strings', g12[0].values[0], '0000000001');
eq('groupValues null: one group, no split', groupValues(['a', 'b'], null).map((g) => [g.index, g.start, g.end, g.values]), [[1, 1, 2, ['a', 'b']]]);
eq('groupValues 0: one group, no split', groupValues(['a', 'b'], 0).length, 1);

// buildDocumentXml with grouping
const seven = ['0000000001', '0000000002', '0000000003', '0000000004', '0000000005', '0000000006', '0000000007'];
const gx = buildDocumentXml(seven, { groupSize: 5, labelPrefix: 'กลุ่มที่' });
eq('grouped xml: 2 label paragraphs (bold)', (gx.match(/<w:b\/>/g) || []).length, 2);
eq('grouped xml: 1 border separator', (gx.match(/<w:pBdr>/g) || []).length, 1);
eq('grouped xml: border spec', gx.includes('<w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/>'), true);
eq('grouped xml: label text', gx.includes('กลุ่มที่ 1 (ลำดับ 1–5)') && gx.includes('กลุ่มที่ 2 (ลำดับ 6–7)'), true);
eq('grouped xml: Tahoma label font', gx.includes('w:ascii="Tahoma"') && gx.includes('w:cs="Tahoma"'), true);
eq('grouped xml: spacing before', gx.includes('w:before="240"'), true);
eq('grouped xml: leading zeros intact', gx.includes('<w:t xml:space="preserve">0000000001</w:t>') && gx.includes('<w:t xml:space="preserve">0000000007</w:t>'), true);
eq('grouped xml: well-formed', wellFormed(gx), true);
eq('grouped xml: label is escaped', wellFormed(buildDocumentXml(['0000000001'], { groupSize: 5, labelPrefix: '<&>' })) && buildDocumentXml(['0000000001'], { groupSize: 5, labelPrefix: '<&>' }).includes('&lt;&amp;&gt;'), true);
eq('grouped xml: null groupSize equals legacy output', buildDocumentXml(seven, { groupSize: null, labelPrefix: 'x' }), buildDocumentXml(seven));

// formatGroupLabel / plain text / Word HTML with grouping
eq('formatGroupLabel', formatGroupLabel('กลุ่มที่', { index: 2, start: 6, end: 10 }), 'กลุ่มที่ 2 (ลำดับ 6–10)');
const three = ['0000000001', '0000000002', '0000000003'];
eq('plain text grouped: label line and blank line between groups',
  buildPlainText(three, { groupSize: 2, labelPrefix: 'กลุ่มที่' }),
  'กลุ่มที่ 1 (ลำดับ 1–2)\n0000000001\n0000000002\n\nกลุ่มที่ 2 (ลำดับ 3–3)\n0000000003');
eq('plain text ungrouped equals join', buildPlainText(three, { groupSize: null }), three.join('\n'));
eq('plain text no opts equals join', buildPlainText(three), three.join('\n'));
eq('word html ungrouped: legacy paragraphs',
  buildWordHtml(['0000000001']),
  '<p style="margin:0;font-family:Consolas,monospace">0000000001</p>');
const htmlG = buildWordHtml(['0000000001', '0000000002'], { groupSize: 1, labelPrefix: '<&>' });
eq('word html grouped: one hr between two groups', (htmlG.match(/<hr>/g) || []).length, 1);
eq('word html grouped: escaped bold label', htmlG.includes('<b>&lt;&amp;&gt; 1 (ลำดับ 1–1)</b></p>'), true);

// mergePasses: candidates are {v, x, y, lh} per pass, each pass in its own reading order.
const cand = (v, x, y, lh) => ({ v, x, y, lh: lh == null ? 20 : lh });
const candS = (v, x, y, score, lh = 20, w = 60) => ({ v, x, y, lh, w, score });
const outOf = (res) => res.map((r) => [r.value, r.conflict, r.alternatives]);
const A = '0123456789', B = '9876543210', C = '1111111111';

eq('mergePasses: no candidates -> []', mergePasses([[], [], []]), []);
eq('mergePasses: three agreeing passes -> one entry, no conflict',
  outOf(mergePasses([[cand(A, 10, 10)], [cand(A, 10, 10)], [cand(A, 10, 10)]])),
  [[A, false, []]]);
eq('mergePasses: 2-vs-1 majority wins, minority is the alternative',
  outOf(mergePasses([[cand(A, 10, 10)], [cand(B, 10, 10)], [cand(A, 10, 10)]])),
  [[A, true, [B]]]);
eq('mergePasses: value found only by pass 2 is inserted by y',
  outOf(mergePasses([
    [cand(A, 10, 10), cand(C, 10, 50)],
    [cand(A, 10, 10), cand(C, 10, 50)],
    [cand(A, 10, 10), cand(B, 10, 30)]
  ])),
  [[A, false, []], [B, false, []], [C, false, []]]);
const L = ['0000000001', '0000000002', '0000000003', '0000000004', '0000000005'];
const R = ['0000000006', '0000000007', '0000000008', '0000000009', '0000000010'];
const colPass = [];
L.forEach((v, i) => colPass.push(cand(v, 10, 10 + i * 30)));
R.forEach((v, i) => colPass.push(cand(v, 200, 10 + i * 30)));
eq('mergePasses: two-column layout keeps primary reading order (L1..L5, R1..R5)',
  mergePasses([colPass, colPass, colPass]).map((r) => r.value),
  L.concat(R));
eq('mergePasses: same value at two y positions stays two entries',
  outOf(mergePasses([
    [cand(A, 10, 10), cand(A, 10, 200)],
    [cand(A, 10, 10), cand(A, 10, 200)],
    [cand(A, 10, 10), cand(A, 10, 200)]
  ])),
  [[A, false, []], [A, false, []]]);
eq('mergePasses: 1-1 tie -> lower pass index wins',
  outOf(mergePasses([[cand(A, 10, 10)], [cand(B, 10, 10)]])),
  [[A, true, [B]]]);

// --- collectCandidates: x and w come from the words holding each occurrence ---
const word = (text, x0) => ({ text, bbox: { x0, y0: 10, x1: x0 + 60, y1: 30 } });
const wordW = (text, x0, x1) => ({ text, bbox: { x0, y0: 10, x1, y1: 30 } });
const lineOf = (text, words, x0 = 0) => ({ text, bbox: { x0, y0: 10, x1: 400, y1: 30 }, words });
eq('x: value split across three words uses first word x0',
  collectCandidates([lineOf('012 345 6789', [word('012', 30), word('345', 60), word('6789', 90)])], true, 1).map((c) => c.x),
  [30]);
eq('x: repeated value on a line: k-th occurrence uses k-th word',
  collectCandidates([lineOf('0123456789 0123456789', [word('0123456789', 10), word('0123456789', 200)])], true, 1).map((c) => c.x),
  [10, 200]);
eq('x: confusion-fixed word (O for 0) gives its own x',
  collectCandidates([lineOf('ID O123456789', [word('ID', 0), word('O123456789', 40)])], true, 1).map((c) => c.x),
  [40]);
eq('x: scale divides x', collectCandidates([lineOf('0123456789', [word('0123456789', 100)])], true, 2).map((c) => c.x), [50]);
eq('x: no matching word -> line bbox x0', collectCandidates([lineOf('0123456789', [], 15)], true, 1).map((c) => c.x), [15]);

// w: the width of the box(es) holding the value
eq('w: word width is the candidate width',
  collectCandidates([lineOf('0123456789', [wordW('0123456789', 30, 90)])], true, 1).map((c) => c.w), [60]);
eq('w: value across three words spans first x0 to last x1',
  collectCandidates([lineOf('012 345 6789', [wordW('012', 30, 60), wordW('345', 60, 90), wordW('6789', 90, 150)])], true, 1).map((c) => [c.x, c.w]),
  [[30, 120]]);
eq('w: scale divides w and x',
  collectCandidates([lineOf('0123456789', [wordW('0123456789', 30, 90)])], true, 2).map((c) => [c.x, c.w]), [[15, 30]]);
eq('w: no matching word -> line bbox width',
  collectCandidates([lineOf('0123456789', [], 15)], true, 1).map((c) => c.w), [385]);

// score: each candidate carries the score of its line
const lineScored = (text, words, score) => ({ ...lineOf(text, words), score });
eq('score: candidate carries its line score',
  collectCandidates([lineScored('0123456789', [word('0123456789', 10)], 0.42)], true, 1).map((c) => c.score), [0.42]);

// --- mergePasses: entries carry y, x, lh, w; clustering picks the nearest eligible group ---
eq('mergePasses entries carry y, x, lh', mergePasses([[cand(A, 10, 20, 18)]]).map((r) => [r.y, r.x, r.lh]), [[20, 10, 18]]);
eq('cluster: candidate joins the nearest eligible group, not the first',
  outOf(mergePasses([
    [cand(A, 10, 10), cand(B, 10, 19)],
    [cand(C, 10, 18)]
  ])),
  [[A, false, []], [B, true, [C]]]);

// --- mergePasses: minScore (lowest line score among the group's members), w ---
eq('w: entries carry w', mergePasses([[candS(A, 10, 10, 0.9, 20, 77)]]).map((r) => r.w), [77]);
eq('minScore: single candidate carries its score', mergePasses([[candS(A, 10, 10, 0.8)]]).map((r) => r.minScore), [0.8]);
eq('minScore: group takes the lowest score of its members',
  mergePasses([[candS(A, 10, 10, 0.95)], [candS(A, 10, 10, 0.7)], [candS(A, 10, 10, 0.99)]]).map((r) => r.minScore),
  [0.7]);
eq('minScore: no score on candidates -> null', mergePasses([[cand(A, 10, 10)]]).map((r) => r.minScore), [null]);

// --- mergePasses: secondary-only groups are inserted next to their nearest primary group ---
const V1 = '0000000001', V2 = '0000000002', V3 = '0000000003';
eq('secondary below its nearest group lands after it',
  mergePasses([
    [cand(V1, 10, 10), cand(V2, 10, 100)],
    [cand(V1, 10, 10), cand(V3, 10, 140)]
  ]).map((r) => r.value),
  [V1, V2, V3]);
eq('secondary above the first primary group lands before it',
  mergePasses([
    [cand(V1, 10, 100), cand(V2, 10, 130)],
    [cand(V1, 10, 100), cand(V3, 10, 40)]
  ]).map((r) => r.value),
  [V3, V1, V2]);
eq('secondary right-column item lands after its right-column neighbour',
  mergePasses([
    [cand(V1, 10, 10), cand(V2, 200, 10)],
    [cand(V1, 10, 10), cand(V3, 200, 40)]
  ]).map((r) => r.value),
  [V1, V2, V3]);

// --- mergePasses: votes (passes agreeing with the winner) and support (distinct passes in the group) ---
eq('votes/support: three agreeing passes -> 3/3',
  mergePasses([[cand(A, 10, 10)], [cand(A, 10, 10)], [cand(A, 10, 10)]]).map((r) => [r.votes, r.support]),
  [[3, 3]]);
eq('votes/support: A,B,A in one group -> winner votes 2, support 3',
  mergePasses([[cand(A, 10, 10)], [cand(B, 10, 10)], [cand(A, 10, 10)]]).map((r) => [r.value, r.votes, r.support]),
  [[A, 2, 3]]);
eq('votes/support: three different values -> votes 1, support 3',
  mergePasses([[cand(A, 10, 10)], [cand(B, 10, 10)], [cand(C, 10, 10)], [], []]).map((r) => [r.votes, r.support]),
  [[1, 3]]);
eq('votes/support: single pass sighting -> votes 1, support 1',
  mergePasses([[cand(A, 10, 10)], [], [], [], []]).map((r) => [r.votes, r.support]),
  [[1, 1]]);

// --- sortByRows: per-image rows, left to right, same line when |dy| < 0.5 * min(lh) ---
const E = (value, x, y, lh = 20, w = 90) => ({ value, x, y, lh, w });
eq('sortByRows: two-per-line in column order -> row order',
  sortByRows([E('L1', 10, 10), E('L2', 10, 40), E('R1', 200, 10), E('R2', 200, 40)]).map((e) => e.value),
  ['L1', 'R1', 'L2', 'R2']);
eq('sortByRows: already row-ordered input is unchanged',
  sortByRows([E('L1', 10, 10), E('R1', 200, 10), E('L2', 10, 40), E('R2', 200, 40)]).map((e) => e.value),
  ['L1', 'R1', 'L2', 'R2']);
eq('sortByRows: dy 8 < 10 is the same line',
  sortByRows([E('R', 200, 18), E('L', 10, 10)]).map((e) => e.value),
  ['L', 'R']);
eq('sortByRows: dy 12 >= 10 is a different line, vertical order wins',
  sortByRows([E('B', 10, 22), E('A', 200, 10)]).map((e) => e.value),
  ['A', 'B']);

// --- sortByColumns: columns left to right (by mean x), top to bottom inside a column.
// Two entries share a column when their x-ranges overlap by more than half the narrower width. ---
tryEq('sortByColumns: two columns read top to bottom, left column first',
  () => sortByColumns([E('R1', 200, 10), E('L2', 10, 40), E('R2', 200, 40), E('L1', 10, 10)]).map((e) => e.value),
  ['L1', 'L2', 'R1', 'R2']);
tryEq('sortByColumns: the same input in row order is different (rows vs columns)',
  () => sortByRows([E('L1', 10, 10), E('L2', 10, 40), E('R1', 200, 10), E('R2', 200, 40)]).map((e) => e.value),
  ['L1', 'R1', 'L2', 'R2']);
tryEq('sortByColumns: columns ordered by mean x, not input order',
  () => sortByColumns([E('R', 200, 10), E('L', 10, 10)]).map((e) => e.value),
  ['L', 'R']);
tryEq('sortByColumns: overlap of 60% of the narrower width joins a column (B above A)',
  () => sortByColumns([E('A', 10, 40), E('B', 40, 10)]).map((e) => e.value),
  ['B', 'A']);
tryEq('sortByColumns: overlap of exactly 50% does not join (A stays in the left column)',
  () => sortByColumns([E('A', 10, 40), E('B', 55, 10)]).map((e) => e.value),
  ['A', 'B']);
tryEq('sortByColumns: empty input -> []', () => sortByColumns([]), []);
tryEq('sortByColumns: non-array input -> []', () => sortByColumns(null), []);

// --- buildImageResult: order option ---
const pl = (text, x0, y0, score = 0.95) => ({
  text, bbox: { x0, y0, x1: x0 + 90, y1: y0 + 20 },
  words: [{ text, bbox: { x0, y0, x1: x0 + 90, y1: y0 + 20 } }],
  score
});
const colPasses = [{ scale: 1, text: '', lines: [pl('0000000001', 10, 0), pl('0000000003', 10, 30), pl('0000000002', 200, 0)] }];
eq('buildImageResult: rows order by default', buildImageResult(colPasses, true).exact, ['0000000001', '0000000002', '0000000003']);
eq('buildImageResult: rows order', buildImageResult(colPasses, true, 'rows').exact, ['0000000001', '0000000002', '0000000003']);
tryEq('buildImageResult: columns order', () => buildImageResult(colPasses, true, 'columns').exact, ['0000000001', '0000000003', '0000000002']);
eq('ones in a pass: all-ones value is exact (buildImageResult)',
  buildImageResult([{ scale: 1, text: '', lines: [pl('1111111111', 10, 0)] }], true).exact, ['1111111111']);
eq('ones in a pass: all-ones value is not in the near list (buildImageResult)',
  buildImageResult([{ scale: 1, text: '', lines: [pl('1111111111', 10, 0)] }], true).near, []);
eq('ones in a pass: all-ones value keeps its place beside another set',
  buildImageResult([{ scale: 1, text: '', lines: [pl('1111111111', 10, 0), pl('0811111234', 10, 40)] }], true).exact,
  ['1111111111', '0811111234']);

// --- agreement rule in buildImageResult: votes >= 2 accepted; votes 1 with support >= 2 accepted and
// flagged (alternatives); support 1 goes to near, unless the image has a single pass ---
const P = (...lines) => ({ scale: 1, text: '', lines });
const agr = (...passes) => buildImageResult(passes, true);
eq('agreement: 2-of-5 is accepted', agr(P(pl(A, 10, 0)), P(pl(A, 10, 0)), P(), P(), P()).exact, [A]);
eq('agreement: 2-of-5 is not flagged', agr(P(pl(A, 10, 0)), P(pl(A, 10, 0)), P(), P(), P()).alts, [[]]);
const D = '0000000007'; // a third distinct value next to A and B
eq('agreement: 1-of-5 with support 3 is accepted and flagged',
  agr(P(pl(A, 10, 0)), P(pl(B, 10, 0)), P(pl(D, 10, 0)), P(), P()).exact, [A]);
eq('agreement: 1-of-5 with support 3 carries its alternatives',
  agr(P(pl(A, 10, 0)), P(pl(B, 10, 0)), P(pl(D, 10, 0)), P(), P()).alts, [[B, D]]);
eq('agreement: 1-of-5 with support 2 is accepted and flagged',
  agr(P(pl(A, 10, 0)), P(pl(B, 10, 0)), P(), P(), P()).alts, [[B]]);
eq('agreement: support 1 of 5 passes is not exact', agr(P(pl(A, 10, 0)), P(), P(), P(), P()).exact, []);
eq('agreement: support 1 of 5 passes goes to near', agr(P(pl(A, 10, 0)), P(), P(), P(), P()).near, [A]);
eq('agreement: support 1 of 5 passes is marked single', agr(P(pl(A, 10, 0)), P(), P(), P(), P()).nearSingle, [A]);
eq('agreement: support 1 with one total pass is accepted', agr(P(pl(A, 10, 0))).exact, [A]);
eq('agreement: one total pass -> no near entry from it', agr(P(pl(A, 10, 0))).near, []);
eq('agreement: near value equal to an accepted value is not listed',
  agr(P(pl(A, 10, 0), pl(A, 10, 200)), P(pl(A, 10, 0)), P(pl(A, 10, 0)), P(), P()).near, []);
eq('agreement: near value equal to an accepted value: exact keeps it once',
  agr(P(pl(A, 10, 0), pl(A, 10, 200)), P(pl(A, 10, 0)), P(pl(A, 10, 0)), P(), P()).exact, [A]);
eq('agreement: same single value at two places -> near once',
  agr(P(pl(A, 10, 0), pl(A, 10, 200)), P(), P(), P(), P()).near, [A]);
eq('agreement: base-pass 9-digit near stays in near, not marked single',
  agr(P(pl('123456789', 10, 0)), P(), P(), P(), P()).nearSingle, []);
eq('agreement: base-pass 9-digit near still listed',
  agr(P(pl('123456789', 10, 0)), P(), P(), P(), P()).near, ['123456789']);

// --- single pass (PaddleOCR): every value is accepted, and a low source score flags it ---
eq('single pass accepts every value (mixed scores)',
  buildImageResult([P(pl(A, 10, 0, 0.95), pl(B, 10, 40, 0.4), pl(D, 10, 80, 0.99))], true).exact,
  [A, B, D]);
tryEq('lowConf: score below 0.9 is flagged',
  () => buildImageResult([P(pl(A, 10, 0, 0.5))], true).lowConf, [true]);
tryEq('lowConf: low-confidence value has no alternatives',
  () => buildImageResult([P(pl(A, 10, 0, 0.5))], true).alts, [[]]);
tryEq('lowConf: score 0.9 is not flagged',
  () => buildImageResult([P(pl(A, 10, 0, 0.9))], true).lowConf, [false]);
tryEq('lowConf: high score is not flagged',
  () => buildImageResult([P(pl(A, 10, 0, 0.95))], true).lowConf, [false]);
tryEq('lowConf: follows the value through the chosen order',
  () => buildImageResult([P(pl(A, 10, 40, 0.5), pl(B, 10, 0, 0.95))], true).exact, [B, A]);
tryEq('lowConf: lowConf aligned with the ordered values',
  () => buildImageResult([P(pl(A, 10, 40, 0.5), pl(B, 10, 0, 0.95))], true).lowConf, [false, true]);

// --- PaddleOCR helpers (pure) ---
// Recognizer output: T frames x C classes, class 0 is the CTC blank. keys[j-1] is class j; the last key is ' '.
const K = ['a', 'b', ' '];
const blank = [0.9, 0.05, 0.03, 0.02];
const A_ = [0.1, 0.8, 0.05, 0.05];
const A2 = [0.1, 0.6, 0.2, 0.1];
const B_ = [0.1, 0.05, 0.8, 0.05];
const S_ = [0.1, 0.05, 0.05, 0.8];
const dec = (frames) => ctcDecode(frames.flat(), frames.length, 4, K);
tryEq('ctc: blank-only frames -> empty text, score 0, no char scores', () => dec([blank, blank]), { text: '', score: 0, charScores: [] });
tryEq('ctc: no frames -> empty text, score 0, no char scores', () => ctcDecode([], 0, 4, K), { text: '', score: 0, charScores: [] });
tryEq('ctc: repeated frames collapse to one char', () => dec([A_, A_, A_]).text, 'a');
tryEq('ctc: a blank between repeats keeps both chars', () => dec([A_, blank, A_]).text, 'aa');
tryEq('ctc: text and score (mean max prob per emitted char)', () => dec([blank, A_, B_, blank]), { text: 'ab', score: 0.8, charScores: [0.8, 0.8] });
tryEq('ctc: charScores has one score per char of text, in order', () => dec([A2, S_, B_]).charScores, [0.6, 0.8, 0.8]);
tryEq('ctc: charScores length equals text length', () => dec([A_, blank, A_, S_]).charScores.length, dec([A_, blank, A_, S_]).text.length);
tryEq('ctc: score averages emitted chars only, not every frame',
  () => Math.round(dec([A2, blank, B_, blank]).score * 1000), 700);
tryEq('ctc: last class (space) is emitted as a space', () => dec([A_, S_, B_]).text, 'a b');
tryEq('ctc: buildRecKeys gives one key per line plus a trailing space', () => buildRecKeys('a\nb\n'), ['a', 'b', ' ']);
tryEq('ctc: buildRecKeys handles CRLF and no trailing newline', () => buildRecKeys('a\r\nb'), ['a', 'b', ' ']);

// recInputWidth: height 48, width from the aspect ratio, clamped to [16, 1600]
tryEq('rec width: aspect ratio at height 48', () => recInputWidth(480, 48), 480);
tryEq('rec width: minimum 16', () => recInputWidth(10, 48), 16);
tryEq('rec width: maximum 1600', () => recInputWidth(100000, 48), 1600);
tryEq('rec width: rounds up', () => recInputWidth(101, 30), 162);

// detectComponents(prob, w, h): 4-neighbour components above 0.3, min side 3, mean score >= 0.6.
// Returns inclusive pixel boxes with the mean score.
const roundScore = (list) => list.map((c) => ({ ...c, score: Math.round(c.score * 1000) / 1000 }));
{
  const W = 10, H = 8;
  const map = new Array(W * H).fill(0);
  const put = (x0, y0, x1, y1, v) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map[y * W + x] = v; };
  put(1, 1, 4, 3, 0.9);  // 4 x 3 block, mean 0.9 -> kept
  put(6, 5, 8, 7, 0.5);  // 3 x 3 block, mean 0.5 -> dropped (score)
  put(6, 0, 9, 1, 0.9);  // 4 x 2 block, min side 2 -> dropped
  map[7 * W + 0] = 0.9;  // single pixel -> dropped (min side)
  tryEq('detect: keeps only blocks with min side >= 3 and mean >= 0.6',
    () => roundScore(detectComponents(map, W, H)),
    [{ x0: 1, y0: 1, x1: 4, y1: 3, score: 0.9 }]);
}
{
  const W = 8, H = 3;
  const map = new Array(W * H).fill(0);
  const put = (x0, y0, x1, y1, v) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map[y * W + x] = v; };
  put(0, 0, 2, 2, 0.7);
  put(4, 0, 6, 2, 0.95);
  tryEq('detect: two separate blocks are both kept, in scan order',
    () => roundScore(detectComponents(map, W, H)),
    [{ x0: 0, y0: 0, x1: 2, y1: 2, score: 0.7 }, { x0: 4, y0: 0, x1: 6, y1: 2, score: 0.95 }]);
}
{
  const W = 4, H = 3;
  const map = new Array(W * H).fill(0.29); // all below the 0.3 threshold
  tryEq('detect: values at or below 0.3 are ignored', () => detectComponents(map, W, H), []);
}

// passFromPaddle: detections -> the app's pass shape. Whole box is the single word; empty text skipped.
const PI = (text, x0, y0, x1, y1, score) => ({ text, score, box: { x0, y0, x1, y1 } });
const ppInput = [
  PI('0123456789', 10, 20, 100, 40, 0.97),
  PI('', 0, 0, 1, 1, 0.5),
  PI('9876543210', 10, 60, 100, 80, 0.8)
];
let pp = { scale: 1, text: '', lines: [] };
try { pp = passFromPaddle(ppInput); } catch (err) { pp = { scale: 'THREW: ' + err.message }; }
tryEq('paddle pass: scale 1', () => pp.scale, 1);
tryEq('paddle pass: text is lines joined by newline, empty box skipped', () => pp.text, '0123456789\n9876543210');
tryEq('paddle pass: line bbox and the whole box as the single word',
  () => pp.lines.map((l) => [l.text, l.bbox, l.words]),
  [
    ['0123456789', { x0: 10, y0: 20, x1: 100, y1: 40 }, [{ text: '0123456789', bbox: { x0: 10, y0: 20, x1: 100, y1: 40 } }]],
    ['9876543210', { x0: 10, y0: 60, x1: 100, y1: 80 }, [{ text: '9876543210', bbox: { x0: 10, y0: 60, x1: 100, y1: 80 } }]]
  ]);
tryEq('paddle pass: score carried on each line', () => pp.lines.map((l) => l.score), [0.97, 0.8]);
tryEq('paddle pass: empty input', () => passFromPaddle([]), { scale: 1, text: '', lines: [] });
tryEq('paddle pass: feeds buildImageResult end to end',
  () => buildImageResult([passFromPaddle([PI(A, 10, 0, 100, 20, 0.97), PI(B, 10, 40, 100, 60, 0.95)])], true).exact,
  [A, B]);

// --- per-character scores: ctcDecode -> passFromPaddle -> collectCandidates ---
tryEq('paddle pass: charScores carried into the line and its single word',
  () => {
    const p = passFromPaddle([{ text: 'AB', score: 0.5, box: { x0: 0, y0: 0, x1: 10, y1: 10 }, charScores: [0.4, 0.6] }]);
    return [p.lines[0].charScores, p.lines[0].words[0].charScores];
  },
  [[0.4, 0.6], [0.4, 0.6]]);

// A Thai line like the reported case: the rec model garbles the Thai characters (low score) while the digits are sure.
const CS_TEXT = 'ลำดับ 1 เลขที่ 0123456789 นายสมชาย';
const digitScored = (text, digitScore, otherScore) =>
  text.split('').map((ch) => (/[0-9]/.test(ch) ? digitScore : otherScore));
const csLine = (text, charScores, lineScore) =>
  passFromPaddle([{ text, score: lineScore, box: { x0: 0, y0: 0, x1: 400, y1: 20 }, charScores }]);
const candScores = (pass) => collectCandidates(pass.lines, true, 1).map((c) => c.score);

tryEq('cand score: Thai chars 0.3 and digits 0.99 -> candidate score 0.99 (line mean below 0.9)',
  () => candScores(csLine(CS_TEXT, digitScored(CS_TEXT, 0.99, 0.3), 0.6)),
  [0.99]);
tryEq('cand score: one digit of the number at 0.5 -> candidate score 0.5',
  () => {
    const cs = digitScored(CS_TEXT, 0.99, 0.3);
    cs[CS_TEXT.indexOf('0123456789') + 4] = 0.5;
    return candScores(csLine(CS_TEXT, cs, 0.6));
  },
  [0.5]);
tryEq('cand score: a low score outside the number (the digit 1 before it) is not counted',
  () => {
    const cs = digitScored(CS_TEXT, 0.99, 0.3);
    cs[CS_TEXT.indexOf(' 1 ') + 1] = 0.2;
    return candScores(csLine(CS_TEXT, cs, 0.6));
  },
  [0.99]);
tryEq('cand score: letter mapped to a digit by fixConfusions counts (O at 0.6 -> 0.6)',
  () => {
    const t = 'ID O123456789';
    const cs = digitScored(t, 0.99, 0.3);
    cs[t.indexOf('O')] = 0.6;
    return candScores(csLine(t, cs, 0.5));
  },
  [0.6]);
tryEq('cand score: digits spread over two words use the words charScores',
  () => {
    const t = '0123 456789';
    const line = {
      text: t, bbox: { x0: 0, y0: 0, x1: 200, y1: 20 }, score: 0.8,
      words: [
        { text: '0123', bbox: { x0: 0, y0: 0, x1: 40, y1: 20 }, charScores: [0.99, 0.99, 0.99, 0.99] },
        { text: '456789', bbox: { x0: 50, y0: 0, x1: 110, y1: 20 }, charScores: [0.99, 0.5, 0.99, 0.99, 0.99, 0.99] }
      ]
    };
    return collectCandidates([line], true, 1).map((c) => c.score);
  },
  [0.5]);
tryEq('cand score: charScores shorter than the text -> falls back to the line score',
  () => candScores(csLine('0123456789', [0.99], 0.42)),
  [0.42]);
tryEq('cand score: end to end, the Thai line is not flagged low confidence',
  () => {
    const r = buildImageResult([csLine(CS_TEXT, digitScored(CS_TEXT, 0.99, 0.3), 0.6)], true);
    return [r.exact, r.lowConf];
  },
  [['0123456789'], [false]]);

// --- sniffImageType: the type comes from the first bytes only (Uint8Array of up to 12 bytes) ---
const sniffOf = (arr) => sniffImageType(new Uint8Array(arr));
const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
const JPEG_JFIF = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01];
const PNG_HEAD = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D];
const WEBP_HEAD = [...ascii('RIFF'), 0x24, 0x08, 0x00, 0x00, ...ascii('WEBP')];
const heicHead = (brand) => [0x00, 0x00, 0x00, 0x18, ...ascii('ftyp'), ...ascii(brand)];

tryEq('sniff: JPEG (JFIF) signature FF D8 FF -> jpeg', () => sniffOf(JPEG_JFIF), 'jpeg');
tryEq('sniff: JPEG (EXIF) signature FF D8 FF E1 -> jpeg', () => sniffOf([0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x16, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]), 'jpeg');
tryEq('sniff: JPEG signature with only 3 bytes -> jpeg', () => sniffOf([0xFF, 0xD8, 0xFF]), 'jpeg');
tryEq('sniff: PNG signature 89 50 4E 47 0D 0A 1A 0A -> png', () => sniffOf(PNG_HEAD), 'png');
tryEq('sniff: WEBP signature RIFF....WEBP -> webp', () => sniffOf(WEBP_HEAD), 'webp');
for (const brand of ['heic', 'heix', 'mif1', 'msf1', 'hevc']) {
  tryEq('sniff: ftyp box with brand ' + brand + ' -> heic', () => sniffOf(heicHead(brand)), 'heic');
}

tryEq('sniff: empty input -> null', () => sniffOf([]), null);
tryEq('sniff: null input -> null', () => sniffImageType(null), null);
tryEq('sniff: two bytes of a JPEG start -> null', () => sniffOf([0xFF, 0xD8]), null);
tryEq('sniff: PNG signature cut to 7 bytes -> null', () => sniffOf([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A]), null);
tryEq('sniff: WEBP head cut to 11 bytes -> null', () => sniffOf(WEBP_HEAD.slice(0, 11)), null);
tryEq('sniff: HEIC head cut to 11 bytes -> null', () => sniffOf(heicHead('heic').slice(0, 11)), null);

tryEq('sniff: JPEG second byte wrong (FF D9 FF) -> null', () => sniffOf([0xFF, 0xD9, 0xFF, 0xE0]), null);
tryEq('sniff: PNG with last byte wrong -> null', () => sniffOf([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x00, 0x00, 0x00, 0x00, 0x0D]), null);
tryEq('sniff: RIFF but WAVE, not WEBP -> null', () => sniffOf([...ascii('RIFF'), 0x24, 0x08, 0x00, 0x00, ...ascii('WAVE')]), null);
tryEq('sniff: ftyp box with brand avif -> null', () => sniffOf(heicHead('avif')), null);
tryEq('sniff: ftyp box with brand mp42 -> null', () => sniffOf(heicHead('mp42')), null);
tryEq('sniff: ftyp at offset 0 instead of 4 -> null', () => sniffOf([...ascii('ftyp'), ...ascii('heic'), 0, 0, 0, 0]), null);
tryEq('sniff: GIF89a -> null', () => sniffOf(ascii('GIF89a') .concat([0x01, 0x00, 0x01, 0x00, 0x80, 0x00])), null);
tryEq('sniff: BMP header -> null', () => sniffOf([...ascii('BM'), 0x36, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00, 0x00, 0x00]), null);
tryEq('sniff: random bytes -> null', () => sniffOf([0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0, 0x11, 0x22, 0x33, 0x44]), null);
tryEq('sniff: all zero bytes -> null', () => sniffOf(new Array(12).fill(0)), null);
tryEq('sniff: plain text file -> null', () => sniffOf(ascii('Hello, world')), null);

// --- source guards: PaddleOCR engine, vendor files, UI text ---
const VENDOR = path.join(ROOT, 'vendor');
const PADDLE = path.join(VENDOR, 'paddle');
const has = (p) => fs.existsSync(p);
for (const f of ['ort.wasm.min.js', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs',
  'ch_PP-OCRv4_det_infer.onnx', 'ch_PP-OCRv4_rec_infer.onnx', 'ppocr_keys_v1.txt']) {
  eq('vendor/paddle has ' + f, has(path.join(PADDLE, f)), true);
}
const sizeOf = (f) => (has(path.join(PADDLE, f)) ? fs.statSync(path.join(PADDLE, f)).size : 0);
eq('vendor: det model is the PP-OCRv4 det (> 4 MB)', sizeOf('ch_PP-OCRv4_det_infer.onnx') > 4000000, true);
eq('vendor: rec model is the PP-OCRv4 rec (> 10 MB)', sizeOf('ch_PP-OCRv4_rec_infer.onnx') > 10000000, true);
for (const f of ['worker-wrap.js', 'worker.min.js', 'tesseract-core-simd.wasm.js', 'tesseract-core.wasm.js', 'eng.traineddata.gz.b64.txt']) {
  eq('vendor Tesseract file removed: ' + f, has(path.join(VENDOR, f)), false);
}
eq('no Tesseract reference left in index.html', /tesseract/i.test(src), false);
eq('ort script tag precedes the inline script',
  src.includes('<script src="vendor/paddle/ort.wasm.min.js"></script>') &&
  src.indexOf('<script src="vendor/paddle/ort.wasm.min.js"></script>') < src.search(/<script>\s*\/\* @pure-start/), true);
eq('engine: wasmPaths and numThreads = 1 set', /wasmPaths\s*=/.test(src) && /numThreads\s*=\s*1\b/.test(src), true);
eq('engine: ocrScales removed from the file', src.includes('ocrScales') || src.includes('OCR_TARGET_SIDES'), false);
eq('engine: the multi-scale loop is gone (one paddleRead call per image)', src.includes('ocrScales(') || src.includes('for (let j = 0; j < scales.length'), false);
eq('settings: order chip columns (value="columns") present', src.includes('name="order"') && src.includes('value="columns"'), true);
eq('settings: order chip rows checked by default', /value="rows"\s+checked/.test(src), true);
eq('settings: no reading order option left', src.includes('value="reading"'), false);
eq('settings: hint text for columns',
  src.includes('ถ้าในรูปมีหลายคอลัมน์ ให้เลือกเรียงตามคอลัมน์'), true);
eq('error: model load message names the refresh and the open-by-website requirement',
  src.includes('โหลดโมเดล OCR ไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองใหม่ (ต้องเปิดผ่านเว็บไซต์ ไม่ใช่เปิดไฟล์จากเครื่องโดยตรง)'), true);
eq('error: MODEL_LOAD_ERROR constant uses the new text',
  src.includes("const MODEL_LOAD_ERROR = 'โหลดโมเดล OCR ไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองใหม่ (ต้องเปิดผ่านเว็บไซต์ ไม่ใช่เปิดไฟล์จากเครื่องโดยตรง)';"), true);

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

// --- sticker UI (source guards) ---
eq('sticker: fieldset legend present', src.includes('<legend>ขนาดสติกเกอร์ (ไฟล์ Word)</legend>'), true);
eq('sticker: fieldset comes before the grouping fieldset',
  src.indexOf('<legend>ขนาดสติกเกอร์ (ไฟล์ Word)</legend>') > -1 &&
  src.indexOf('<legend>ขนาดสติกเกอร์ (ไฟล์ Word)</legend>') < src.indexOf('<legend>แบ่งกลุ่มตอนคัดลอก</legend>'), true);
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
eq('sticker: grouping legend renamed', src.includes('<legend>แบ่งกลุ่มตอนคัดลอก</legend>') && src.includes('aria-label="แบ่งกลุ่มตอนคัดลอก"'), true);
eq('sticker: old grouping legend text gone', src.includes('แบ่งกลุ่มในไฟล์ Word'), false);
const fnBodyAt = (sig) => {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j < 0 ? undefined : j + 3);
};
const dlBody = fnBodyAt('async function downloadDocx(');
eq('sticker: downloadDocx calls buildStickerDocumentXml', dlBody.includes('buildStickerDocumentXml('), true);
eq('sticker: downloadDocx no longer builds the grouped document', dlBody.includes('buildDocumentXml('), false);
eq('sticker: downloadDocx refuses an invalid size with its toast', dlBody.includes('ขนาดสติกเกอร์ไม่ถูกต้อง'), true);
eq('sticker: download button is also disabled for an invalid size',
  /els\.downloadDocx\.disabled = validSel === 0 \|\| !currentStickerLayout\(\)/.test(src), true);
eq('sticker: Word download button passes no group options',
  src.includes("els.downloadDocx.addEventListener('click', () => downloadDocx(selectedValidValues()));"), true);
eq('sticker: render refreshes the sticker preview', fnBodyAt('function render(').includes('updateStickerPreview()'), true);

// --- non-pure fixes (source guards): canvas release, repaint between steps, session release on failed load ---
const bodyOf = (sig) => {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j < 0 ? undefined : j + 3);
};
const detectBody = bodyOf('async function detectBoxes(');
const recBody = bodyOf('async function recognizeBox(');
const paddleBody = bodyOf('async function paddleRead(');
const engineBody = bodyOf('function getEngine()');
const readBody = bodyOf('async function readImagePasses(');
eq('canvas: detectBoxes releases its canvas in finally', /finally\s*\{[^}]*\.width = \w+\.height = 0/.test(detectBody), true);
eq('canvas: recognizeBox releases its canvas in finally', /finally\s*\{[^}]*\.width = \w+\.height = 0/.test(recBody), true);
eq('repaint: nextFrame yields via setTimeout only while visible, not rAF (rAF stalls in hidden tabs)',
  src.includes("const nextFrame = () => document.visibilityState === 'visible' ? new Promise((r) => setTimeout(r, 0)) : yieldMessage();") &&
  !/nextFrame = [^\n]*requestAnimationFrame/.test(src), true);
eq('repaint: hidden-tab yield is a MessageChannel message (background tabs do not clamp it)',
  /function yieldMessage\(\) \{[\s\S]*new MessageChannel\(\)[\s\S]*postMessage\(/.test(src), true);
eq('repaint: paddleRead awaits nextFrame after onDetect and after each onRecognize',
  (paddleBody.match(/await nextFrame\(\)/g) || []).length >= 2, true);
eq('repaint: recognition bar is (k - 1) / n before each box', readBody.includes('(k - 1) / n'), true);
eq('repaint: recognition bar reaches 1 after the last box', paddleBody.includes('onRecognized') && readBody.includes('onRecognized'), true);
eq('engine: failed load releases sessions that did load',
  /release\?\.\(\)/.test(engineBody) && engineBody.includes('Promise.allSettled'), true);
eq('progress: first-use model load text', src.includes('กำลังโหลดโมเดล OCR (ครั้งแรกประมาณ 27 MB)'), true);
eq('progress: detection text', src.includes('กำลังหาตำแหน่งข้อความ'), true);
eq('progress: recognition text', src.includes('กำลังอ่านข้อความ'), true);
eq('badge: low-confidence tooltip', src.includes('ความมั่นใจต่ำ ควรตรวจสอบ'), true);
eq('CSS: .badge-conflict uses amber tokens', /\.badge\.badge-conflict\s*\{[^}]*var\(--conflict/.test(src), true);

// --- near-miss UI (source guards) ---
eq('near summary renamed',
  src.includes('<summary>ตัวเลขที่ไม่แน่ใจ / ยาวไม่ครบหรือเกิน 10 หลัก (ไม่ถูกรวมอัตโนมัติ)</summary>'), true);
eq('near summary: old text gone', src.includes('ตัวเลขที่ยาวไม่ครบ/เกิน 10 หลัก'), false);
eq('near item note for single-pass values', src.includes('(อ่านได้จากรอบเดียว)'), true);
eq('near add button creates a row with conflict true',
  /source: 'manual', imageIndex: null, edited: false, conflict: true, alternatives: \[\], nearKey: key/.test(src), true);

// --- image acceptance by content (source guards) ---
const acceptBody = bodyOf('async function acceptFiles(');
eq('accept: file input accepts image/* and .jfif', src.includes('accept="image/*,.jfif"'), true);
eq('accept: acceptFiles is async', src.includes('async function acceptFiles('), true);
eq('accept: each file is sniffed from its first 12 bytes', src.includes('const head = file.slice(0, 12);') && src.includes('sniffImageType(new Uint8Array(bytes))'), true);
eq('sniff: falls back to FileReader when Blob.prototype.arrayBuffer is missing',
  src.includes("typeof Blob.prototype.arrayBuffer === 'function'") && src.includes('readAsArrayBuffer(') && src.includes('new FileReader()'), true);
eq('accept: sniffing feeds sniffImageType', /sniffImageType\(/.test(acceptBody) || /sniffImageType\(/.test(src), true);
eq('accept: MIME/extension check removed (validateImageFile gone)', src.includes('validateImageFile'), false);
eq('accept: ACCEPTED_TYPES gone', src.includes('ACCEPTED_TYPES'), false);
eq('accept: old MIME rejection text gone', src.includes('รองรับเฉพาะไฟล์ JPG, JPEG, PNG และ WEBP เท่านั้น'), false);
eq('accept: old extension mismatch text gone', src.includes('นามสกุลไฟล์ไม่ตรงกับชนิดของรูปภาพ'), false);
eq('accept: running guard kept at entry', /async function acceptFiles\(files\) \{\s*if \(state\.running\) \{/.test(src), true);
eq('accept: files processed in order, awaited one at a time',
  acceptBody.includes('for (const file of files)') && acceptBody.includes('await ') && !acceptBody.includes('Promise.all'), true);
eq('accept: HEIC toast text', src.includes('ไฟล์ HEIC ยังไม่รองรับ: ') &&
  src.includes(' — กรุณาแปลงเป็น JPG หรือส่งรูปผ่านแอปที่แปลงให้อัตโนมัติ'), true);
eq('accept: skipped toast text kept', src.includes("'ข้ามไฟล์ที่ไม่รองรับ: '"), true);

// --- ones: the legacy junk filter is gone (source guards) ---
eq('ones: isLegacyJunkRun removed', src.includes('isLegacyJunkRun'), false);
eq('ones: no junk filter comment left', /junk/i.test(src), false);
eq("ones: no legacy engine ones comment left", src.includes("runs of '1'") || src.includes('legacy OCR engine'), false);

// --- stop button, run token, timeouts, safety net (source guards) ---
const startBody = bodyOf('async function startReading(');
const stopBody = bodyOf('function stopReading()');
const safetyBody = bodyOf('function onUnexpectedError(');
eq('stop: button id stop-ocr labelled หยุด, after run-btn and before rerun-all-btn',
  /<button type="button" id="stop-ocr"[^>]*>หยุด<\/button>/.test(src) &&
  src.indexOf('id="stop-ocr"') > src.indexOf('id="run-btn"') && src.indexOf('id="stop-ocr"') < src.indexOf('id="rerun-all-btn"'), true);
eq('stop: button starts hidden', /id="stop-ocr"[^>]*\bhidden\b/.test(src), true);
eq('stop: els.stopBtn is bound to #stop-ocr', src.includes("stopBtn: $('#stop-ocr')"), true);
eq('stop: click calls stopReading', src.includes("els.stopBtn.addEventListener('click', stopReading)"), true);
eq('stop: updateControls shows and enables stop only while running',
  /els\.stopBtn\.hidden\s*=\s*!busy/.test(src) && /els\.stopBtn\.disabled\s*=\s*!busy/.test(src), true);
eq('stop: state has runId and cancelRequested', /runId:\s*0,/.test(src) && /cancelRequested:\s*false,/.test(src), true);
eq('stop: CancelledError class is defined', src.includes('class CancelledError extends Error'), true);
eq('stop: stopReading sets cancelRequested and reads หยุดการอ่านแล้ว',
  stopBody.includes('state.cancelRequested = true') && stopBody.includes('หยุดการอ่านแล้ว'), true);
eq('stop: stopReading returns to idle through endRunForUi', stopBody.includes('endRunForUi()'), true);
eq('stop: stopReading returns the reading image to wait', stopBody.includes("'wait'"), true);
eq('stop: paddleRead checks cancellation between boxes and throws CancelledError',
  paddleBody.includes('throw new CancelledError()') && paddleBody.includes('isCancelled') && /for \(let k/.test(paddleBody), true);
eq('stop: readImagePasses takes an isCancelled check', readBody.includes('isCancelled'), true);
eq('stop: startReading treats CancelledError as a silent stop', startBody.includes('instanceof CancelledError'), true);
eq('finally: startReading takes a run token', /const runId = \+\+state\.runId;/.test(startBody), true);
eq('finally: startReading finally only ends its own run', /finally\s*\{\s*if \(runId === state\.runId\)/.test(startBody), true);
eq('timeout: engine timeout is 180000 ms with its message',
  src.includes('ENGINE_TIMEOUT_MS = 180000') && src.includes("ENGINE_TIMEOUT_TEXT = 'โหลดโมเดล OCR นานเกินไป กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'"), true);
eq('timeout: image timeout is 120000 ms with its message',
  src.includes('IMAGE_TIMEOUT_MS = 120000') && src.includes("IMAGE_TIMEOUT_TEXT = 'อ่านรูปนี้นานเกินไป'"), true);
eq('timeout: getEngine wraps the load in withTimeout and resets enginePromise on failure',
  engineBody.includes('withTimeout(') && engineBody.includes('enginePromise = null'), true);
eq('timeout: each image read runs under an inactivity timeout re-armed by progress',
  /withInactivityTimeout\(\s*\(touch\) => readImagePasses\(/.test(startBody) && startBody.includes('IMAGE_TIMEOUT_MS') &&
  startBody.includes('() => job.cancelled || stale(), touch)'), true);
eq('timeout: a timed-out image is marked error and the loop goes on', /catch \(err\) \{[\s\S]*img\.status = 'error'/.test(startBody), true);
eq('safety net: unhandledrejection listener', src.includes("window.addEventListener('unhandledrejection'"), true);
eq('safety net: error listener', src.includes("window.addEventListener('error'"), true);
eq('safety net: handler logs with console.error', safetyBody.includes('console.error'), true);
eq('safety net: handler ignores CancelledError', safetyBody.includes('CancelledError'), true);

// --- review fixes (source guards): each guard fails until its fix is in place ---
{
  const rowsNow = bodyOf('function renderRows(');
  const rawNow = bodyOf('function renderRaw(');
  const finishNow = bodyOf('function finishImage(');
  const removeNow = bodyOf('async function removeImage(');
  const moveNow = bodyOf('function moveImage(');
  const addOcrNow = bodyOf('function addOcrRows(');
  const imgsNow = bodyOf('function renderImages(');
  const safetyNow = bodyOf('function onUnexpectedError(');

  // Item 2 (revised): the global paste handler lets text entry paste as text. Only text entry is left to the browser;
  // a radio chip, a checkbox or the page takes an image paste even when the clipboard also has text.
  const pStart = src.indexOf("document.addEventListener('paste'");
  const pEnd = pStart < 0 ? -1 : src.indexOf('els.clearImagesBtn.addEventListener', pStart);
  const pasteBlock = pEnd < 0 ? '' : src.slice(pStart, pEnd);
  const at = (s) => pasteBlock.indexOf(s);
  eq('paste: the target is checked with isTextEntryTarget',
    at('isTextEntryTarget(e.target)') > -1, true);
  eq('paste: the target check comes before preventDefault',
    at('isTextEntryTarget(e.target)') > -1 && at('isTextEntryTarget(e.target)') < at('e.preventDefault()'), true);
  eq('paste: text/plain no longer blocks an image paste on a non-text target', !pasteBlock.includes("getData('text/plain')"), true);
  eq('paste: text entry returns before any image is taken',
    /if \(isTextEntryTarget\(e\.target\)\) return;/.test(pasteBlock), true);

  // Item 3: acceptFiles re-checks the run flag after each await and stops; the dropzone hint names .jfif
  eq('accept: the run flag is re-checked after each sniff await, and the loop stops',
    /await sniffFile\(file\);\s*if \(state\.running\) \{[\s\S]*?break;/.test(acceptBody), true);
  eq('accept: a single toast covers the blocked batch', (acceptBody.match(/toast\(/g) || []).length, 2);
  eq('accept: dropzone hint names the .jfif support',
    src.includes('<p class="muted">รองรับ JPG, PNG, WEBP (รวมไฟล์ .jfif) · เลือกได้หลายรูป</p>'), true);
  eq('accept: old dropzone hint gone', src.includes('รองรับ JPG, JPEG, PNG, WEBP (เลือกได้หลายรูป)'), false);

  // Item 4: the image deadline is an inactivity timeout re-armed by progress; nextFrame keeps its rAF note
  eq('repaint: nextFrame keeps the note on why it is not rAF',
    src.includes('// Not requestAnimationFrame: it never fires in a hidden tab, which would stall reading.'), true);
  eq('timeout: readImagePasses takes an onProgress argument',
    /async function readImagePasses\(file, pos, total, isCancelled, onProgress\)/.test(src), true);
  eq('timeout: readImagePasses hands onProgress to paddleRead', readBody.includes('onProgress'), true);
  eq('timeout: paddleRead reports progress after detection and after each box',
    (paddleBody.match(/h\.onProgress\(\)/g) || []).length >= 2, true);

  // Item 5: rows rebuilt during a run keep the focus and caret of the row being typed in; raw <details> keep state
  eq('focus: renderRows remembers the focused row control (row id and kind)',
    rowsNow.includes('document.activeElement') && rowsNow.includes('dataset.rowControl') && rowsNow.includes('dataset.rowFor'), true);
  eq('focus: the row value input is marked with its row id and kind',
    /input\.dataset\.rowFor = String\(row\.id\)/.test(rowsNow) && /input\.dataset\.rowControl = 'value'/.test(rowsNow), true);
  eq('focus: checkbox, copy and delete buttons carry their row id and kind',
    /cb\.dataset\.rowFor = String\(row\.id\)/.test(rowsNow) && /cb\.dataset\.rowControl = 'check'/.test(rowsNow) &&
    /copyBtn\.dataset\.rowFor = String\(row\.id\)/.test(rowsNow) && /copyBtn\.dataset\.rowControl = 'copy'/.test(rowsNow) &&
    /delBtn\.dataset\.rowFor = String\(row\.id\)/.test(rowsNow) && /delBtn\.dataset\.rowControl = 'delete'/.test(rowsNow), true);
  eq('focus: the restore looks the control up by row id and kind', rowsNow.includes('[data-row-control='), true);
  eq('focus: caret is restored with setSelectionRange from selectionStart and selectionEnd',
    rowsNow.includes('setSelectionRange(') && rowsNow.includes('selectionStart') && rowsNow.includes('selectionEnd'), true);
  eq('details: open raw-OCR state is a Set in state', /rawOpenIds:\s*new Set\(\)/.test(src), true);
  eq('details: renderRaw re-applies open state by image id', rawNow.includes('rawOpenIds.has(img.id)'), true);
  eq('details: renderRaw records toggles', rawNow.includes("addEventListener('toggle'"), true);

  // Item 6: no maxLength on the row input; the input handler cleans the text first
  eq('row input: no maxLength (a pasted separator form is cleaned, not cut)', /maxLength/.test(rowsNow), false);
  eq('row input: each edit goes through cleanSetEdit', rowsNow.includes('cleanSetEdit(input.value, input.selectionStart, e.inputType)'), true);
  eq('row input: the caret before each edit is tracked with beforeinput', rowsNow.includes("addEventListener('beforeinput'"), true);
  eq('row input: a rejected typed digit restores the previous value and caret',
    rowsNow.includes('edit.reject') && rowsNow.includes('input.value = prevValue') && rowsNow.includes('setSelectionRange(prevCaret'), true);

  // Item 7: finishImage applies the quantity rule to the new rows only; removeImage and moveImage keep flags
  eq('selection: finishImage applies the rule to the new rows only',
    finishNow.includes('applySelectionToNewRows(') && !finishNow.includes('applySelection()'), true);
  eq('selection: addOcrRows returns the rows it added', addOcrNow.includes('return added;'), true);
  eq('selection: removeImage keeps the checked flags', !removeNow.includes('applySelection()'), true);
  eq('selection: moveImage keeps the checked flags', !moveNow.includes('applySelection()'), true);
  eq('selection: quantity change still re-applies to all rows', bodyOf('function onQuantityChange(').includes('applySelection()'), true);
  eq('selection: full rebuild still re-applies to all rows', bodyOf('function rebuildFromPasses(').includes('applySelection()'), true);

  // Item 8: focus after a row delete and after an image move
  eq('focus: row delete moves focus to the next row, else the previous row, else add-row',
    src.includes('function focusAfterRowDelete(') && src.includes("'.btn-del-row'") && src.includes('els.addRow.focus()'), true);
  eq('focus: row delete button carries btn-del-row',
    rowsNow.includes("delBtn.className = 'btn btn-small btn-danger btn-del-row'"), true);
  eq('focus: row delete hands the removed index to focusAfterRowDelete', rowsNow.includes('focusAfterRowDelete('), true);
  eq('focus: moveImage re-focuses the moved image move button',
    moveNow.includes('focusImageMove(') && src.includes('function focusImageMove('), true);
  eq('focus: image move buttons carry the image id and direction',
    imgsNow.includes('dataset.imageId') && imgsNow.includes('dataset.move'), true);

  // Item 6 (revised): a focused Stop button moves focus to the run button when it hides at the end of a run
  const endNow = bodyOf('function endRunForUi(');
  eq('focus: a focused stop button moves focus to the run button when it hides',
    endNow.includes('stopHadFocus') && endNow.includes('els.stopBtn.hidden') && endNow.includes('els.runBtn'), true);

  // Item 5 (revised): calls to acceptFiles are serialized through acceptQueue
  const bindNow = bodyOf('function bindUpload(');
  eq('accept queue: acceptQueue starts resolved', src.includes('let acceptQueue = Promise.resolve();'), true);
  eq('accept queue: enqueueAccept chains acceptFiles through the queue',
    src.includes('acceptQueue = acceptQueue.then(() => acceptFiles(files))'), true);
  eq('accept queue: the three upload handlers go through enqueueAccept',
    bindNow.split('enqueueAccept(').length - 1 === 3 && !bindNow.includes('acceptFiles('), true);

  // Toast duration grows with the message (pure helper toastDurationMs)
  eq('toast: duration comes from toastDurationMs', bodyOf('function toast(').includes('toastDurationMs(message)'), true);

  // Item 9: empty or invalid custom values say what to enter
  eq('custom qty: summary message for an empty, zero or negative value',
    src.includes('กรุณาใส่จำนวนเต็มตั้งแต่ 1 ขึ้นไป (ผลจากรูปจะไม่ถูกเลือกจนกว่าจะใส่จำนวนที่ถูกต้อง)'), true);
  eq('custom qty: old message gone', src.includes('กรุณาใส่จำนวนชุดอย่างน้อย 1'), false);
  eq('custom group: preview says grouping is off until a value is entered',
    src.includes('กรุณาใส่จำนวนเต็มตั้งแต่ 1 ขึ้นไป (ตอนนี้จะไม่แบ่งกลุ่ม)'), true);
  eq('custom group: old preview text gone', src.includes('กรอกจำนวนต่อกลุ่มอย่างน้อย 1 เพื่อแบ่งกลุ่ม'), false);
  eq('custom group: earlier preview text gone', src.includes('กรุณาใส่จำนวนต่อกลุ่มอย่างน้อย 1'), false);
  eq('custom group: preview is a status region', src.includes('id="group-preview" class="muted" role="status"'), true);
  eq('custom group: invalid preview gets the field-error style',
    src.includes("els.groupPreview.classList.toggle('field-error', invalid)") && src.includes('#group-preview.field-error'), true);

  // Item 10: danger confirm focuses Cancel; the danger button has its own tokens with >= 4.5:1 contrast
  eq('dialog: danger focuses Cancel by default', /o\.danger \? cancelBtn : okBtn\)\.focus\(\)/.test(src), true);
  eq('dialog: danger button uses the danger tokens',
    src.includes('.btn-ok.danger { background: var(--danger-solid); color: var(--danger-solid-text); }'), true);
  // WCAG 2 relative luminance and contrast ratio, computed here from the hex values written in the CSS.
  const lumOf = (hex) => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratioOf = (a, b) => {
    const la = lumOf(a), lb = lumOf(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const dangerPairs = [...src.matchAll(/--danger-solid:\s*(#[0-9a-fA-F]{6});\s*--danger-solid-text:\s*(#[0-9a-fA-F]{6});/g)]
    .map((mm) => [mm[1], mm[2]]);
  eq('contrast: a danger token pair in each of the three theme blocks', dangerPairs.length, 3);
  eq('contrast: every danger pair is at least 4.5:1',
    dangerPairs.length === 3 && dangerPairs.every(([bg, fg]) => ratioOf(bg, fg) >= 4.5), true);

  // Item 11: unexpected errors reset reading images; clear-results is off while running; engineReady flag
  eq('safety net: reading images go back to wait',
    safetyNow.includes("img.status === 'reading'") && safetyNow.includes("img.status = 'wait'"), true);
  eq('clear results is disabled while a run is active', /els\.clearResults\.disabled = busy \|\|/.test(src), true);
  eq('engine: engineReady flag starts false', /let engineReady = false;/.test(src), true);
  eq('engine: engineReady is set when getEngine resolves', bodyOf('function getEngine()').includes('engineReady = true;'), true);
  eq('progress: model loading text is keyed on engineReady', startBody.includes('if (!engineReady) showProgress(MODEL_LOADING_TEXT, 0);'), true);

  // Item 12: JSZip is vendored, not loaded from the CDN
  const jszipFile = path.join(VENDOR, 'jszip', 'jszip.min.js');
  eq('jszip: vendor/jszip/jszip.min.js exists', has(jszipFile), true);
  eq('jszip: the vendored file is JSZip 3.10.1',
    has(jszipFile) && fs.readFileSync(jszipFile, 'utf8').includes('JSZip v3.10.1'), true);
  eq('jszip: script tag points at the vendored file', src.includes('<script src="vendor/jszip/jszip.min.js"></script>'), true);
  eq('jszip: no CDN jszip tag left', /cdnjs\.cloudflare\.com\/ajax\/libs\/jszip/.test(src), false);
}

// --- withTimeout (async): rejects with Error(message) if the promise does not settle within ms ---
(async () => {
  const later = (ms, value, fail) => new Promise((res, rej) => setTimeout(() => (fail ? rej(fail) : res(value)), ms));
  // Reports ['ok', value] or ['err', name, message]; a synchronous throw from the thunk is reported as well.
  const outcome = async (thunk) => {
    try { return ['ok', await thunk()]; } catch (err) { return ['err', err.name, err.message]; }
  };
  const atEq = async (name, thunk, expected) => { eq(name, await outcome(thunk), expected); };

  await atEq('withTimeout: fast promise resolves with its value',
    () => ctx.withTimeout(later(5, 'done'), 200, 'slow'), ['ok', 'done']);
  await atEq('withTimeout: slow promise rejects with Error(message) after ms',
    () => ctx.withTimeout(later(150, 'late'), 20, 'อ่านช้าเกินไป'), ['err', 'Error', 'อ่านช้าเกินไป']);
  await atEq('withTimeout: rejection before the deadline passes through unchanged',
    () => ctx.withTimeout(later(5, null, new Error('boom')), 200, 'slow'), ['err', 'Error', 'boom']);
  await atEq('withTimeout: a non-promise value resolves with itself',
    () => ctx.withTimeout(42, 200, 'slow'), ['ok', 42]);
  timerCleared.length = 0;
  await atEq('withTimeout: fast promise under a long deadline resolves',
    () => ctx.withTimeout(later(5, 'quick'), 60000, 'slow'), ['ok', 'quick']);
  eq('withTimeout: deadline timer is cleared once the promise settles', timerCleared.length, 1);

  // withInactivityTimeout(work, ms, message): work(touch) runs; each touch() re-arms the deadline, so the promise
  // rejects with Error(message) only after ms with no touch.
  await atEq('inactivity: work that touches within each window resolves past the total time',
    () => ctx.withInactivityTimeout(async (touch) => {
      for (let i = 0; i < 6; i++) { await later(40, null); touch(); }
      return 'done';
    }, 150, 'อ่านรูปนี้นานเกินไป'), ['ok', 'done']);
  await atEq('inactivity: no touch within ms rejects with Error(message)',
    () => ctx.withInactivityTimeout(() => later(300, 'late'), 40, 'อ่านรูปนี้นานเกินไป'),
    ['err', 'Error', 'อ่านรูปนี้นานเกินไป']);
  await atEq('inactivity: rejection from the work passes through',
    () => ctx.withInactivityTimeout(() => later(5, null, new Error('boom')), 200, 'slow'), ['err', 'Error', 'boom']);
  await atEq('inactivity: synchronous throw in the work rejects with that error',
    () => ctx.withInactivityTimeout(() => { throw new Error('sync'); }, 200, 'slow'), ['err', 'Error', 'sync']);
  await atEq('inactivity: a non-promise result resolves with itself',
    () => ctx.withInactivityTimeout(() => 42, 200, 'slow'), ['ok', 42]);
  timerCleared.length = 0;
  await atEq('inactivity: fast work under a long window resolves',
    () => ctx.withInactivityTimeout(() => later(5, 'quick'), 60000, 'slow'), ['ok', 'quick']);
  eq('inactivity: the deadline timer is cleared once settled', timerCleared.filter((t) => t != null).length >= 1, true);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
