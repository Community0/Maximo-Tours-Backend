/* ═══════════════════════════════════════════════════════════
   ROUTE ADMIN — tutto ciò che Microwade usa:
   prenotazioni, pagamenti, calendario, recensioni, stats,
   analytics, chat, utenti, email log, CMS contenuti,
   catalogo tour, coupon, traduzioni AI, analisi Ads AI.
═══════════════════════════════════════════════════════════ */
const express = require('express');
const config = require('../config');
const { q } = require('../db');
const { adminAuth, loginLimiter } = require('../middleware');
const catalog = require('../services/catalog');
const ai = require('../services/ai');
const { stripe } = require('../services/stripe');

const router = express.Router();

/* ── LOGIN ── */
router.post('/admin/login', loginLimiter, (req, res) => {
  if (config.adminPassword && req.body.password === config.adminPassword) {
    res.json({ success: true, token: config.adminPassword });
  } else {
    res.status(401).json({ error: 'Password errata' });
  }
});

/* Tutte le route sotto richiedono il token admin */
router.use('/admin', adminAuth);

/* ═══ PRENOTAZIONI ═══ */
router.get('/admin/bookings', async (req, res) => {
  const { status, from, to, search } = req.query;
  let sql = 'SELECT * FROM bookings WHERE 1=1';
  const vals = []; let i = 1;
  if (status) { sql += ` AND status=$${i++}`; vals.push(status); }
  if (from) { sql += ` AND date >= $${i++}`; vals.push(from); }
  if (to) { sql += ` AND date <= $${i++}`; vals.push(to); }
  if (search) { sql += ` AND (name ILIKE $${i} OR email ILIKE $${i} OR tour ILIKE $${i} OR id ILIKE $${i})`; vals.push(`%${search}%`); i++; }
  sql += ' ORDER BY created_at DESC LIMIT 300';
  const r = await q(sql, vals);
  res.json(r ? r.rows.map(b => ({
    id: b.id, name: b.name, email: b.email, phone: b.phone, tour: b.tour,
    people: b.people, date: b.date, time: b.time, notes: b.notes,
    paymentMethod: b.payment_method, status: b.status, amount: b.amount,
    notes_admin: b.notes_admin, stripePaymentId: b.stripe_payment_id,
    couponCode: b.coupon_code, breakdown: b.breakdown,
    channel: b.channel, partnerSource: b.partner_source,
    paymentStatus: b.payment_status, costs: b.costs,
    driverId: b.driver_id, driverFee: b.driver_fee != null ? Number(b.driver_fee) : null,
    driverStatus: b.driver_status, driverPaid: b.driver_paid, driverReport: b.driver_report,
    reviewStatus: b.review_status, partnerPaid: b.partner_paid,
    createdAt: b.created_at, updatedAt: b.updated_at,
  })) : []);
});

/* ── QUICK-CREATE: booking manuale da WhatsApp in <60s (spec WHATSAPP_TO_SYSTEM) ──
   Crea il booking coi campi canale/margine e, se richiesto, genera un link
   di pagamento Stripe Checkout da incollare in chat. */
