/* ═══════════════════════════════════════════════════════════
   DRIVER LINK — token firmati HMAC (spec AURA_DRIVER_APP_SPEC).
   Il token lega driver + servizio, scade 48h dopo il servizio.
   Nessuna password: aprire il link = autenticato per quel servizio.
═══════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const config = require('../config');

/* Secret dedicato se impostato, altrimenti derivato dalla password admin
   (stabile tra i riavvii, così i link restano validi). */
const SECRET = process.env.DRIVER_LINK_SECRET
  || (config.adminPassword
    ? crypto.createHash('sha256').update('aura-driver-link:' + config.adminPassword).digest('hex')
    : crypto.randomBytes(32).toString('hex'));

const b64u = buf => Buffer.from(buf).toString('base64url');

function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}

/* exp: 48h dopo il servizio (spec). Se la data non è leggibile: 7 giorni. */
function computeExpiry(dateStr, timeStr) {
  let base = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(dateStr || ''))) {
    base = new Date(`${String(dateStr).slice(0, 10)}T${/^\d{2}:\d{2}/.test(timeStr || '') ? timeStr : '20:00'}:00`);
  }
  if (!base || isNaN(base)) return Date.now() + 7 * 86400000;
  return Math.max(base.getTime() + 48 * 3600000, Date.now() + 24 * 3600000);
}

function makeToken(bookingId, driverId, exp) {
  const body = b64u(JSON.stringify({ b: bookingId, d: driverId, e: exp }));
  return body + '.' + sign(body);
}

function verifyToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expected = sign(body);
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.b || !payload.e || Date.now() > payload.e) return null;
    return { bookingId: payload.b, driverId: payload.d || null, exp: payload.e };
  } catch (_) {
    return null;
  }
}

module.exports = { makeToken, verifyToken, computeExpiry };
