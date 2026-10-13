# OCR เลข 10 หลัก → Word สำหรับกระดาษสติกเกอร์

เว็บอ่านชุดตัวเลข 10 หลักทุกชุดจากรูปภาพ (เช่น เบอร์บนสติกเกอร์ซิม) แล้วสร้างไฟล์ Word สำหรับพิมพ์ลงกระดาษสติกเกอร์ A4 — ประมวลผลในเบราว์เซอร์ทั้งหมด รูปไม่ถูกอัปโหลดไปที่ไหน

- ใช้งานจริง: https://tepakorn2006-cyber.github.io/ocr-sticker/
- รันในเครื่อง: `npx http-server . -p 8766` แล้วเปิด http://localhost:8766 (เปิดไฟล์ `index.html` ตรง ๆ ไม่ได้)
- ทดสอบ: `node tests/test-pure.js`
- สำหรับ AI/นักพัฒนาที่จะพัฒนาต่อ: อ่าน [AGENTS.md](AGENTS.md)

ตัวอ่าน OCR: PaddleOCR (PP-OCRv4) บน onnxruntime-web · สร้างไฟล์ Word ด้วย JSZip
