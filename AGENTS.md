# OCR เลข 10 หลัก → Word สำหรับกระดาษสติกเกอร์ — agent notes

Single-page web app for Thai, non-technical users. Upload photos (mostly phone photos of Thai SIM-card labels), OCR them in the browser, keep only exactly-10-digit number strings, let the user review/edit, then export a `.docx` laid out to print onto A4 sticker-label sheets (one number per label). UI text is Thai; code and comments are English.

Forked from the separate `ocr-to-word` project, which is still live and in use. Never push to, edit, or delete anything in the `tepakorn2006-cyber/ocr-to-word` repo or the `C:\Users\Windows10\Claude-Work\ocr-to-word` folder. This project deploys to its own repo, `tepakorn2006-cyber/ocr-sticker` (GitHub Pages from `main` root), once the user approves.

## Invariants

- Numbers are **strings** end to end. Leading zeros (`0812345678`) are the whole point; nothing may pass a number through `Number`/`parseInt`/arithmetic.
- Everything runs in the browser. Images never leave the device; all engine and model files are self-hosted under `vendor/` (no CDN at runtime).
- Accuracy beats speed. A wrong number shipped silently is the worst outcome; a doubtful number gets the "ตรวจสอบ" badge or goes to the near-miss list.

## Making a change

1. `node tests/test-pure.js` — must end `N passed, 0 failed`. Write the failing test first for any pure-logic change.
2. Serve over HTTP and exercise the real page: `npx http-server . -p 8766 -c-1`, open http://localhost:8766. `file://` cannot load the ONNX/wasm files.
3. For OCR or extraction changes, verify end to end on a real SIM-label photo before and after (keep such photos in the git-ignored `.local-test/`; they contain real phone numbers and must never be committed). The reference result for the original photo is 5/5 sets, 0 wrong.
4. Push to `main`; Pages rebuilds in about a minute.

## Code layout facts you can't see at a glance

- `index.html` holds all CSS and JS. Pure, DOM-free logic lives between `/* @pure-start */` and `/* @pure-end */`; the test file loads exactly that block into a `vm` context, so pure helpers must stay inside it.
- Part of `tests/test-pure.js` is **source guards** (string/regex checks against `index.html`). Renaming a function or changing a user-facing message usually means updating a guard on purpose.

## Gotchas (each one cost a real bug)

- **OCR engine.** PaddleOCR PP-OCRv4 (det + rec ONNX, `ch_` models, `ppocr_keys_v1.txt` + blank + trailing space) on onnxruntime-web, single-threaded, main thread. Tesseract.js was tried and dropped: both its LSTM and legacy engines misread the bold "5" on SIM labels as "6" and varied with photo resolution. Re-test on a real photo before swapping engines or models.
- **Confidence.** `ctcDecode` returns per-char scores; a value's score is the minimum over its own digits (not the whole line, which may contain garbled Thai). Below 0.9 → "ตรวจสอบ" badge.
- **Extraction** (`extractNumbers` / `mergeSplitSequence`): exactly 10 digits; spaced or hyphenated groups merge only when the first group has ≥3 digits and every group ≥2; any run of ≥10 digits splits a sequence; exact merges win over the near-miss join. 8/9/11/12-digit results go to the near-miss list, never auto-included. The OCR itself sometimes drops the space in `12 0811111111`, which then lands in near-miss — known limitation.
- **Image intake** is decided by content (`sniffImageType` magic bytes), not by name or MIME: `.jfif`, extension-less and empty-MIME JPEGs are valid; HEIC is rejected with a message.
- **Dialogs.** `window.confirm/alert/prompt` are suppressed in the user's browser (they return immediately). Use the in-page `confirmDialog`; danger dialogs focus Cancel.
- **Yielding.** `nextFrame` must keep working in hidden tabs: `setTimeout(0)` when visible, a `MessageChannel` round trip when hidden. `requestAnimationFrame` stalls hidden tabs and froze OCR.
- **Never trap the user.** Every run path ends through `finally` with controls re-enabled; the Stop button, run tokens (`state.runId`), and the per-image inactivity timeout exist because a hung promise once disabled every button.
- **Quantity selection.** `target === null` means an invalid custom value (select none, show a message); `Infinity` means "all". New rows only fill the remaining quota (`applySelectionToNewRows`); manual checkbox choices are preserved.
- **Deploys and caching.** GitHub Pages serves `index.html` with `max-age=600`. A browser holding the old page for 10 minutes will request the old page's vendor files, so when replacing vendor files keep the old paths alive for one deploy (or add new paths rather than deleting). Telling users to open `?v=N` forces a fresh copy.
