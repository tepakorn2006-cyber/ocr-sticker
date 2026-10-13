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
  'computeStickerLayout', 'stickerFontPt', 'stickerFontHalfPoints', 'buildStickerDocumentXml',
  'escapePdfString', 'buildStickerPdf'
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

// --- sticker sheet layout (pure): A4 grid of equal cells with a gap between them (gap in mm, default 0) ---
tryEq('sticker layout: 45x25 -> 4 cols x 11 rows = 44 per page', () => ctx.computeStickerLayout(45, 25), { cols: 4, rows: 11, perPage: 44 });
tryEq('sticker layout: 45x12 -> 4 cols x 23 rows = 92 per page', () => ctx.computeStickerLayout(45, 12), { cols: 4, rows: 23, perPage: 92 });
tryEq('sticker layout: gap 0 is the same as no gap', () => ctx.computeStickerLayout(45, 25, 0), { cols: 4, rows: 11, perPage: 44 });
tryEq('sticker layout: 45x25 gap 3 -> 4 x 10 = 40', () => ctx.computeStickerLayout(45, 25, 3), { cols: 4, rows: 10, perPage: 40 });
tryEq('sticker layout: 45x12 gap 3 -> 4 x 19 = 76', () => ctx.computeStickerLayout(45, 12, 3), { cols: 4, rows: 19, perPage: 76 });
tryEq('sticker layout: 45x25 gap 10 -> 3 x 8 = 24', () => ctx.computeStickerLayout(45, 25, 10), { cols: 3, rows: 8, perPage: 24 });
tryEq('sticker layout: gap above 10 mm -> null', () => ctx.computeStickerLayout(45, 25, 10.5), null);
tryEq('sticker layout: negative gap -> null', () => ctx.computeStickerLayout(45, 25, -1), null);
tryEq('sticker layout: NaN gap -> null', () => ctx.computeStickerLayout(45, 25, NaN), null);
tryEq('sticker layout: string gap -> null', () => ctx.computeStickerLayout(45, 25, '3'), null);
tryEq('sticker layout: width under 20 mm -> null', () => ctx.computeStickerLayout(19.5, 25), null);
tryEq('sticker layout: width 20 mm is allowed', () => ctx.computeStickerLayout(20, 25) !== null, true);
{
  // Every allowed size keeps 10 digits at least 3.5 mm from each side of the label.
  let worst = Infinity;
  for (let w = 20; w <= 200; w += 0.5) for (const h of [5, 7, 12, 25, 100]) {
    if (!ctx.computeStickerLayout(w, h, 0)) continue;
    const textMm = 10 * 0.556 * ctx.stickerFontPt(w, h) * 25.4 / 72;
    worst = Math.min(worst, (w - textMm) / 2);
  }
  eq('sticker font: side margin >= 3.5 mm for every allowed size', worst >= 3.5, true);
}
tryEq('sticker layout: height under 5 mm -> null', () => ctx.computeStickerLayout(45, 4), null);
tryEq('sticker layout: wider than the usable 200 mm -> null', () => ctx.computeStickerLayout(201, 25), null);
tryEq('sticker layout: NaN width -> null', () => ctx.computeStickerLayout(NaN, 25), null);
eq('sticker layout: default gap constant is 3 mm', src.includes('const STICKER_DEFAULT_GAP_MM = 3;'), true);

// --- sticker font: pt size, digits fit the label, half-points for Word ---
tryEq('sticker font pt: 45x25 -> 18.5 pt', () => ctx.stickerFontPt(45, 25), 18.5);
tryEq('sticker font pt: 45x12 -> 18.5 pt', () => ctx.stickerFontPt(45, 12), 18.5);
tryEq('sticker font pt: tiny label floors at 6 pt', () => ctx.stickerFontPt(10, 5), 6);
tryEq('sticker font pt: capped at 28 pt', () => ctx.stickerFontPt(200, 200), 28);
tryEq('sticker font pt: 10 digits leave >= 3.5 mm each side and size >= 12 pt (45x25 and 45x12)',
  () => [[45, 25], [45, 12]].every(([w, h]) => {
    const pt = ctx.stickerFontPt(w, h);
    const textMm = 0.556 * pt * 10 * 25.4 / 72;
    return (w - textMm) / 2 >= 3.5 && pt >= 12;
  }), true);
