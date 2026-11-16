/* ═══════════════════════════════════════════════════════════
   AREA CLIENTI — registrazione con verifica email, login,
   prenotazioni, foto, recensioni, referral.
   Sicurezza: le nuove password sono hashate con bcrypt;
   gli account storici in chiaro vengono migrati al primo login.
═══════════════════════════════════════════════════════════ */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { q } = require('../db');
const { userAuth, loginLimiter } = require('../middleware');
const { sendVerifyCodeEmail } = require('../services/email');

const router = express.Router();

function isBcrypt(hash) { return /^\$2[aby]\$/.test(String(hash || '')); }
async function verifyPassword(plain, stored) {
  if (isBcrypt(stored)) return bcrypt.compare(plain, stored);
  return plain === stored; // account storici (pre-v5)
}

/* ── REGISTER ── */
router.post('/user/register', loginLimiter, async (req, res) => {
  try {
    const { email, password, name, phone } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimo 6 caratteri' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email non valida' });

    const normEmail = email.toLowerCase().trim();
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const hashed = await bcrypt.hash(password, 10);

    const existing = await q('SELECT id,verified FROM users WHERE email=$1', [normEmail]);
    if (existing && existing.rows.length) {
      const existingUser = existing.rows[0];
      if (existingUser.verified) {
        return res.status(409).json({ error: 'Email già registrata. Prova ad accedere.' });
      }
      await q(
        `UPDATE users SET password=$1, name=$2, phone=$3, verify_code=$4, verify_expires=NOW()+INTERVAL '30 minutes' WHERE id=$5`,
        [hashed, name, phone || null, code, existingUser.id]
      );
      const emailResult = await sendVerifyCodeEmail(normEmail, name, code);
      if (!emailResult?.success) {
        return res.status(502).json({ error: "Non siamo riusciti a inviare l'email di conferma. Riprova tra un attimo." });
      }
      return res.json({ success: true, message: 'Codice di verifica inviato alla tua email', resumedRegistration: true });
    }

    const id = crypto.randomUUID();
    const referralCode = 'AURA' + id.slice(0, 6).toUpperCase();
    await q(
      `INSERT INTO users (id,email,password,name,phone,verify_code,verify_expires,referral_code,referred_by)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '30 minutes',$7,$8)`,
      [id, normEmail, hashed, name, phone || null, code, referralCode, req.body.referredBy || null]
    );
    const emailResult = await sendVerifyCodeEmail(normEmail, name, code);
    if (!emailResult?.success) {
      await q('DELETE FROM users WHERE id=$1', [id]);
      return res.status(502).json({ error: "Non siamo riusciti a inviare l'email di conferma. Riprova tra un attimo." });
    }
    res.json({ success: true, message: 'Codice di verifica inviato alla tua email' });
  } catch (e) {
    console.error('[Register]', e.message);
    res.status(500).json({ error: 'Errore registrazione' });
  }
});

