# เลข 10 หลัก → Word สติกเกอร์ — agent notes

Single-page web app for Thai, non-technical users. The user types or pastes phone numbers (one per line), the page checks that each is exactly 10 digits, and it exports a PDF (recommended for printing) and a `.docx`, both laid out for A4 sticker-label sheets (one number per label, with a cut gap between labels). UI text is Thai; code and comments are English.

The app used to read numbers from photos with OCR. That version is in git history at commit `aafcbf3` (and its parent chain). The OCR code is gone from the working tree; do not bring it back without a new requirement.

This project lives in its own repo, `tepakorn2006-cyber/ocr-sticker`, live at https://tepakorn2006-cyber.github.io/ocr-sticker/ (GitHub Pages, `main` branch root). Never push to, edit, or delete anything in the `tepakorn2006-cyber/ocr-to-word` repo or the `C:\Users\Windows10\Claude-Work\ocr-to-word` folder. That is a separate project that is still live and in use.

## Invariants

- Numbers are **strings** end to end. Leading zeros (`0812345678`) are the whole point; nothing may pass a number through `Number`/`parseInt`/arithmetic.
- Everything runs in the browser. No phone numbers leave the device. Libraries are self-hosted under `vendor/` (no CDN at runtime; the only exception is the Google Fonts stylesheet).
- A wrong number shipped silently is the worst outcome. Anything that is not exactly 10 digits is listed on the page and left out of the Word file, never guessed at.

## Making a change

1. `node tests/test-pure.js` — must end `N passed, 0 failed`. Write the failing test first for any pure-logic change.
2. Serve over HTTP and exercise the real page: `npx http-server . -p 8766 -c-1`, open http://localhost:8766. `file://` cannot load the vendor scripts reliably.
3. Deploy: push to `main`; Pages rebuilds in about a minute.

## Code layout facts you can't see at a glance

- `index.html` holds all CSS and JS. Pure, DOM-free logic lives between `/* @pure-start */` and `/* @pure-end */`; the test file loads exactly that block into a `vm` context, so pure helpers must stay inside it.
- Part of `tests/test-pure.js` is **source guards** (string/regex checks against `index.html`). Renaming a function or changing a user-facing message usually means updating a guard on purpose.
- Pure helpers: `parseNumberInput` (line splitting, cleaning, validity, duplicates), `escapeXml`, `buildFileStamp`, `toastDurationMs`, and the sticker set: `stickerGapMm`, `computeStickerLayout`, `stickerFontPt`, `stickerFontHalfPoints`, `buildStickerDocumentXml`, `escapePdfString`, `buildStickerPdf`.
- `vendor/jszip/jszip.min.js` builds the `.docx` zip. `vendor/paddle/` is **unused** (the OCR engine's files). Nothing references it any more. It can be deleted once this version has been live for a day, so that browsers still holding the old page can finish loading it.

## Gotchas (each one cost a real bug, or is an easy trap)

- **Parsing rules.** `parseNumberInput` splits on `\r?\n`, trims each line, skips blank lines, and removes spaces, tabs, `-`, `.`, `(` and `)`. A line is valid only if what remains is exactly `\d{10}`. Line numbers are 1-based against the original text, so the user can find the bad line. Duplicates are reported but stay in `valid`, because the user may want two stickers for one number.
- **Dialogs.** `window.confirm/alert/prompt` are suppressed in the user's browser (they return immediately). Never call them. The "ล้างทั้งหมด" button uses a two-click arm: the first click changes its text for 4 s, the second clears. The source guard fails if a dialog call appears.
- **Sticker layout is counted in twips, like Word, with a gap.** `stickerCellTwips` floors each cell size and the gap (`Math.floor(mm * TWIPS_PER_MM)`) so the grid never grows past the usable page area. The gap is 3 mm by default and must be 0 to 10 mm (`stickerGapMm`). `computeStickerLayout` reserves **two** 20-twip paragraphs (`STICKER_TAIL_TW`) from the height: the page-break paragraph at the top of every page after the first, and the tail at the end of the file. Do not round cells up, and do not drop either reserved paragraph. The fit tests check every width, height and gap against the A4 area. Labels must be at least 20 mm wide: below that, 10 digits at the 6 pt font floor cannot keep 3.5 mm side margins (they overflow in the PDF and wrap in Word).
- **One Word table per page.** `buildStickerDocumentXml` writes a separate `<w:tbl>` for each page, with `STICKER_PAGE_BREAK_PARA` between tables. The gap is an empty column and an empty row with no borders. Gap cells and rows must stay tiny (`sz 2`, `line 20 exact`, exact row heights) so they never grow the row. Label cells keep the dashed cut lines; table borders are `nil`.
- **PDF writer (`buildStickerPdf`).** It writes PDF 1.4 by hand, with the base-14 Helvetica-Bold font, so there is no font embedding. Digits only. `escapePdfString` escapes `\ ( )`. The output is pure ASCII, so the string length is the byte length and the Blob is byte-exact. Each xref entry must be exactly 20 bytes, every offset must point at its `k 0 obj`, and every stream `/Length` must equal its content. Labels without a value get no outline. The tests check all of these.
- **Storage is optional.** The draft (`ocr-sticker:draft`) and the chosen size (`ocr-sticker:size`) live in `localStorage`. Every access goes through `storageGet` / `storageSet`, which use try/catch, because private windows and blocked site data throw. The source guard fails if `localStorage` shows up outside a `try`.
- **Deploys and caching.** GitHub Pages serves `index.html` with `max-age=600`. A browser that holds the old page for 10 minutes will request the old page's files, so keep old `vendor/` paths alive for one deploy before deleting them. Telling users to open `?v=N` forces a fresh copy.
- **Printing.** The sticker sizes are physical millimetres. Users must print at 100% on A4 (not "fit to page"). The page's hint text says so; keep that wording. The PDF is the recommended file for printing (it prints at true size more reliably than Word on phones); the Word file stays.
- **Font size is shared.** `stickerFontPt` gives the point size (rounded down to 0.5 pt, at least 6 pt, at most 28 pt). `stickerFontHalfPoints` is that size times 2 for Word, so both files print the digits at the same size. 10 digits must leave at least 3.5 mm on each side.