tryEq('sticker font: 45x25 -> 37 half-points (18.5 pt)', () => ctx.stickerFontHalfPoints(45, 25), 37);
tryEq('sticker font: 45x12 -> 37 half-points (18.5 pt)', () => ctx.stickerFontHalfPoints(45, 12), 37);
tryEq('sticker font: half-points are the pt size times 2 (Word and PDF agree)',
  () => ctx.stickerFontHalfPoints(45, 25) === ctx.stickerFontPt(45, 25) * 2, true);

// --- sticker Word XML ---
const STICKER_VALUES = ['0012345678', '0000000001', '0999999999', '0812345678', '0898765432'];
const buildSticker = (...args) => { try { return ctx.buildStickerDocumentXml(...args); } catch (err) { return 'THREW: ' + err.message; } };
const FORTY_FIVE = Array.from({ length: 45 }, (_, i) => String(i + 1).padStart(10, '0'));
const DASH = 'w:val="dashed" w:sz="4" w:space="0" w:color="999999"';

const stickerXml = buildSticker(STICKER_VALUES, 45, 25);
eq('sticker xml: builds a document (XML declaration)', stickerXml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), true);
eq('sticker xml: well-formed', wellFormed(stickerXml), true);
eq('sticker xml: leading zero 0012345678 kept verbatim', stickerXml.includes('<w:t xml:space="preserve">0012345678</w:t>'), true);
eq('sticker xml: leading zero 0000000001 kept verbatim', stickerXml.includes('<w:t xml:space="preserve">0000000001</w:t>'), true);
eq('sticker xml: A4 page size', stickerXml.includes('w:pgSz w:w="11906" w:h="16838"'), true);
eq('sticker xml: exact row height', stickerXml.includes('w:hRule="exact"'), true);
eq('sticker xml: dashed cut-line borders', stickerXml.includes('w:val="dashed"'), true);
eq('sticker xml: label cell borders are dashed on all four sides, in OOXML order, before vAlign',
  stickerXml.includes('<w:tcW w:w="2551" w:type="dxa"/><w:tcBorders>' +
    '<w:top ' + DASH + '/><w:left ' + DASH + '/><w:bottom ' + DASH + '/><w:right ' + DASH + '/>' +
    '</w:tcBorders><w:vAlign w:val="center"/>'), true);
eq('sticker xml: bold Arial run at the half-point size', stickerXml.includes('<w:sz w:val="37"/><w:szCs w:val="37"/>'), true);
eq('sticker xml: no gap when gap is omitted (no gap columns)', (stickerXml.match(/<w:gridCol /g) || []).length, 4);
eq('sticker xml: 5 values in 4 cols -> 2 rows', (stickerXml.match(/<w:tr>/g) || []).length, 2);
eq('sticker xml: last row padded to 8 cells', (stickerXml.match(/<w:tc>/g) || []).length, 8);
eq('sticker xml: table borders are all nil',
  /<w:tblBorders>(<w:\w+ w:val="nil"\/>){6}<\/w:tblBorders>/.test(stickerXml), true);
eq('sticker xml: cell margins are all zero',
  stickerXml.includes('<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
    '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>'), true);
eq('sticker xml: escapes <&>', buildSticker(['<&>'], 45, 25).includes('&lt;&amp;&gt;'), true);
eq('sticker xml: escaped input is well-formed', wellFormed(buildSticker(['<&>'], 45, 25)), true);
tryEq('sticker xml: layout 9x25 throws',
  () => { try { ctx.buildStickerDocumentXml(STICKER_VALUES, 9, 25); return 'no throw'; } catch (e) { return 'threw'; } }, 'threw');
