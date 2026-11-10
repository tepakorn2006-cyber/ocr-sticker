# วิธีเอาเว็บแบ่งหน้าที่ขึ้นออนไลน์ (Google Apps Script)

ใช้เวลาประมาณ 5 นาที ทำครั้งเดียว ใช้บัญชี Google ของคุณ

1. เปิด https://script.google.com แล้วกด **โครงการใหม่ (New project)**
2. ตั้งชื่อโครงการ (กดที่ "Untitled project" ด้านบน) เช่น `แบ่งหน้าที่ทีมหนัง`
3. ไฟล์ `Code.gs`: ลบโค้ดเดิมทิ้งทั้งหมด แล้ววางโค้ดจากไฟล์ `Code.gs`
4. กด **+** ข้างคำว่า Files → **HTML** → ตั้งชื่อว่า `Index` (ตัว I ใหญ่ ไม่ต้องพิมพ์ .html)
   ลบโค้ดเดิมทิ้ง แล้ววางโค้ดจากไฟล์ `Index.html`
5. กดไอคอนบันทึก (รูปแผ่นดิสก์)
6. กด **Deploy (ทำให้ใช้งานได้)** มุมขวาบน → **New deployment (การทำให้ใช้งานได้รายการใหม่)**
   - กดรูปเฟือง ⚙ → เลือก **Web app (เว็บแอป)**
   - Execute as (เรียกใช้ในฐานะ): **Me (ฉัน)**
   - Who has access (ผู้ที่มีสิทธิ์เข้าถึง): **Anyone (ทุกคน)**
   - กด **Deploy**
7. Google จะถามสิทธิ์ → **Authorize access** → เลือกบัญชีของคุณ
   ถ้าขึ้นว่า "Google hasn't verified this app" ให้กด **Advanced** → **Go to ... (unsafe)** → **Allow**
   (เป็นเรื่องปกติ เพราะเป็นสคริปต์ที่คุณสร้างเอง)
8. คัดลอกลิงก์ **Web app URL** (ลงท้ายด้วย `/exec`) แล้วส่งให้เพื่อนในกลุ่มได้เลย
   เพื่อนไม่ต้องล็อกอิน

## จัดการหลังจากนี้ (เฉพาะเจ้าของ)

- ล้างทุกหน้าที่: ในหน้า Apps Script เลือกฟังก์ชัน `resetAll` ในแถบด้านบน แล้วกด **Run**
- ปลดหน้าที่เดียว: แก้ `'logline'` ใน `releaseRoleExample` เป็นรหัสหน้าที่ แล้ว Run `releaseRoleExample`
  รหัส: theme, premise, logline, intention, target, budget, plot, concept, mood, story, music, trailer, timeline, crew
- ถ้าแก้โค้ดภายหลัง ต้องกด Deploy → **Manage deployments** → ✏️ → Version: **New version** → Deploy (ลิงก์เดิมใช้ต่อได้)
