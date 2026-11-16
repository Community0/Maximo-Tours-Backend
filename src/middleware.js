/* ═══════════════════════════════════════════════════════════
   MIDDLEWARE — auth admin, auth utente, rate limiting, IP
═══════════════════════════════════════════════════════════ */
const config = require('./config');
const { q } = require('./db');

function getIP(req) {
  return req.ip || 'unknown';
}

/* ── Admin: accetta sia x-admin-token (compat v4) sia Bearer ── */
function adminAuth(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = req.headers['x-admin-token'] || bearer;
  if (!config.adminPassword || token !== config.adminPassword) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  next();
}

/* ── Utente: token = user id verificato (compat v4) ── */
async function userAuth(req, res, next) {
  const token = req.headers['x-user-token'];
  if (!token) return res.status(401).json({ error: 'Non autenticato' });
  const r = await q(
    'SELECT id,email,name,phone,referral_code,loyalty_points,created_at FROM users WHERE id=$1 AND verified=TRUE',
    [token]
  );
  if (!r || !r.rows.length) return res.status(401).json({ error: 'Sessione non valida' });
  req.user = r.rows[0];
  next();
}

/* ── Rate limiter in-memory generico ── */
function makeRateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of hits) if (now - e.t > windowMs * 2) hits.delete(k);
  }, windowMs).unref();

  return function (req, res, next) {
    const ip = getIP(req);
    const now = Date.now();
    const e = hits.get(ip) || { n: 0, t: now };
    if (now - e.t > windowMs) { e.n = 0; e.t = now; }
    e.n++;
    hits.set(ip, e);
    if (e.n > max) return res.status(429).json(message);
    next();
  };
}

const chatLimiter = makeRateLimiter({
  windowMs: 60000, max: 40,
  message: { reply: `Troppe richieste. Scrivici su WhatsApp: ${config.publicWhatsapp} 💬` },
});

const loginLimiter = makeRateLimiter({
  windowMs: 60000, max: 10,
  message: { error: 'Troppi tentativi. Riprova tra un minuto.' },
});

const bookingLimiter = makeRateLimiter({
  windowMs: 60000, max: 15,
  message: { error: 'Troppe richieste. Riprova tra un minuto.' },
});

module.exports = { getIP, adminAuth, userAuth, chatLimiter, loginLimiter, bookingLimiter };
