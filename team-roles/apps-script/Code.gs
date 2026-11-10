// Team role picker — Google Apps Script backend.
// One role can have one owner; one person can hold many roles.
// Claims live in Script Properties as JSON: { roleId: { name, at } }.

const ROLE_IDS = ['theme', 'premise', 'logline', 'intention', 'target', 'budget', 'plot',
  'concept', 'mood', 'story', 'music', 'trailer', 'timeline', 'crew'];
const KEY = 'claims';
// Booking closes at midnight Thai time. Change this date to reopen or extend.
const DEADLINE = new Date('2026-11-11T00:00:00+07:00').getTime();
const CLOSED_MSG = 'ปิดรับแล้ว (หมดเวลาเที่ยงคืน) ถ้าต้องการเปลี่ยน ให้ถามคนที่ส่งลิงก์เว็บนี้ให้';
function isClosed_() { return Date.now() >= DEADLINE; }
function state_(claims, extra) {
  const out = { claims: claims, deadline: DEADLINE, now: Date.now() };
  for (const k in (extra || {})) out[k] = extra[k];
  return out;
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('แบ่งหน้าที่ทีมหนัง')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function read_() {
  const raw = PropertiesService.getScriptProperties().getProperty(KEY);
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
function write_(claims) {
  PropertiesService.getScriptProperties().setProperty(KEY, JSON.stringify(claims));
}
function clean_(name) { return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 81); }
function norm_(name) { return clean_(name).toLowerCase(); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function getState() { return state_(read_()); }

function claim(roleId, name) {
  name = clean_(name);
  if (isClosed_()) return state_(read_(), { ok: false, msg: CLOSED_MSG });
  if (!name) return state_(read_(), { ok: false, msg: 'กรอกชื่อของคุณก่อน' });
  if (ROLE_IDS.indexOf(roleId) < 0) return state_(read_(), { ok: false, msg: 'ไม่พบหน้าที่นี้' });
  return withLock_(function () {
    const claims = read_();
    const cur = claims[roleId];
    if (cur && cur.name) {
      const msg = norm_(cur.name) === norm_(name) ? 'หน้าที่นี้เป็นของคุณอยู่แล้ว' : 'หน้าที่นี้ ' + cur.name + ' เลือกไปแล้ว';
      return state_(claims, { ok: false, msg: msg });
    }
    claims[roleId] = { name: name, at: Date.now() };
    write_(claims);
    return state_(claims, { ok: true });
  });
}

function release(roleId, name) {
  if (isClosed_()) return state_(read_(), { ok: false, msg: CLOSED_MSG });
  return withLock_(function () {
    const claims = read_();
    const cur = claims[roleId];
    if (!cur) return state_(claims, { ok: true });
    if (norm_(cur.name) !== norm_(name)) return state_(claims, { ok: false, msg: 'หน้าที่นี้ไม่ใช่ของคุณ' });
    delete claims[roleId];
    write_(claims);
    return state_(claims, { ok: true });
  });
}

// Owner tools: run these from the Apps Script editor (select the function, press Run).
function resetAll() { PropertiesService.getScriptProperties().deleteProperty(KEY); }
function releaseRole(roleId) {
  // e.g. change 'logline' below, then Run releaseRoleExample
  withLock_(function () { const c = read_(); delete c[roleId]; write_(c); });
}
function releaseRoleExample() { releaseRole('logline'); }