/* ── VERIFY EMAIL ── */
router.post('/user/verify', loginLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email e codice richiesti' });
    const r = await q('SELECT id,verify_code,verify_expires FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (!r || !r.rows.length) return res.status(404).json({ error: 'Utente non trovato' });
    const user = r.rows[0];
    if (user.verify_code !== code.trim()) return res.status(401).json({ error: 'Codice non valido' });
    if (new Date(user.verify_expires) < new Date()) return res.status(410).json({ error: 'Codice scaduto. Usa "Reinvia codice" per riceverne uno nuovo.' });
    await q('UPDATE users SET verified=TRUE,verify_code=NULL WHERE id=$1', [user.id]);
    res.json({ success: true, token: user.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── RESEND CODE ── */
router.post('/user/resend-code', loginLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email richiesta' });
    const r = await q('SELECT id,name,verified FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (!r || !r.rows.length) return res.status(404).json({ error: 'Account non trovato' });
    if (r.rows[0].verified) return res.status(400).json({ error: 'Email già verificata. Puoi accedere.' });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await q("UPDATE users SET verify_code=$1, verify_expires=NOW()+INTERVAL '30 minutes' WHERE id=$2", [code, r.rows[0].id]);
    const emailResult = await sendVerifyCodeEmail(email.toLowerCase().trim(), r.rows[0].name, code, { isNew: false });
    if (!emailResult?.success) {
      return res.status(502).json({ error: 'Non siamo riusciti a inviare il nuovo codice. Riprova tra un attimo.' });
    }
    res.json({ success: true, message: 'Nuovo codice inviato!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── LOGIN ── */
router.post('/user/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e password richiesti' });
    const r = await q('SELECT id,name,email,verified,password FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (!r || !r.rows.length) return res.status(404).json({ error: 'Account non trovato. Registrati prima.' });
    const user = r.rows[0];
    if (!(await verifyPassword(password, user.password))) return res.status(401).json({ error: 'Password errata' });
    if (!user.verified) return res.status(403).json({ error: 'Email non verificata. Controlla la tua casella.', needsVerification: true, email: user.email });

    /* migrazione trasparente: password storica in chiaro → bcrypt */
    if (!isBcrypt(user.password)) {
      const hashed = await bcrypt.hash(password, 10);
      q('UPDATE users SET password=$1 WHERE id=$2', [hashed, user.id]);
    }
    res.json({ success: true, token: user.id, name: user.name, email: user.email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── PROFILO E DATI ── */
router.get('/user/me', userAuth, async (req, res) => res.json(req.user));

router.get('/user/bookings', userAuth, async (req, res) => {
  const r = await q('SELECT id,tour,people,date,time,status,amount,payment_method,created_at FROM bookings WHERE email=$1 ORDER BY created_at DESC', [req.user.email]);
  res.json(r ? r.rows : []);
});

router.get('/user/photos', userAuth, async (req, res) => {
  const r = await q('SELECT id,booking_id,title,url,created_at FROM user_photos WHERE user_email=$1 ORDER BY created_at DESC', [req.user.email]);
  res.json(r ? r.rows : []);
});

router.get('/user/reviews', userAuth, async (req, res) => {
  const r = await q('SELECT id,tour_name,stars,text,approved,created_at FROM reviews WHERE booking_id IN (SELECT id FROM bookings WHERE email=$1) ORDER BY created_at DESC', [req.user.email]);
  res.json(r ? r.rows : []);
});

router.post('/user/review', userAuth, async (req, res) => {
  try {
    const { bookingId, stars, text, location } = req.body;
    if (!bookingId || !stars || !text) return res.status(400).json({ error: 'Campi mancanti' });
    const s = parseInt(stars);
    if (isNaN(s) || s < 1 || s > 5) return res.status(400).json({ error: 'Stelle non valide' });
    const bk = await q('SELECT id,tour FROM bookings WHERE id=$1 AND email=$2', [bookingId, req.user.email]);
    if (!bk || !bk.rows.length) return res.status(403).json({ error: 'Prenotazione non trovata' });
    const dup = await q('SELECT id FROM reviews WHERE booking_id=$1', [bookingId]);
    if (dup && dup.rows.length) return res.status(409).json({ error: 'Recensione già inviata per questa prenotazione' });
    await q('INSERT INTO reviews (id,name,location,tour_name,stars,text,approved,booking_id) VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7)',
      [crypto.randomUUID(), req.user.name, location || '', bk.rows[0].tour, s, text, bookingId]);
    await q('UPDATE users SET loyalty_points=loyalty_points+10 WHERE id=$1', [req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/user/referral', userAuth, async (req, res) => {
  const refs = await q('SELECT referred_email,created_at,discount_used FROM referrals WHERE referrer_email=$1 ORDER BY created_at DESC', [req.user.email]);
  res.json({
    code: req.user.referral_code,
    referrals: refs ? refs.rows : [],
    points: req.user.loyalty_points,
  });
});

router.post('/user/rebook-check', userAuth, async (req, res) => {
  const bookings = await q('SELECT COUNT(*) FROM bookings WHERE email=$1', [req.user.email]);
  const count = parseInt(bookings?.rows[0]?.count || 0);
  const discount = count >= 3 ? 15 : count >= 1 ? 10 : 0;
  res.json({ previousBookings: count, discountPercent: discount, name: req.user.name, email: req.user.email, phone: req.user.phone });
});

module.exports = router;