tryEq('sticker xml: layout 45x4 throws',
  () => { try { ctx.buildStickerDocumentXml(STICKER_VALUES, 45, 4); return 'no throw'; } catch (e) { return 'threw'; } }, 'threw');
tryEq('sticker xml: gap above 10 mm throws',
  () => { try { ctx.buildStickerDocumentXml(STICKER_VALUES, 45, 25, 11); return 'no throw'; } catch (e) { return 'threw'; } }, 'threw');
const emptyStickerXml = buildSticker([], 45, 25);
eq('sticker xml: empty values -> well-formed', wellFormed(emptyStickerXml), true);
eq('sticker xml: empty values -> no table', emptyStickerXml.includes('<w:tbl>'), false);
eq('sticker xml: empty values -> still has the page setup', emptyStickerXml.includes('w:pgSz w:w="11906" w:h="16838"'), true);

// Gap 3 mm at 45x25: gap columns 170 twips, table 4*2551 + 3*170 = 10714 twips wide.
const gapXml = buildSticker(STICKER_VALUES, 45, 25, 3);
eq('sticker xml gap: well-formed', wellFormed(gapXml), true);
eq('sticker xml gap: table width is cells plus gaps', gapXml.includes('<w:tblW w:w="10714" w:type="dxa"/>'), true);
eq('sticker xml gap: grid alternates label and gap columns (7 columns)', (gapXml.match(/<w:gridCol /g) || []).length, 7);
eq('sticker xml gap: gap column width is 170 twips', gapXml.includes('<w:gridCol w:w="170"/>'), true);
eq('sticker xml gap: one gap row between the two label rows (3 rows)', (gapXml.match(/<w:tr>/g) || []).length, 3);
eq('sticker xml gap: gap row height is exact 170', gapXml.includes('<w:trHeight w:val="170" w:hRule="exact"/>'), true);
eq('sticker xml gap: label row height is exact 1417', gapXml.includes('<w:trHeight w:val="1417" w:hRule="exact"/>'), true);
eq('sticker xml gap: 8 bordered label cells (2 rows of 4)', (gapXml.match(/<w:tcBorders>/g) || []).length, 8);
eq('sticker xml gap: every row has 7 cells (4 label + 3 gap)', (gapXml.match(/<w:tc>/g) || []).length, 21);
eq('sticker xml gap: gap cells have no borders',
  gapXml.includes('<w:tc><w:tcPr><w:tcW w:w="170" w:type="dxa"/></w:tcPr>'), true);
eq('sticker xml gap: gap cell paragraph is tiny with zero spacing',
  gapXml.includes('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' +
    '<w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>'), true);
eq('sticker xml gap: no gap row after the last label row',
  gapXml.slice(gapXml.lastIndexOf('<w:tr>')).includes('<w:tcBorders>'), true);
eq('sticker xml gap: gap 0 leaves no gap columns or gap rows',
  (buildSticker(STICKER_VALUES, 45, 25, 0).match(/<w:gridCol /g) || []).length, 4);

// One table per page: 45 values at 45x25 gap 3 -> 40 per page -> 2 tables and a page-break paragraph.
const pageBreakPara = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' +
  '<w:rPr><w:sz w:val="2"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:br w:type="page"/></w:r></w:p>';
const twoPages = buildSticker(FORTY_FIVE, 45, 25, 3);
eq('sticker xml pages: 45 values at gap 3 -> 2 tables', (twoPages.match(/<w:tbl>/g) || []).length, 2);
eq('sticker xml pages: well-formed', wellFormed(twoPages), true);
eq('sticker xml pages: one page-break paragraph between the tables', twoPages.split(pageBreakPara).length - 1, 1);
eq('sticker xml pages: page 1 has 10 label rows and 9 gap rows, page 2 has 2 label rows and 1 gap row (22 rows)',
  (twoPages.match(/<w:tr>/g) || []).length, 22);
eq('sticker xml pages: 48 bordered label cells (40 + 8 padded)', (twoPages.match(/<w:tcBorders>/g) || []).length, 48);
eq('sticker xml pages: no page-break paragraph after the last table',
  twoPages.indexOf(pageBreakPara, twoPages.lastIndexOf('</w:tbl>')) < 0, true);