router.post('/admin/bookings/quick', async (req, res) => {
  try {
    const {
      name, phone, email, tourName, date, time, people, price,
      channel, partnerSource, hotel, language, notes,
      paymentStatus, costs, supplements, generateLink,
    } = req.body || {};
    if (!name || !tourName || !date) return res.status(400).json({ error: 'Nome, tour e data sono obbligatori' });
    const amount = Math.round((parseFloat(price) || 0) * 100) / 100;
    if (amount <= 0) return res.status(400).json({ error: 'Prezzo non valido' });

    let bookingId = 'AT' + Date.now();
    const idRes = await q("SELECT 'AT'||nextval('booking_counter') AS id");
    if (idRes) bookingId = idRes.rows[0].id;

    const fullNotes = [hotel ? `Pickup: ${hotel}` : '', language ? `Lingua: ${language}` : '', notes || ''].filter(Boolean).join(' · ');

    let payLink = null;
    let stripeSessionId = null;
    if (generateLink && stripe) {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: `Maximo Tours — ${String(tourName).slice(0, 120)}`,
              description: `${date}${time ? ' · ' + time : ''} · ${people || '?'} guests · booking ${bookingId}`,
            },
          },
        }],
        metadata: { bookingId, source: 'quick-create' },
        success_url: `${config.siteUrl}/booking-success/?booking=${encodeURIComponent(bookingId)}&redirect_status=succeeded`,
        cancel_url: config.siteUrl,
        expires_at: Math.floor(Date.now() / 1000) + 6 * 3600, /* T2: slot tenuto 6 ore */
        ...(email ? { customer_email: email } : {}),
      });
      payLink = session.url;
      stripeSessionId = session.id;
    }

    await q(
      `INSERT INTO bookings (id,name,email,phone,tour,people,date,time,notes,payment_method,status,amount,channel,partner_source,payment_status,costs,breakdown)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13,$14,$15,$16)`,
      [
        bookingId, name, email || `${bookingId.toLowerCase()}@manual.aura`, phone || null,
        tourName, String(people || ''), date, time || null, fullNotes || null,
        payLink ? 'stripe_link' : (paymentStatus || 'manual'),
        amount, channel || 'whatsapp', partnerSource || null,
        payLink ? 'link_sent' : (paymentStatus || 'da_definire'),
        JSON.stringify(costs || {}),
        JSON.stringify({ manual: true, supplements: supplements || [], stripeSessionId, createdBy: 'quick-create' }),
      ]
    );

    res.json({ success: true, bookingId, payLink });
  } catch (e) {
    console.error('[quick-create]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.patch('/admin/bookings/:id', async (req, res) => {
  try {
    const { status, notes_admin, amount, date, time, people, paymentStatus, channel, costs, reviewStatus, driverId, driverFee, driverPaid } = req.body;
    const updates = []; const vals = []; let i = 1;
    if (status !== undefined) { updates.push(`status=$${i++}`); vals.push(status); }
    if (notes_admin !== undefined) { updates.push(`notes_admin=$${i++}`); vals.push(notes_admin); }
    if (amount !== undefined) { updates.push(`amount=$${i++}`); vals.push(amount); }
    if (date !== undefined) { updates.push(`date=$${i++}`); vals.push(date); }
    if (time !== undefined) { updates.push(`time=$${i++}`); vals.push(time); }
    if (people !== undefined) { updates.push(`people=$${i++}`); vals.push(people); }
    if (paymentStatus !== undefined) { updates.push(`payment_status=$${i++}`); vals.push(paymentStatus); }
    if (channel !== undefined) { updates.push(`channel=$${i++}`); vals.push(channel); }
    if (costs !== undefined) { updates.push(`costs=$${i++}`); vals.push(JSON.stringify(costs)); }
    if (reviewStatus !== undefined) { updates.push(`review_status=$${i++}`); vals.push(reviewStatus || null); }
    if (driverId !== undefined) { updates.push(`driver_id=$${i++}`); vals.push(driverId || null); }
    if (driverFee !== undefined) { updates.push(`driver_fee=$${i++}`); vals.push(driverFee === null ? null : Number(driverFee) || 0); }
    if (driverPaid !== undefined) { updates.push(`driver_paid=$${i++}`); vals.push(!!driverPaid); }
    if (!updates.length) return res.status(400).json({ error: 'Nessun campo da aggiornare' });
    updates.push('updated_at=NOW()');
    vals.push(req.params.id);
    await q(`UPDATE bookings SET ${updates.join(',')} WHERE id=$${i}`, vals);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/bookings/:id', async (req, res) => {
  await q('DELETE FROM bookings WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

/* ═══ PAGAMENTI STRIPE ═══ */
router.get('/admin/payments', async (req, res) => {
  try {
    if (!stripe) return res.json([]);
    const intents = await stripe.paymentIntents.list({ limit: 100 });
    res.json(intents.data.map(pi => ({
      id: pi.id, amount: pi.amount / 100, currency: pi.currency, status: pi.status,
      tour: pi.metadata?.tour || '—', people: pi.metadata?.people || '—',
      bookingId: pi.metadata?.bookingId || null,
      email: pi.receipt_email || '—', date: new Date(pi.created * 1000).toISOString(),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/payments/:id/refund', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Stripe non configurato' });
    const refund = await stripe.refunds.create({ payment_intent: req.params.id });
    await q("UPDATE bookings SET status='refunded', updated_at=NOW() WHERE stripe_payment_id=$1", [req.params.id]);
    res.json({ success: true, refundId: refund.id, status: refund.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══ RECENSIONI ═══ */
router.get('/admin/reviews', async (req, res) => {
  const r = await q('SELECT * FROM reviews ORDER BY created_at DESC');
  res.json(r ? r.rows : []);
});
router.patch('/admin/reviews/:id', async (req, res) => {
  const sets = []; const vals = []; let i = 1;
  if (req.body.approved !== undefined) { sets.push(`approved=$${i++}`); vals.push(!!req.body.approved); }
  if (req.body.driverId !== undefined) { sets.push(`driver_id=$${i++}`); vals.push(req.body.driverId || null); }
  if (!sets.length) return res.status(400).json({ error: 'Nessun campo' });
  vals.push(req.params.id);
  await q(`UPDATE reviews SET ${sets.join(',')} WHERE id=$${i}`, vals);
  /* match recensione→driver: se la recensione è legata a un booking, chiudi il cerchio */
  if (req.body.driverId) {
    await q(`UPDATE bookings SET review_status='ricevuta', updated_at=NOW()
             WHERE id=(SELECT booking_id FROM reviews WHERE id=$1) AND review_status IS DISTINCT FROM 'ricevuta'`, [req.params.id]);
  }
  res.json({ success: true });
});
router.delete('/admin/reviews/:id', async (req, res) => {
  await q('DELETE FROM reviews WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

/* ═══ DRIVER NETWORK (P6) — roster, assegnazione, driver link, payout ═══ */
const { makeToken, computeExpiry } = require('../services/driverlink');

router.get('/admin/drivers', async (req, res) => {
  const r = await q(`
    SELECT d.*,
      (SELECT COUNT(*) FROM bookings b WHERE b.driver_id=d.id AND b.status NOT IN ('cancelled','refunded')) AS services,
      (SELECT COUNT(*) FROM bookings b WHERE b.driver_id=d.id AND b.driver_status='completato') AS completed,
      (SELECT COALESCE(SUM(b.driver_fee),0) FROM bookings b WHERE b.driver_id=d.id AND b.driver_status='completato' AND b.driver_paid=FALSE) AS payout_pending,
      (SELECT COUNT(*) FROM reviews r2 WHERE r2.driver_id=d.id) AS reviews_received,
      (SELECT COUNT(*) FROM bookings b WHERE b.driver_id=d.id AND b.review_status IN ('chiesta','ricevuta')) AS reviews_asked
    FROM drivers d ORDER BY d.active DESC, d.name`);
  res.json(r ? r.rows : []);
});

router.put('/admin/drivers/:id', async (req, res) => {
  try {
    const id = String(req.params.id).trim();
    const { name, phone = '', languages = [], canDrive = true, rateStandard = 0, rateNight = 0, style = '', zones = '', notes = '', flag = 'attivo', active = true } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nome richiesto' });
    await q(
      `INSERT INTO drivers (id,name,phone,languages,can_drive,rate_standard,rate_night,style,zones,notes,flag,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET name=$2,phone=$3,languages=$4,can_drive=$5,rate_standard=$6,rate_night=$7,style=$8,zones=$9,notes=$10,flag=$11,active=$12`,
      [id, name, phone, JSON.stringify(languages), !!canDrive, Number(rateStandard) || 0, Number(rateNight) || 0, style, zones, notes, flag, !!active]
    );
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/drivers/:id', async (req, res) => {
  await q('DELETE FROM drivers WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

/* Assegna driver a un booking → genera driver link + messaggio T7 pronto */
router.post('/admin/bookings/:id/assign-driver', async (req, res) => {
  try {
    const { driverId, fee } = req.body || {};
    if (!driverId) return res.status(400).json({ error: 'driverId richiesto' });
    const [bRes, dRes] = await Promise.all([
      q('SELECT * FROM bookings WHERE id=$1', [req.params.id]),
      q('SELECT * FROM drivers WHERE id=$1', [driverId]),
    ]);
    const b = bRes?.rows?.[0], d = dRes?.rows?.[0];
    if (!b) return res.status(404).json({ error: 'Booking non trovato' });
    if (!d) return res.status(404).json({ error: 'Driver non trovato' });
    const driverFee = fee !== undefined ? (Number(fee) || 0) : (Number(d.rate_standard) || 0);
    await q(
      `UPDATE bookings SET driver_id=$1, driver_fee=$2, driver_status='assegnato', updated_at=NOW() WHERE id=$3`,
      [driverId, driverFee, b.id]
    );
    const exp = computeExpiry(b.date, b.time);
    const token = makeToken(b.id, driverId, exp);
    const base = `${req.protocol}://${req.get('host')}`;
    const link = `${base}/d/${token}`;
    const hotel = (String(b.notes || '').match(/Pickup:\s*([^·]+)/) || [])[1]?.trim() || 'da definire';
    const lang = (String(b.notes || '').match(/Lingua:\s*([^·]+)/) || [])[1]?.trim() || 'EN';
    /* T7 (WHATSAPP_TO_SYSTEM) + link servizio */
    const message = `Ciao ${d.name}, servizio ${b.date}${b.time ? ' ore ' + b.time : ''}, ${b.people || '?'} pax, ${lang}, pickup ${hotel}. Compenso €${driverFee}. Confermi? Qui trovi tutto e aggiorni lo stato: ${link}`;
    await q('INSERT INTO driver_events (booking_id,driver_id,type,data) VALUES ($1,$2,$3,$4)',
      [b.id, driverId, 'assigned', JSON.stringify({ fee: driverFee, exp })]);
    res.json({ success: true, link, message, fee: driverFee, expiresAt: new Date(exp).toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Payout: salda tutti i servizi completati e non pagati del driver */
router.post('/admin/drivers/:id/settle', async (req, res) => {
  const r = await q(
    `UPDATE bookings SET driver_paid=TRUE, updated_at=NOW()
     WHERE driver_id=$1 AND driver_status='completato' AND driver_paid=FALSE
     RETURNING id, driver_fee`, [req.params.id]);
  const rows = r?.rows || [];
  res.json({ success: true, count: rows.length, total: rows.reduce((s, x) => s + (Number(x.driver_fee) || 0), 0) });
});

/* Eventi driver recenti (timeline in Microwade) */
router.get('/admin/driver-events', async (req, res) => {
  const { booking } = req.query;
  let sql = 'SELECT * FROM driver_events'; const vals = [];
  if (booking) { sql += ' WHERE booking_id=$1'; vals.push(booking); }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const r = await q(sql, vals);
  res.json(r ? r.rows : []);
});

/* ═══ PARTNER HOTEL (P5) — anagrafica, saldo, report mensile ═══ */
router.get('/admin/partners', async (req, res) => {
  const r = await q(`
    SELECT p.*,
      (SELECT COUNT(*) FROM bookings b WHERE b.partner_source=p.code AND b.status NOT IN ('cancelled','refunded')) AS bookings_count,
      (SELECT COALESCE(SUM(b.amount),0) FROM bookings b WHERE b.partner_source=p.code AND b.status NOT IN ('cancelled','refunded')) AS revenue,
      (SELECT COALESCE(SUM(b.amount),0) FROM bookings b WHERE b.partner_source=p.code AND b.status NOT IN ('cancelled','refunded') AND b.partner_paid=FALSE) AS unpaid_revenue
    FROM partners p ORDER BY p.active DESC, p.created_at DESC`);
  const rows = (r?.rows || []).map(p => ({
    ...p,
    pct: Number(p.pct) || 0,
    revenue: Number(p.revenue) || 0,
    unpaid_revenue: Number(p.unpaid_revenue) || 0,
    commission_total: p.model === 'commission' ? +(Number(p.revenue) * (Number(p.pct) || 0) / 100).toFixed(2) : 0,
    commission_due: p.model === 'commission' ? +(Number(p.unpaid_revenue) * (Number(p.pct) || 0) / 100).toFixed(2) : 0,
  }));
  res.json(rows);
});

router.put('/admin/partners/:code', async (req, res) => {
  try {
    const code = String(req.params.code).trim().toUpperCase();
    const { name, contactName = '', phone = '', email = '', model = 'commission', pct = 12, segment = '', notes = '', active = true } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nome richiesto' });
    if (!['commission', 'markup'].includes(model)) return res.status(400).json({ error: 'Modello non valido' });
    await q(
      `INSERT INTO partners (code,name,contact_name,phone,email,model,pct,segment,notes,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (code) DO UPDATE SET name=$2,contact_name=$3,phone=$4,email=$5,model=$6,pct=$7,segment=$8,notes=$9,active=$10`,
      [code, name, contactName, phone, email, model, Number(pct) || 0, segment, notes, !!active]
    );
    res.json({ success: true, code });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/partners/:code', async (req, res) => {
  await q('DELETE FROM partners WHERE code=$1', [String(req.params.code).toUpperCase()]);
  res.json({ success: true });
});

/* Report mensile: dati per la stampa (Microwade genera l'HTML stampabile).
   month = YYYY-MM (default: mese corrente) */
router.get('/admin/partners/:code/report', async (req, res) => {
  try {
    const code = String(req.params.code).toUpperCase();
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
    const pRes = await q('SELECT * FROM partners WHERE code=$1', [code]);
    const partner = pRes?.rows?.[0];
    if (!partner) return res.status(404).json({ error: 'Partner non trovato' });
    const bRes = await q(
      `SELECT id,name,tour,date,time,people,amount,status,partner_paid FROM bookings
       WHERE partner_source=$1 AND date LIKE $2 AND status NOT IN ('cancelled','refunded')
       ORDER BY date, time`, [code, month + '%']);
    const bookings = (bRes?.rows || []).map(b => ({
      ...b,
      amount: Number(b.amount) || 0,
      commission: partner.model === 'commission' ? +((Number(b.amount) || 0) * (Number(partner.pct) || 0) / 100).toFixed(2) : 0,
    }));
    const revenue = bookings.reduce((s, b) => s + b.amount, 0);
    const commission = +bookings.reduce((s, b) => s + b.commission, 0).toFixed(2);
    res.json({ partner: { ...partner, pct: Number(partner.pct) || 0 }, month, bookings, totals: { count: bookings.length, revenue, commission } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Segna come pagate le commissioni del mese (dopo il bonifico) */
router.post('/admin/partners/:code/settle', async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const month = /^\d{4}-\d{2}$/.test(req.body?.month || '') ? req.body.month : new Date().toISOString().slice(0, 7);
  const r = await q(
    `UPDATE bookings SET partner_paid=TRUE, updated_at=NOW()
     WHERE partner_source=$1 AND date LIKE $2 AND status NOT IN ('cancelled','refunded') AND partner_paid=FALSE
     RETURNING id`, [code, month + '%']);
  res.json({ success: true, count: r?.rows?.length || 0, month });
});

/* ═══ REVIEW MACHINE (P7) — pipeline richieste + review rate per driver ═══ */
router.get('/admin/review-tasks', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const r = await q(
    `SELECT b.id, b.name, b.email, b.phone, b.tour, b.date, b.time, b.people, b.status,
            b.driver_id, b.driver_status, b.review_status, d.name AS driver_name
     FROM bookings b LEFT JOIN drivers d ON d.id=b.driver_id
     WHERE b.status NOT IN ('cancelled','refunded')
       AND (b.driver_status='completato' OR (b.status='confirmed' AND b.date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND b.date <= $1))
     ORDER BY b.date DESC LIMIT 150`, [today]);
  const settings = await q(`SELECT value FROM site_content WHERE key='google_settings'`);
  const placeId = settings?.rows?.[0]?.value?.placeId || config.googlePlaceId;
  const reviewLink = placeId
    ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
    : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Maximo Tours Roma');
  res.json({ tasks: r ? r.rows : [], reviewLink });
});

router.get('/admin/review-stats', async (req, res) => {
  const r = await q(`
    SELECT d.id, d.name,
      (SELECT COUNT(*) FROM bookings b WHERE b.driver_id=d.id AND b.driver_status='completato') AS completed,
      (SELECT COUNT(*) FROM bookings b WHERE b.driver_id=d.id AND b.review_status IN ('chiesta','ricevuta')) AS asked,
      (SELECT COUNT(*) FROM reviews r2 WHERE r2.driver_id=d.id) AS received
    FROM drivers d WHERE d.active=TRUE ORDER BY d.name`);
  const rows = (r?.rows || []).map(x => ({
    ...x,
    completed: parseInt(x.completed) || 0,
    asked: parseInt(x.asked) || 0,
    received: parseInt(x.received) || 0,
    rate: (parseInt(x.completed) || 0) > 0 ? Math.round((parseInt(x.received) || 0) / parseInt(x.completed) * 100) : null,
  }));
  res.json(rows);
});

/* ═══ CALENDARIO & DATE BLOCCATE ═══ */
router.get('/admin/calendar', async (req, res) => {
  const { month, year } = req.query;
  let sql = 'SELECT * FROM bookings WHERE 1=1';
  const vals = [];
  if (month && year) {
    sql += ` AND date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND EXTRACT(MONTH FROM date::date)=$1 AND EXTRACT(YEAR FROM date::date)=$2`;
    vals.push(parseInt(month), parseInt(year));
  }
  const [bookings, blocked] = await Promise.all([q(sql, vals), q('SELECT * FROM blocked_dates ORDER BY date')]);
  res.json({
    bookings: bookings ? bookings.rows.map(b => ({ id: b.id, name: b.name, tour: b.tour, date: b.date, time: b.time, status: b.status, people: b.people })) : [],
    blocked: blocked ? blocked.rows : [],
  });
});

router.post('/admin/block-date', async (req, res) => {
  const { date, reason } = req.body;
  if (!date) return res.status(400).json({ error: 'Data richiesta' });
  await q('INSERT INTO blocked_dates (date,reason) VALUES ($1,$2) ON CONFLICT (date) DO UPDATE SET reason=$2', [date, reason || 'Indisponibile']);
  res.json({ success: true });
});

router.delete('/admin/block-date/:date', async (req, res) => {
  await q('DELETE FROM blocked_dates WHERE date=$1', [req.params.date]);
  res.json({ success: true });
});

/* ═══ STATS & GRAFICI ═══ */
router.get('/admin/stats', async (req, res) => {
  try {
    const [bTotal, bPend, bConf, bCanc, revAppr, revPend, topTour, recentBooks, chatTotal] = await Promise.all([
      q('SELECT COUNT(*) FROM bookings'),
      q("SELECT COUNT(*) FROM bookings WHERE status='pending'"),
      q("SELECT COUNT(*) FROM bookings WHERE status='confirmed'"),
      q("SELECT COUNT(*) FROM bookings WHERE status='cancelled'"),
      q('SELECT COUNT(*) FROM reviews WHERE approved=TRUE'),
      q('SELECT COUNT(*) FROM reviews WHERE approved=FALSE'),
      q('SELECT tour, COUNT(*) cnt FROM bookings GROUP BY tour ORDER BY cnt DESC LIMIT 1'),
      q('SELECT id,name,tour,date,status,amount,created_at FROM bookings ORDER BY created_at DESC LIMIT 8'),
      q('SELECT COUNT(*) FROM chat_logs'),
    ]);
    let stripeTotal = 0, stripeMonth = 0;
    if (stripe) {
      try {
        const ms = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
        const [all, mon] = await Promise.all([
          stripe.paymentIntents.list({ limit: 100 }),
          stripe.paymentIntents.list({ limit: 100, created: { gte: ms } }),
        ]);
        stripeTotal = all.data.filter(p => p.status === 'succeeded').reduce((s, p) => s + p.amount / 100, 0);
        stripeMonth = mon.data.filter(p => p.status === 'succeeded').reduce((s, p) => s + p.amount / 100, 0);
      } catch (e) {}
    }
    res.json({
      bookings: {
        total: parseInt(bTotal?.rows[0].count || 0),
        pending: parseInt(bPend?.rows[0].count || 0),
        confirmed: parseInt(bConf?.rows[0].count || 0),
        cancelled: parseInt(bCanc?.rows[0].count || 0),
      },
      payments: { total: stripeTotal, thisMonth: stripeMonth },
      reviews: { approved: parseInt(revAppr?.rows[0].count || 0), pending: parseInt(revPend?.rows[0].count || 0) },
      topTour: topTour?.rows[0]?.tour || '—',
      recentBookings: recentBooks?.rows || [],
      chatMessages: parseInt(chatTotal?.rows[0]?.count || 0),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/charts', async (req, res) => {
  try {
    let dailyRevenue = [];
    if (stripe) {
      try {
        const thirtyAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
        const pis = await stripe.paymentIntents.list({ limit: 100, created: { gte: thirtyAgo } });
        const byDay = {};
        pis.data.filter(p => p.status === 'succeeded').forEach(p => {
          const day = new Date(p.created * 1000).toISOString().split('T')[0];
          byDay[day] = (byDay[day] || 0) + p.amount / 100;
        });
        dailyRevenue = Object.entries(byDay).map(([day, amount]) => ({ day, amount })).sort((a, b) => a.day.localeCompare(b.day));
      } catch (e) {}
    }
    const tourCounts = await q('SELECT tour, COUNT(*) count FROM bookings GROUP BY tour ORDER BY count DESC');
    const dailyBookings = await q(`SELECT DATE(created_at) AS bucket_day, COUNT(*) count FROM bookings WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY DATE(created_at)`);
    const statusCounts = await q('SELECT status, COUNT(*) count FROM bookings GROUP BY status');
    let thisMonth = 0, lastMonth = 0;
    if (stripe) {
      try {
        const now = new Date();
        const ms = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
        const lms = Math.floor(new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime() / 1000);
        const [tm, lm] = await Promise.all([
          stripe.paymentIntents.list({ limit: 100, created: { gte: ms } }),
          stripe.paymentIntents.list({ limit: 100, created: { gte: lms, lt: ms } }),
        ]);
        thisMonth = tm.data.filter(p => p.status === 'succeeded').reduce((s, p) => s + p.amount / 100, 0);
        lastMonth = lm.data.filter(p => p.status === 'succeeded').reduce((s, p) => s + p.amount / 100, 0);
      } catch (e) {}
    }
    const views30 = await q(`SELECT COUNT(*) FROM analytics_events WHERE event='page_view' AND created_at > NOW() - INTERVAL '30 days'`);
    const books30 = await q(`SELECT COUNT(*) FROM bookings WHERE created_at > NOW() - INTERVAL '30 days'`);
    const viewCount = parseInt(views30?.rows[0]?.count || 0);
    const bookCount = parseInt(books30?.rows[0]?.count || 0);
    res.json({
      dailyRevenue,
      tourCounts: tourCounts?.rows || [],
      dailyBookings: dailyBookings?.rows || [],
      statusCounts: statusCounts?.rows || [],
      thisMonth, lastMonth,
      conversionRate: viewCount > 0 ? ((bookCount / viewCount) * 100).toFixed(2) : 0,
      totalViews30: viewCount,
      totalBookings30: bookCount,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/analytics', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [events, byDay, ips, recent, todayRow, totalRow] = await Promise.all([
      q('SELECT event, COUNT(*) count FROM analytics_events GROUP BY event ORDER BY count DESC LIMIT 20'),
      q(`SELECT DATE(created_at) AS bucket_day, COUNT(*) visits FROM analytics_events WHERE event='page_view' GROUP BY DATE(created_at) ORDER BY DATE(created_at) DESC LIMIT 30`),
      q('SELECT ip, visits, last_seen FROM analytics_ips ORDER BY visits DESC, last_seen DESC LIMIT 500'),
      q('SELECT id,event,page,ip,data,created_at FROM analytics_events ORDER BY created_at DESC LIMIT 1000'),
      q(`SELECT COUNT(*) FROM analytics_events WHERE event='page_view' AND DATE(created_at)=$1`, [today]),
      q(`SELECT COUNT(*) FROM analytics_events WHERE event='page_view'`),
    ]);
    res.json({
      events: events?.rows || [], byDay: byDay?.rows || [], ips: ips?.rows || [],
      recent: recent?.rows || [],
      todayVisits: parseInt(todayRow?.rows[0]?.count || 0),
      totalVisits: parseInt(totalRow?.rows[0]?.count || 0),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══ CHAT LOG ═══ */
router.get('/admin/chat-sessions', async (req, res) => {
  const r = await q(`SELECT session_id, ip, lang, COUNT(*) messages, MIN(created_at) started, MAX(created_at) last_msg FROM chat_logs GROUP BY session_id,ip,lang ORDER BY last_msg DESC LIMIT 100`);
  res.json(r ? r.rows : []);
});

router.get('/admin/chat-logs', async (req, res) => {
  const { session, limit = 50 } = req.query;
  let sql = 'SELECT * FROM chat_logs';
  const vals = [];
  if (session) { sql += ' WHERE session_id=$1'; vals.push(session); }
  sql += ' ORDER BY created_at DESC LIMIT $' + (vals.length + 1);
  vals.push(Math.min(parseInt(limit) || 50, 200));
  const r = await q(sql, vals);
  res.json(r ? r.rows : []);
});

/* ═══ UTENTI ═══ */
router.get('/admin/users', async (req, res) => {
  const r = await q('SELECT id,email,name,phone,verified,referral_code,referred_by,loyalty_points,created_at FROM users ORDER BY created_at DESC');
  res.json(r ? r.rows : []);
});
router.delete('/admin/users/:id', async (req, res) => {
  await q('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});
router.post('/admin/user-photos', async (req, res) => {
  try {
    const { userEmail, bookingId, photos } = req.body;
    if (!userEmail || !photos || !Array.isArray(photos)) return res.status(400).json({ error: 'Dati mancanti' });
    const crypto = require('crypto');
    for (const photo of photos) {
      await q('INSERT INTO user_photos (id,user_email,booking_id,title,url) VALUES ($1,$2,$3,$4,$5)',
        [crypto.randomUUID(), userEmail.toLowerCase().trim(), bookingId || null, photo.title || '', photo.url]);
    }
    res.json({ success: true, count: photos.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══ EMAIL LOG ═══ */
router.get('/admin/email-logs', async (req, res) => {
  try {
    const { q: search, status, kind, sender, recipient, limit = 200 } = req.query;
    let sql = 'SELECT id,kind,direction,sender,recipient,subject,status,provider,provider_message_id,related_booking_id,related_user_email,reply_to,error,created_at,updated_at FROM email_logs WHERE 1=1';
    const vals = []; let i = 1;
    if (search) {
      sql += ` AND (recipient ILIKE $${i} OR sender ILIKE $${i} OR subject ILIKE $${i} OR COALESCE(related_booking_id,'') ILIKE $${i} OR COALESCE(related_user_email,'') ILIKE $${i})`;
      vals.push(`%${search}%`); i++;
    }
    if (status) { sql += ` AND status=$${i++}`; vals.push(status); }
    if (kind) { sql += ` AND kind=$${i++}`; vals.push(kind); }
    if (sender) { sql += ` AND sender ILIKE $${i++}`; vals.push(`%${sender}%`); }
    if (recipient) { sql += ` AND recipient ILIKE $${i++}`; vals.push(`%${recipient}%`); }
    sql += ` ORDER BY created_at DESC LIMIT $${i}`;
    vals.push(Math.min(parseInt(limit) || 200, 1000));
    const r = await q(sql, vals);
    res.json(r ? r.rows : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/email-logs/:id', async (req, res) => {
  const r = await q('SELECT * FROM email_logs WHERE id=$1', [req.params.id]);
  if (!r || !r.rows.length) return res.status(404).json({ error: 'Email log non trovato' });
  res.json(r.rows[0]);
});

router.get('/admin/email-stats', async (req, res) => {
  try {
    const [total, sent, failed, queued, latest] = await Promise.all([
      q('SELECT COUNT(*) FROM email_logs'),
      q("SELECT COUNT(*) FROM email_logs WHERE status='sent'"),
      q("SELECT COUNT(*) FROM email_logs WHERE status='failed'"),
      q("SELECT COUNT(*) FROM email_logs WHERE status='queued'"),
      q("SELECT COUNT(*) FROM email_logs WHERE created_at > NOW() - INTERVAL '24 hours'"),
    ]);
    res.json({
      total: parseInt(total?.rows?.[0]?.count || 0),
      sent: parseInt(sent?.rows?.[0]?.count || 0),
      failed: parseInt(failed?.rows?.[0]?.count || 0),
      queued: parseInt(queued?.rows?.[0]?.count || 0),
      last24h: parseInt(latest?.rows?.[0]?.count || 0),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══ CMS CONTENUTI SITO ═══ */
router.get('/admin/site-content', async (req, res) => {
  const r = await q('SELECT key, value, updated_at FROM site_content ORDER BY key');
  res.json(r ? r.rows : []);
});

router.put('/admin/site-content/:key', async (req, res) => {
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value richiesto' });
    await q(
      `INSERT INTO site_content (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
      [req.params.key, JSON.stringify(value)]
    );
    ai.invalidatePrompt();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/site-content/:key', async (req, res) => {
  await q('DELETE FROM site_content WHERE key=$1', [req.params.key]);
  ai.invalidatePrompt();
  res.json({ success: true });
});

router.post('/admin/site-content/bulk', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array richiesto' });
    for (const item of items) {
      if (!item.key || item.value === undefined) continue;
      await q(
        `INSERT INTO site_content (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [item.key, JSON.stringify(item.value)]
      );
    }
    ai.invalidatePrompt();
    res.json({ success: true, count: items.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══ CATALOGO TOUR (CRUD) ═══ */
router.get('/admin/catalog/tours', async (req, res) => {
  const tours = await catalog.getTours({ includeInactive: true, fresh: true });
  res.json(tours);
});

router.put('/admin/catalog/tours/:id', async (req, res) => {
  try {
    const { sort, active, data } = req.body;
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data richiesto' });
    await q(
      `INSERT INTO tours_catalog (id, sort, active, data, updated_at) VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (id) DO UPDATE SET sort=$2, active=$3, data=$4, updated_at=NOW()`,
      [req.params.id, parseInt(sort) || 0, active !== false, JSON.stringify(data)]
    );
    catalog.invalidate();
    ai.invalidatePrompt();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/catalog/tours/:id', async (req, res) => {
  await q('DELETE FROM tours_catalog WHERE id=$1', [req.params.id]);
  catalog.invalidate();
  ai.invalidatePrompt();
  res.json({ success: true });
});

/* ═══ COUPON (CRUD) ═══ */
router.get('/admin/coupons', async (req, res) => {
  const r = await q('SELECT * FROM coupons ORDER BY created_at DESC');
  res.json(r ? r.rows : []);
});

router.put('/admin/coupons/:code', async (req, res) => {
  try {
    const code = String(req.params.code).trim().toUpperCase();
    const { percent = 0, amountOff = 0, minAmount = 0, expires = null, maxUses = 0, active = true, note = '' } = req.body;
    await q(
      `INSERT INTO coupons (code, percent, amount_off, min_amount, expires, max_uses, active, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (code) DO UPDATE SET percent=$2, amount_off=$3, min_amount=$4, expires=$5, max_uses=$6, active=$7, note=$8`,
      [code, Number(percent) || 0, Number(amountOff) || 0, Number(minAmount) || 0, expires || null, parseInt(maxUses) || 0, !!active, note]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/admin/coupons/:code', async (req, res) => {
  await q('DELETE FROM coupons WHERE UPPER(code)=UPPER($1)', [req.params.code]);
  res.json({ success: true });
});

/* ═══ TRADUZIONE AI ═══ */
router.post('/admin/translate', async (req, res) => {
  try {
    const { source, sourceLang = 'it', langs } = req.body;
    if (!source || typeof source !== 'object') return res.status(400).json({ error: 'source richiesto' });
    const result = await ai.translateContent(source, sourceLang, Array.isArray(langs) && langs.length ? langs : undefined);
    if (!result.translations) return res.status(502).json({ error: result.warning || 'Traduzione non disponibile' });
    res.json({ success: true, translations: result.translations, mode: result.mode });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══ BACKUP DATABASE ═══ */
const backup = require('../services/backup');

router.get('/admin/backup', async (req, res) => {
  try {
    const dump = await backup.buildDump();
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="aura-backup-${day}.json"`);
    res.send(JSON.stringify(dump));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/backup/send-now', async (req, res) => {
  try {
    const result = await backup.sendBackupEmail();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/backup/status', (req, res) => {
  res.json({ emailConfigured: !!require('../config').resendApiKey, ...backup.state });
});

/* ═══ ANALISI ADS AI ═══
   Il pannello legge i CSV lato client e invia { files:[{name,text}] } */
router.post('/admin/ads/analyze', async (req, res) => {
  try {
    const { platform, goal, files, csv } = req.body || {};
    const list = Array.isArray(files) && files.length
      ? files.filter(f => f && f.text).map(f => ({ name: String(f.name || 'file.csv'), text: String(f.text) }))
      : (csv ? [{ name: 'data.csv', text: String(csv) }] : []);
    if (!list.length) return res.status(400).json({ ok: false, error: 'Nessun CSV ricevuto' });
    const { report, rows } = await ai.analyzeAds({ platform, goal, files: list });
    await q('INSERT INTO ads_reports (platform, goal, report, raw_summary) VALUES ($1,$2,$3,$4)',
      [platform || 'generic', goal || '', report, JSON.stringify({ files: list.map(f => f.name), rows })]);
    res.json({ ok: true, report, filesRead: list.length, rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/admin/ads/reports', async (req, res) => {
  const r = await q('SELECT id, platform, goal, report, raw_summary, created_at FROM ads_reports ORDER BY id DESC LIMIT 50');
  res.json(r ? r.rows : []);
});

module.exports = router;
