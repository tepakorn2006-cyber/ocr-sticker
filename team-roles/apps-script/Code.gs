// Team role picker — Google Apps Script backend.
// One role can have one owner; one person can hold many roles.
// Claims live in Script Properties as JSON: { roleId: { name, at } }.

const ROLE_IDS = ['theme', 'premise', 'logline', 'intention', 'target', 'budget', 'plot',
  'concept', 'mood', 'story', 'music', 'trailer', 'timeline', 'crew'];
const KEY = 'claims';

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
function clean_(name) { return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40); }
function norm_(name) { return clean_(name).toLowerCase(); }

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function getState() { return read_(); }

function claim(roleId, name) {
  name = clean_(name);
  if (!name) return { ok: false, msg: 'กรอกชื่อของคุณก่อน', claims: read_() };
  if (ROLE_IDS.indexOf(roleId) < 0) return { ok: false, msg: 'ไม่พบหน้าที่นี้', claims: read_() };
  return withLock_(function () {
    const claims = read_();
    const cur = claims[roleId];
    if (cur && cur.name) {
      const msg = norm_(cur.name) === norm_(name) ? 'หน้าที่นี้เป็นของคุณอยู่แล้ว' : 'หน้าที่นี้ ' + cur.name + ' เลือกไปแล้ว';
      return { ok: false, msg: msg, claims: claims };
    }
    claims[roleId] = { name: name, at: Date.now() };
    write_(claims);
    return { ok: true, claims: claims };
  });
}

function release(roleId, name) {
  return withLock_(function () {
    const claims = read_();
    const cur = claims[roleId];
    if (!cur) return { ok: true, claims: claims };
    if (norm_(cur.name) !== norm_(name)) return { ok: false, msg: 'หน้าที่นี้ไม่ใช่ของคุณ', claims: claims };
    delete claims[roleId];
    write_(claims);
    return { ok: true, claims: claims };
  });
}

// Owner tools: run these from the Apps Script editor (select the function, press Run).
function resetAll() { PropertiesService.getScriptProperties().deleteProperty(KEY); }
function releaseRole(roleId) {
  // e.g. change 'logline' below, then Run releaseRoleExample
  withLock_(function () { const c = read_(); delete c[roleId]; write_(c); });
}
function releaseRoleExample() { releaseRole('logline'); }