eq('sticker xml pages: file ends with tail paragraph and sectPr',
  twoPages.endsWith('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="283" w:right="283" w:bottom="283" w:left="283" w:header="0" w:footer="0" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>'), true);

// --- sticker fit: the table plus the trailing paragraphs must fit the usable A4 area
// (16272 twips high, 11340 wide). Cell sizes are read back from the generated XML. ---
const STICKER_FIT_H = [5, 7, 12, 20.5, 25, 41, 143.5, 286.5];
const STICKER_FIT_W = [10, 12.5, 45, 200];
const STICKER_FIT_GAP = [0, 3, 10];
for (const h of STICKER_FIT_H) {
  for (const w of STICKER_FIT_W) {
    for (const gap of STICKER_FIT_GAP) {
      tryEq(`sticker fit: ${w}x${h} gap ${gap} fits the A4 area`, () => {
        const layout = ctx.computeStickerLayout(w, h, gap);
        if (layout === null) return true;
        const values = Array.from({ length: layout.perPage }, (_, i) => String(i + 1).padStart(10, '0'));
        const xml = buildSticker(values, w, h, gap);
        if (xml.startsWith('THREW')) return false;
        const gridCols = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((x) => Number(x[1]));
        const cellW = gridCols[0];
        const gapT = layout.cols > 1 && gridCols.length === 2 * layout.cols - 1 ? gridCols[1] : 0;
        const cellH = Number(xml.match(/<w:trHeight w:val="(\d+)" w:hRule="exact"\/>/)[1]);
        const labelRows = (xml.match(/<w:tcBorders>/g) || []).length / layout.cols;
        return labelRows === layout.rows &&
          layout.rows * cellH + (layout.rows - 1) * gapT + 40 <= 16272 &&
          layout.cols * cellW + (layout.cols - 1) * gapT <= 11340;
      }, true);
      tryEq(`sticker pages: ${w}x${h} gap ${gap} puts perPage+1 values on 2 tables`, () => {
        const layout = ctx.computeStickerLayout(w, h, gap);
        if (layout === null || layout.perPage > 300) return true;
        const n = layout.perPage + 1;
        const xml = buildSticker(Array.from({ length: n }, (_, i) => String(i + 1).padStart(10, '0')), w, h, gap);
        return (xml.match(/<w:tbl>/g) || []).length === Math.ceil(n / layout.perPage);
      }, true);
    }
  }
}
// 7 mm floors to 396 twips. 41 rows would be 16236 + 40 tail twips = 16276, over 16272, so 40 rows.
tryEq('sticker fit: 45x7 gives 40 rows (two tails reserved)', () => ctx.computeStickerLayout(45, 7).rows, 40);

// --- sticker PDF (pure): ASCII PDF 1.4, base-14 Helvetica-Bold, one outline per label ---
tryEq('pdf escape: parentheses and backslash are escaped', () => ctx.escapePdfString('a(b)c\\d'), 'a\\(b\\)c\\\\d');
tryEq('pdf escape: digits pass through unchanged', () => ctx.escapePdfString('0012345678'), '0012345678');

const PDF_VALUES = Array.from({ length: 45 }, (_, i) => i === 0 ? '0012345678' : String(i + 1).padStart(10, '0'));
let pdf45 = '';
try { pdf45 = ctx.buildStickerPdf(PDF_VALUES, 45, 25, 3); } catch (err) { pdf45 = ''; }
eq('pdf: starts with the PDF 1.4 header', String(pdf45).startsWith('%PDF-1.4'), true);
eq('pdf: ends with %%EOF', String(pdf45).trimEnd().endsWith('%%EOF'), true);
eq('pdf: pure ASCII (string length equals byte length)', /^[\x00-\x7F]*$/.test(String(pdf45)), true);
eq('pdf: 45 values at 45x25 gap 3 -> 2 pages', (String(pdf45).match(/\/Type \/Page(?!s)/g) || []).length, 2);
eq('pdf: leading zeros kept in the text operator', String(pdf45).includes('(0012345678) Tj'), true);
eq('pdf: font is base-14 Helvetica-Bold with WinAnsi encoding',
  String(pdf45).includes('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding'), true);
eq('pdf: A4 media box', String(pdf45).includes('/MediaBox [0 0 595.28 841.89]'), true);
eq('pdf: one dashed outline per valued label (45 values -> 45 outlines)',
  (String(pdf45).match(/ re S/g) || []).length, 45);
eq('pdf: outline operator uses dash pattern and gray stroke',
  String(pdf45).includes('0.6 G 0.6 w [2 2] 0 d '), true);
eq('pdf: font size is the stickerFontPt size', String(pdf45).includes('/F1 18.50 Tf'), true);

// Every stream /Length equals the bytes between "stream\n" and "\nendstream".
eq('pdf: every stream /Length matches its content',
  [...String(pdf45).matchAll(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)]
    .every((x) => Number(x[1]) === x[2].length) &&
  [...String(pdf45).matchAll(/\/Length (\d+) >>\nstream\n/g)].length === 2, true);

// Every xref offset points at "k 0 obj"; the startxref offset points at "xref".
try {
  const text = String(pdf45);
  const xrefAt = text.lastIndexOf('\nxref\n') + 1;
  const sx = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);
  eq('pdf: startxref points at the xref keyword', sx === xrefAt && text.startsWith('xref\n', sx), true);
  const lines = text.slice(xrefAt).split('\n');
  const size = Number(lines[1].split(' ')[1]);
  const entries = lines.slice(2, 2 + size);
  eq('pdf: xref lists size entries', entries.length === size && lines[1] === '0 ' + size, true);
  eq('pdf: free entry first', entries[0] === '0000000000 65535 f ', true);
  eq('pdf: every xref entry is 20 bytes with its line ending', entries.every((e) => e.length === 19), true);
  const okOffsets = entries.slice(1).every((e, i) => {
    const off = Number(e.slice(0, 10));
    return e.slice(10) === ' 00000 n ' && text.startsWith((i + 1) + ' 0 obj', off);
  });
  eq('pdf: every xref offset points at its "k 0 obj"', okOffsets, true);
  eq('pdf: trailer has /Size and /Root', text.includes('trailer\n<< /Size ' + size + ' /Root 1 0 R >>'), true);
} catch (err) { eq('pdf: xref section could be read', 'THREW: ' + err.message, 'ok'); }

// Td positions stay inside the 5 mm margin; the right edge of the text stays inside too.
{
  const text = String(pdf45);
  const tds = [...text.matchAll(/(-?[\d.]+) (-?[\d.]+) Td \(([^)]*)\) Tj/g)];
  const textW = 0.556 * 18.5 * 10;
  eq('pdf: 90 text positions found (45 values, each with Td and Tj)', tds.length, 45);
  eq('pdf: every Td x is at least 5 mm (14.17 pt) from the left edge', tds.every((t) => Number(t[1]) >= 14.17), true);
  eq('pdf: every text right edge is at least 5 mm from the right edge',
    tds.every((t) => Number(t[1]) + textW <= 595.28 - 14.17), true);
}

// Empty values -> a valid one-page blank PDF.
{
  const blank = typeof ctx.buildStickerPdf === 'function' ? String(ctx.buildStickerPdf([], 45, 25, 3)) : '';
  eq('pdf: empty values -> one blank page', (blank.match(/\/Type \/Page(?!s)/g) || []).length, 1);
  eq('pdf: empty values -> empty content stream', blank.includes('stream\n\nendstream'), true);
  eq('pdf: empty values -> ends with %%EOF', blank.trimEnd().endsWith('%%EOF'), true);
}
tryEq('pdf: layout 9x25 throws',
  () => { try { ctx.buildStickerPdf(PDF_VALUES, 9, 25, 3); return 'no throw'; } catch (e) { return 'threw'; } }, 'threw');
tryEq('pdf: gap 11 throws',
  () => { try { ctx.buildStickerPdf(PDF_VALUES, 45, 25, 11); return 'no throw'; } catch (e) { return 'threw'; } }, 'threw');

// --- source guards for the manual-entry page ---
const fnBodyAt = (sig) => {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j < 0 ? undefined : j + 3);
};
const tagOf = (id) => {
  const hit = src.match(new RegExp('<[a-z]+[^>]*id="' + id + '"[^>]*>'));
  return hit ? hit[0] : '';
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

// Gap input: a number field shown for every mode, under the size chips.
{
  const gapTag = tagOf('sticker-gap');
  eq('gap: number input exists', /^<input type="number"/.test(gapTag), true);
  eq('gap: input is min 0, max 10, step 0.5, default 3, decimal keyboard',
    /min="0"/.test(gapTag) && /max="10"/.test(gapTag) && /step="0.5"/.test(gapTag) &&
    /value="3"/.test(gapTag) && /inputmode="decimal"/.test(gapTag), true);
  eq('gap: label text', src.includes('<label for="sticker-gap">ช่องไฟระหว่างดวง (มม.)</label>'), true);
  const wrapStart = src.indexOf('id="sticker-custom-wrap"');
  const wrapEnd = src.indexOf('</div>', wrapStart);
  eq('gap: input is not inside the custom-size wrap (shown for all modes)',
    src.indexOf('id="sticker-gap"') > wrapEnd, true);
  eq('gap: invalid gap message', src.includes('ช่องไฟต้องอยู่ระหว่าง 0–10 มม.'), true);
  eq('gap: change listener', /els\.stickerGap\.addEventListener\('input', onStickerSettingsChange\)/.test(src), true);
  eq('gap: size settings saved with gap', fnBodyAt('function saveSizeSettings(').includes('gap:'), true);
  eq('gap: size settings restored with default 3 when missing', fnBodyAt('function restoreSettings(').includes('saved.gap'), true);
  eq('gap: getStickerSize returns gap', fnBodyAt('function getStickerSize(').includes('gap:'), true);
  eq('gap: layout uses the chosen gap', fnBodyAt('function currentStickerLayout(').includes('size.gap'), true);
  eq('gap: preview reports the gap error text', fnBodyAt('function updateStickerPreview(').includes('ช่องไฟต้องอยู่ระหว่าง 0–10 มม.'), true);
}

// Step 3: PDF is the primary button, Word is secondary; both share the disabled reason.
{
  const pdfTag = tagOf('download-pdf');
  const docxTag = tagOf('download-docx');
  eq('page: PDF button is primary', /^<button[^>]*btn-primary/.test(pdfTag) || /class="btn btn-primary"/.test(pdfTag), true);
  eq('page: PDF button label', src.includes('สร้างไฟล์ PDF (แนะนำสำหรับพิมพ์)'), true);
  eq('page: Word button is not primary', docxTag.length > 0 && !docxTag.includes('btn-primary'), true);
  eq('page: Word button label kept', src.includes('สร้างไฟล์ Word (.docx)'), true);
  eq('page: PDF button described by the reason', pdfTag.includes('aria-describedby="download-reason"'), true);
  eq('page: Word button described by the reason', docxTag.includes('aria-describedby="download-reason"'), true);
  eq('page: both buttons start disabled', pdfTag.includes('disabled') && docxTag.includes('disabled'), true);
  eq('page: disabled reason for no numbers', src.includes('กรอกเบอร์อย่างน้อย 1 เบอร์'), true);
  eq('page: disabled reason for size', src.includes('ขนาดสติกเกอร์ไม่ถูกต้อง'), true);
  eq('page: PDF button shares the disabled logic',
    /els\.downloadPdf\.disabled = .*currentStickerLayout\(\)/.test(src), true);
}

eq('page: footer flow', src.includes('กรอกเบอร์ → เลือกขนาด → สร้างไฟล์ PDF หรือ Word → พิมพ์ที่ขนาด 100%'), true);
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
eq('sticker: invalid size message', src.includes('ขนาดไม่ถูกต้อง: กว้างอย่างน้อย 20 มม. สูงอย่างน้อย 5 มม. และต้องไม่เกินหน้า A4'), true);
eq('sticker: print hint',
  src.includes('ก่อนพิมพ์จริง ลองพิมพ์ลงกระดาษธรรมดา 1 แผ่นแล้วทาบกับบัตรซิม · ตอนสั่งพิมพ์ให้เลือกกระดาษ A4 และขนาด 100% หรือ "ขนาดจริง" (ไม่ย่อให้พอดีหน้า) · ไฟล์ PDF พิมพ์ได้ขนาดตรงกว่า โดยเฉพาะจากมือถือ'), true);
eq('sticker: preview shows columns, rows and sheet count',
  fnBodyAt('function updateStickerPreview(').includes(' คอลัมน์ × ') && fnBodyAt('function updateStickerPreview(').includes(' ดวงต่อแผ่น A4'), true);

// Download: sticker XML only, size guard, disabled rules.
const dlBody = fnBodyAt('async function downloadDocx(');
eq('sticker: downloadDocx calls buildStickerDocumentXml', dlBody.includes('buildStickerDocumentXml('), true);
eq('sticker: downloadDocx passes the gap', dlBody.includes('size.gap'), true);
eq('sticker: downloadDocx refuses an invalid size with its toast', dlBody.includes('ขนาดสติกเกอร์ไม่ถูกต้อง'), true);
eq('sticker: downloadDocx names the file stickers-<stamp>.docx', dlBody.includes("'stickers-' + buildFileStamp(new Date()) + '.docx'"), true);
eq('sticker: downloadDocx saves through saveBlob', dlBody.includes('saveBlob('), true);
eq('sticker: download button disabled when no valid numbers or size invalid',
  /els\.downloadDocx\.disabled = .*currentStickerLayout\(\)/.test(src), true);

// PDF download: buildStickerPdf, its own blob type and file name, same guards.
const pdfBody = fnBodyAt('async function downloadPdf(');
eq('pdf download: function exists', pdfBody.length > 0, true);
eq('pdf download: calls buildStickerPdf with the gap', pdfBody.includes('buildStickerPdf(values, size.w, size.h, size.gap)'), true);
eq('pdf download: refuses an invalid size with the same toast', pdfBody.includes('ขนาดสติกเกอร์ไม่ถูกต้อง'), true);
eq('pdf download: PDF blob type',
  pdfBody.includes("new Blob([pdf], { type: 'application/pdf' })"), true);
eq('pdf download: file named stickers-<stamp>.pdf', pdfBody.includes("'stickers-' + buildFileStamp(new Date()) + '.pdf'"), true);
eq('pdf download: saves through saveBlob', pdfBody.includes('saveBlob('), true);
eq('pdf download: wired to the button',
  /els\.downloadPdf\.addEventListener\('click', \(\) => downloadPdf\(state\.parsed\.valid\)\)/.test(src), true);

// One save helper for both formats: the downloads capability and the <a download> fallback live only in saveBlob.
{
  const saveBody = fnBodyAt('async function saveBlob(');
  eq('save: saveBlob helper exists', saveBody.length > 0, true);
  eq('save: saveBlob takes blob, filename and count', /async function saveBlob\(blob, filename, count\)/.test(src), true);
  eq('save: downloads capability used once (inside saveBlob)', src.split("window.claude.use('downloads')").length - 1, 1);
  eq('save: saveBlob has the <a download> fallback', saveBody.includes('a.download = filename'), true);
  eq('save: saveBlob shows the same toast with the count', saveBody.includes("'สร้างไฟล์ ' + count + ' เบอร์แล้ว'"), true);
}

// Toast duration comes from the pure helper.
eq('toast: duration comes from toastDurationMs', fnBodyAt('function toast(').includes('toastDurationMs(message)'), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
