/* ═══════════════════════════════════════════════════════════
   ROUTE ADMIN v2 — usate dal nuovo Microwade.
   Tutte NUOVE e sotto /admin/v2: nessun endpoint esistente
   viene modificato, il vecchio pannello continua a funzionare.
   Scritture con errori veri (niente "success" su query fallita).
═══════════════════════════════════════════════════════════ */
const express = require('express');
const config = require('../config');
const { getPool } = require('../db');
const { adminAuth } = require('../middleware');
const catalog = require('../services/catalog');
const ai = require('../services/ai');
const ogre = require('../services/ogre');
const { stripe } = require('../services/stripe');

const router = express.Router();

/* segnaposto pubblico e innocuo: dice solo quale versione gira e da quando (serve a verificare un deploy) */
const STARTED = new Date().toISOString();
router.get('/build', (req, res) => res.json({ build: 'microwade-v6', started: STARTED }));

router.use('/admin/v2', adminAuth);

/* query che lancia: se il database non risponde il pannello deve saperlo */
async function dbq(sql, vals = []) {
  const pool = getPool();
  if (!pool) { const e = new Error('Database non disponibile'); e.status = 503; throw e; }
  return pool.query(sql, vals);
}
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error('[admin/v2]', req.method, req.path, e.message);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Operazione non riuscita: ' + e.message });
});
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const isTime = v => /^\d{2}:\d{2}$/.test(String(v || ''));

async function audit(entity, id, action, before, after) {
  try {
    await dbq('INSERT INTO audit_log (entity, entity_id, action, before, after) VALUES ($1,$2,$3,$4,$5)',
      [entity, String(id), action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
  } catch (e) { console.warn('[audit]', e.message); }
}

async function loadBooking(id) {
  const r = await dbq('SELECT * FROM bookings WHERE id=$1', [id]);
  return r.rows[0] || null;
}

/* ═══ AVVIO: tutto ciò che serve al pannello in una chiamata ═══ */
router.get('/admin/v2/boot', wrap(async (req, res) => {
  const rules = await ogre.getRules({ fresh: true });
  const days = Math.min(3650, Math.max(30, parseInt(req.query.days, 10) || 800));
  const [bk, dr, bl, sc, cp, pt, sp] = await Promise.all([
    dbq(`SELECT * FROM bookings WHERE archived_at IS NULL AND created_at > NOW() - ($1 || ' days')::interval ORDER BY created_at DESC`, [String(days)]),
    dbq('SELECT * FROM drivers ORDER BY active DESC, name'),
    dbq('SELECT date, reason FROM blocked_dates ORDER BY date'),
    dbq("SELECT key, value FROM site_content WHERE key IN ('business_settings','booking_extras','announcement')"),
    dbq('SELECT * FROM coupons ORDER BY created_at DESC'),
    dbq('SELECT * FROM partners ORDER BY active DESC, name'),
    dbq('SELECT * FROM ogre_splits ORDER BY month DESC'),
  ]);
  const tours = await catalog.getTours({ includeInactive: true, fresh: true });
  const content = {}; sc.rows.forEach(r => { content[r.key] = r.value; });
  const total = await dbq('SELECT COUNT(*)::int AS n FROM bookings WHERE archived_at IS NULL');
  res.json({
    version: 2, today: ogre.romeToday(), rules,
    bookings: bk.rows.map(b => ogre.shape(b, rules)),
    bookingsTotal: total.rows[0].n,
    drivers: dr.rows.map(d => ({ id: d.id, name: d.name, phone: d.phone, languages: d.languages || [], rateStandard: Number(d.rate_standard) || 0, rateNight: Number(d.rate_night) || 0, active: d.active })),
    blocked: bl.rows, content, tours,
    coupons: cp.rows.map(c => ({ code: c.code, percent: Number(c.percent) || 0, amountOff: Number(c.amount_off) || 0, minAmount: Number(c.min_amount) || 0, expires: c.expires, maxUses: c.max_uses, used: c.used, active: c.active, note: c.note })),
    partners: pt.rows.map(p => ({ code: p.code, name: p.name, model: p.model, pct: Number(p.pct) || 0, active: p.active })),
    splits: sp.rows.map(s => ({ month: s.month, amount: Number(s.amount) || 0, shares: s.shares, splitAt: s.split_at, note: s.note })),
    stripe: !!stripe, email: !!config.resendApiKey,
  });
}));

/* ═══ PRENOTAZIONI ═══ */
/* elenco completo (nessun limite a 300) + aggiornamenti incrementali per il "dal vivo" */
router.get('/admin/v2/bookings', wrap(async (req, res) => {
  const rules = await ogre.getRules();
  const { from, to, updatedSince, archived } = req.query;
  let sql = 'SELECT * FROM bookings WHERE ' + (archived === '1' ? 'archived_at IS NOT NULL' : 'archived_at IS NULL');
  const vals = []; let i = 1;
  if (from) { if (!isDate(from)) throw bad('from non valido'); sql += ` AND date >= $${i++}`; vals.push(from); }
  if (to) { if (!isDate(to)) throw bad('to non valido'); sql += ` AND date <= $${i++}`; vals.push(to); }
  if (updatedSince) {
    const d = new Date(updatedSince); if (isNaN(d)) throw bad('updatedSince non valido');
    sql += ` AND updated_at > $${i++}`; vals.push(d.toISOString());
  }
  sql += ' ORDER BY created_at DESC LIMIT 5000';
  const r = await dbq(sql, vals);
  res.json({ now: new Date().toISOString(), today: ogre.romeToday(), bookings: r.rows.map(b => ogre.shape(b, rules)) });
}));

const PAY_STATUS = ['paid', 'link_sent', 'da_incassare', 'da_definire', 'deposit', 'refunded'];
const STATUS = ['pending', 'confirmed', 'cancelled', 'refunded', 'payment_failed', 'completed', 'no_show'];

function costsFromBody(c, current) {
  if (!c || typeof c !== 'object') throw bad('costs non valido');
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : d; };
  return {
    v: 2, auto: !!c.auto,
    mezzo: n(c.mezzo, current.mezzo), driver: n(c.driver, current.driver), stripe: n(c.stripe, current.stripe),
    acque: n(c.acque, current.acque), altri: n(c.altri, current.altri || 0),
    altriNota: typeof c.altriNota === 'string' ? c.altriNota.slice(0, 200) : (current.altriNota || ''),
    vehicle: typeof c.vehicle === 'string' ? c.vehicle.slice(0, 60) : current.vehicle,
    hand: c.hand && typeof c.hand === 'object' ? c.hand : {},
  };
}

/* creazione manuale (WhatsApp, hotel, telefono) con eventuale link di pagamento */
router.post('/admin/v2/bookings', wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) throw bad('Il nome del cliente è obbligatorio');
  if (!isDate(b.date)) throw bad('Data non valida');
  if (b.time && !isTime(b.time)) throw bad('Ora non valida');
  const tour = String(b.tour || '').trim(); if (!tour) throw bad('Tour obbligatorio');
  const pax = Math.min(30, Math.max(1, parseInt(b.pax, 10) || 1));
  const amount = Math.round((Number(b.amount) || 0) * 100) / 100;
  if (amount < 0) throw bad('Importo non valido');
  const rules = await ogre.getRules();

  const idRes = await dbq("SELECT 'AT'||nextval('booking_counter') AS id");
  const id = idRes.rows[0].id;
  const method = ['stripe_link', 'cash', 'hotel', 'bank', 'manual'].includes(b.paymentMethod) ? b.paymentMethod : 'manual';
  let payStatus = PAY_STATUS.includes(b.paymentStatus) ? b.paymentStatus : 'da_incassare';
  let payLink = null, stripeSessionId = null;

  if (b.generateLink) {
    if (!stripe) throw bad('Pagamenti online non configurati su questo server', 503);
    if (amount < 0.5) throw bad('Importo troppo basso per un link di pagamento');
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: Math.round(amount * 100), product_data: { name: `Maximo Tours — ${tour.slice(0, 120)}`, description: `${b.date}${b.time ? ' · ' + b.time : ''} · ${pax} guests · booking ${id}` } } }],
      metadata: { bookingId: id, source: 'microwade-v2' },
      success_url: `${config.siteUrl}/booking-success/?booking=${encodeURIComponent(id)}&redirect_status=succeeded`,
      cancel_url: config.siteUrl,
      expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
      ...(b.email ? { customer_email: b.email } : {}),
    });
    payLink = session.url; stripeSessionId = session.id; payStatus = 'link_sent';
  }
  const finalMethod = payLink ? 'stripe_link' : method;
  const status = payStatus === 'paid' ? 'confirmed' : (STATUS.includes(b.status) ? b.status : 'confirmed');
  const notes = [b.pickup ? `Pickup: ${String(b.pickup).trim()}` : '', b.language ? `Lingua: ${String(b.language).trim()}` : '', String(b.notes || '').trim()].filter(Boolean).join(' · ');
  const row = { people: String(pax), payment_method: finalMethod, driver_fee: b.driverFee != null ? Number(b.driverFee) : null, vehicle: b.vehicle || null };
  const costs = b.costs ? costsFromBody(b.costs, ogre.defaultCosts(row, rules)) : ogre.defaultCosts(row, rules);

  await dbq(
    `INSERT INTO bookings (id,name,email,phone,tour,people,date,time,notes,payment_method,status,amount,channel,partner_source,payment_status,costs,breakdown,driver_id,driver_fee,vehicle)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [id, name, String(b.email || '').trim() || `${id.toLowerCase()}@manual.aura`, String(b.phone || '').trim() || null, tour, String(pax),
      b.date, b.time || null, notes || null, finalMethod, status, amount,
      b.channel || 'whatsapp', b.partnerSource || null, payStatus, JSON.stringify(costs),
      JSON.stringify({ manual: true, stripeSessionId, createdBy: 'microwade-v2' }),
      b.driverId || null, b.driverFee != null ? Number(b.driverFee) : null, b.vehicle || costs.vehicle || null]
  );
  const saved = await loadBooking(id);
  await audit('booking', id, 'create', null, { name, date: b.date, amount });
  res.json({ success: true, booking: ogre.shape(saved, rules), payLink });
}));

/* modifica: tutti i campi, con validazione e registro delle modifiche */
router.patch('/admin/v2/bookings/:id', wrap(async (req, res) => {
  const cur = await loadBooking(req.params.id);
  if (!cur) throw bad('Prenotazione non trovata', 404);
  const rules = await ogre.getRules();
  const b = req.body || {};
  const set = []; const vals = []; let i = 1; const changed = {};
  const put = (col, val, key) => { set.push(`${col}=$${i++}`); vals.push(val); changed[key || col] = val; };

  if (b.name !== undefined) { const v = String(b.name).trim(); if (!v) throw bad('Il nome non può essere vuoto'); put('name', v); }
  if (b.email !== undefined) { const v = String(b.email).trim(); if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad('Email non valida'); if (v) put('email', v); }
  if (b.phone !== undefined) put('phone', String(b.phone).trim() || null);
  if (b.tour !== undefined) { const v = String(b.tour).trim(); if (!v) throw bad('Tour obbligatorio'); put('tour', v); }
  if (b.pax !== undefined) { const v = parseInt(b.pax, 10); if (!(v >= 1 && v <= 30)) throw bad('Numero di ospiti non valido'); put('people', String(v), 'pax'); }
  if (b.date !== undefined) { if (!isDate(b.date)) throw bad('Data non valida'); put('date', b.date); }
  if (b.time !== undefined) { if (b.time && !isTime(b.time)) throw bad('Ora non valida'); put('time', b.time || null); }
  if (b.notes !== undefined) put('notes', String(b.notes).slice(0, 4000) || null);
  if (b.notesAdmin !== undefined) put('notes_admin', String(b.notesAdmin).slice(0, 4000));
  if (b.amount !== undefined) { const v = Number(b.amount); if (!Number.isFinite(v) || v < 0) throw bad('Importo non valido'); put('amount', Math.round(v * 100) / 100); }
  if (b.status !== undefined) { if (!STATUS.includes(b.status)) throw bad('Stato non valido'); put('status', b.status); }
  if (b.paymentStatus !== undefined) { if (b.paymentStatus && !PAY_STATUS.includes(b.paymentStatus)) throw bad('Stato pagamento non valido'); put('payment_status', b.paymentStatus || null, 'paymentStatus'); }
  if (b.paymentMethod !== undefined) put('payment_method', String(b.paymentMethod).slice(0, 30) || null, 'paymentMethod');
  if (b.channel !== undefined) put('channel', String(b.channel).slice(0, 30) || null);
  if (b.partnerSource !== undefined) put('partner_source', String(b.partnerSource).slice(0, 60) || null, 'partnerSource');
  if (b.driverId !== undefined) put('driver_id', b.driverId || null, 'driverId');
  if (b.driverFee !== undefined) put('driver_fee', b.driverFee === null || b.driverFee === '' ? null : Math.max(0, Number(b.driverFee) || 0), 'driverFee');
  if (b.driverPaid !== undefined) put('driver_paid', !!b.driverPaid, 'driverPaid');
  if (b.vehicle !== undefined) put('vehicle', String(b.vehicle).slice(0, 60) || null);
  if (b.costs !== undefined) {
    /* i costi di partenza sono quelli attuali, letti con le regole in vigore */
    const merged = { ...cur, ...(b.pax !== undefined ? { people: String(b.pax) } : {}), ...(b.paymentMethod !== undefined ? { payment_method: b.paymentMethod } : {}) };
    put('costs', JSON.stringify(b.costs === null ? {} : costsFromBody(b.costs, ogre.readCosts(merged, rules))), 'costs');
  }
  if (!set.length) throw bad('Nessun campo da aggiornare');
  set.push('updated_at=NOW()'); vals.push(cur.id);
  const r = await dbq(`UPDATE bookings SET ${set.join(',')} WHERE id=$${i} RETURNING *`, vals);
  if (!r.rowCount) throw bad('Prenotazione non trovata', 404);
  const before = {}; Object.keys(changed).forEach(k => { before[k] = k === 'pax' ? cur.people : cur[{ paymentStatus: 'payment_status', paymentMethod: 'payment_method', partnerSource: 'partner_source', driverId: 'driver_id', driverFee: 'driver_fee', driverPaid: 'driver_paid' }[k] || k]; });
  await audit('booking', cur.id, 'update', before, changed);
  res.json({ success: true, booking: ogre.shape(r.rows[0], rules) });
}));

/* archiviazione al posto della cancellazione: la riga resta nel database */
router.post('/admin/v2/bookings/:id/archive', wrap(async (req, res) => {
  const r = await dbq('UPDATE bookings SET archived_at=NOW(), updated_at=NOW() WHERE id=$1 AND archived_at IS NULL RETURNING id', [req.params.id]);
  if (!r.rowCount) throw bad('Prenotazione non trovata o già archiviata', 404);
  await audit('booking', req.params.id, 'archive', null, null);
  res.json({ success: true });
}));
router.post('/admin/v2/bookings/:id/unarchive', wrap(async (req, res) => {
  const r = await dbq('UPDATE bookings SET archived_at=NULL, updated_at=NOW() WHERE id=$1 RETURNING id', [req.params.id]);
  if (!r.rowCount) throw bad('Prenotazione non trovata', 404);
  await audit('booking', req.params.id, 'unarchive', null, null);
  res.json({ success: true });
}));

/* fotografia dei costi: fissa i costi di default sulle prenotazioni pagate che non ne hanno,
   così un futuro cambio di regole non riscrive lo storico. Non tocca costi già salvati. */
router.post('/admin/v2/costs/snapshot', wrap(async (req, res) => {
  const rules = await ogre.getRules({ fresh: true });
  const r = await dbq(`SELECT * FROM bookings WHERE archived_at IS NULL AND status NOT IN ('cancelled','refunded','payment_failed')
                       AND (costs IS NULL OR costs = '{}'::jsonb OR costs = 'null'::jsonb)`);
  let n = 0;
  for (const b of r.rows) {
    if (!ogre.isPaid(b)) continue;
    const u = await dbq(`UPDATE bookings SET costs=$1 WHERE id=$2 AND (costs IS NULL OR costs = '{}'::jsonb OR costs = 'null'::jsonb)`,
      [JSON.stringify(ogre.defaultCosts(b, rules)), b.id]);
    n += u.rowCount;
  }
  if (n) await audit('costs', 'snapshot', 'snapshot', null, { count: n });
  res.json({ success: true, count: n });
}));

/* ═══ REGOLE DEGLI OGRE ═══ */
router.get('/admin/v2/rules', wrap(async (req, res) => { res.json(await ogre.getRules({ fresh: true })); }));
router.put('/admin/v2/rules', wrap(async (req, res) => {
  const before = await ogre.getRules({ fresh: true });
  const rules = ogre.normalizeRules(req.body);
  await dbq(`INSERT INTO admin_settings (key, value, updated_at) VALUES ('ogre_rules', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`, [JSON.stringify(rules)]);
  ogre.invalidate();
  await audit('rules', 'ogre_rules', 'update', before, rules);
  res.json({ success: true, rules });
}));

/* impostazioni private del pannello (mai esposte da /site-content) */
router.get('/admin/v2/settings/:key', wrap(async (req, res) => {
  const r = await dbq('SELECT value FROM admin_settings WHERE key=$1', [req.params.key]);
  res.json({ value: r.rows.length ? r.rows[0].value : null });
}));
router.put('/admin/v2/settings/:key', wrap(async (req, res) => {
  if (!/^[a-z0-9_]{2,40}$/.test(req.params.key) || req.params.key === 'ogre_rules') throw bad('Chiave non valida');
  if (req.body?.value === undefined) throw bad('value richiesto');
  await dbq(`INSERT INTO admin_settings (key, value, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`, [req.params.key, JSON.stringify(req.body.value)]);
  res.json({ success: true });
}));

/* ═══ DIVISIONE TRA GLI OGRE ═══ */
router.post('/admin/v2/splits/:month', wrap(async (req, res) => {
  const month = req.params.month; if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Mese non valido');
  const rules = await ogre.getRules();
  const r = await dbq(`SELECT * FROM bookings WHERE archived_at IS NULL AND date LIKE $1`, [month + '%']);
  const amount = Math.round(r.rows.reduce((s, b) => s + ogre.shape(b, rules).net, 0) * 100) / 100;
  const a = Math.round(amount * rules.split.pctA) / 100;
  const shares = { [rules.split.a]: a, [rules.split.b]: Math.round((amount - a) * 100) / 100 };
  await dbq(`INSERT INTO ogre_splits (month, amount, shares, note, split_at) VALUES ($1,$2,$3,$4,NOW())
             ON CONFLICT (month) DO UPDATE SET amount=$2, shares=$3, note=$4, split_at=NOW()`,
    [month, amount, JSON.stringify(shares), String(req.body?.note || '').slice(0, 300)]);
  await audit('split', month, 'split', null, { amount, shares });
  res.json({ success: true, split: { month, amount, shares, splitAt: new Date().toISOString() } });
}));
router.delete('/admin/v2/splits/:month', wrap(async (req, res) => {
  await dbq('DELETE FROM ogre_splits WHERE month=$1', [req.params.month]);
  await audit('split', req.params.month, 'unsplit', null, null);
  res.json({ success: true });
}));

/* ═══ PAGAMENTI STRIPE: elenco completo e paginato, con commissione reale ═══ */
let payCache = { key: '', at: 0, data: null };
router.get('/admin/v2/stripe/payments', wrap(async (req, res) => {
  if (!stripe) return res.json({ configured: false, payments: [] });
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) throw bad('from e to obbligatori (AAAA-MM-GG)');
  const key = from + '|' + to;
  if (payCache.key === key && Date.now() - payCache.at < 60000 && req.query.fresh !== '1') return res.json(payCache.data);
  /* margine di un giorno ai due lati: il filtro vero è sul giorno a Roma */
  const gte = Math.floor(new Date(from + 'T00:00:00Z').getTime() / 1000) - 86400;
  const lte = Math.floor(new Date(to + 'T23:59:59Z').getTime() / 1000) + 86400;
  const out = []; let pages = 0, truncated = false;
  for await (const ch of stripe.charges.list({ limit: 100, created: { gte, lte }, expand: ['data.balance_transaction'] })) {
    if (++pages > 3000) { truncated = true; break; }
    if (ch.status !== 'succeeded') continue;
    const day = ogre.romeDay(new Date(ch.created * 1000));
    if (day < from || day > to) continue;
    const bt = ch.balance_transaction && typeof ch.balance_transaction === 'object' ? ch.balance_transaction : null;
    out.push({
      id: typeof ch.payment_intent === 'string' ? ch.payment_intent : (ch.payment_intent?.id || ch.id),
      chargeId: ch.id, amount: ch.amount / 100, refunded: (ch.amount_refunded || 0) / 100,
      fee: bt ? bt.fee / 100 : null, net: bt ? bt.net / 100 : null,
      created: new Date(ch.created * 1000).toISOString(), day,
      email: ch.billing_details?.email || ch.receipt_email || null,
      name: ch.billing_details?.name || null, description: ch.description || null,
      metaBooking: ch.metadata?.bookingId || null,
    });
  }
  const ids = out.map(p => p.id);
  const known = ids.length ? await dbq('SELECT id, stripe_payment_id FROM bookings WHERE stripe_payment_id = ANY($1)', [ids]) : { rows: [] };
  const map = {}; known.rows.forEach(r => { map[r.stripe_payment_id] = r.id; });
  out.forEach(p => { p.bookingId = map[p.id] || p.metaBooking || null; delete p.metaBooking; });
  const data = { configured: true, truncated, from, to, payments: out };
  payCache = { key, at: Date.now(), data };
  res.json(data);
}));

/* collega un pagamento Stripe a una prenotazione esistente */
router.post('/admin/v2/stripe/link', wrap(async (req, res) => {
  const { paymentId, bookingId } = req.body || {};
  if (!paymentId || !bookingId) throw bad('paymentId e bookingId obbligatori');
  const r = await dbq(`UPDATE bookings SET stripe_payment_id=$1, payment_status='paid', status=CASE WHEN status='pending' THEN 'confirmed' ELSE status END, updated_at=NOW() WHERE id=$2 RETURNING id`, [String(paymentId), String(bookingId)]);
  if (!r.rowCount) throw bad('Prenotazione non trovata', 404);
  payCache = { key: '', at: 0, data: null };
  await audit('booking', bookingId, 'link-payment', null, { paymentId });
  res.json({ success: true });
}));

/* ═══ SITO: salvataggi con errori veri (stesse tabelle degli endpoint esistenti) ═══ */
router.put('/admin/v2/content/:key', wrap(async (req, res) => {
  if (!['business_settings', 'booking_extras', 'announcement'].includes(req.params.key)) throw bad('Chiave non modificabile da qui');
  if (req.body?.value === undefined || req.body.value === null || typeof req.body.value !== 'object') throw bad('value non valido');
  const before = await dbq('SELECT value FROM site_content WHERE key=$1', [req.params.key]);
  await dbq(`INSERT INTO site_content (key, value, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`, [req.params.key, JSON.stringify(req.body.value)]);
  ai.invalidatePrompt();
  await audit('content', req.params.key, 'update', before.rows[0]?.value || null, req.body.value);
  res.json({ success: true });
}));

/* prezzi di un tour: aggiorna SOLO pricing.private e active, lasciando intatto tutto il resto della scheda */
router.put('/admin/v2/tours/:id/pricing', wrap(async (req, res) => {
  const r = await dbq('SELECT id, sort, active, data FROM tours_catalog WHERE id=$1', [req.params.id]);
  const t = r.rows[0]; if (!t) throw bad('Tour non trovato', 404);
  const data = { ...t.data }; const before = { active: t.active, pricing: t.data?.pricing };
  let active = t.active;
  if (req.body?.active !== undefined) active = !!req.body.active;
  if (req.body?.private !== undefined) {
    /* aggiorna solo le fasce inviate: un tour che ha una sola fascia (es. 1-3) resta con quella */
    const p = req.body.private || {}; const out = { ...((data.pricing && data.pricing.private) || {}) }; let n = 0;
    for (const k of ['1-3', '4-5', '6-7']) {
      if (p[k] === undefined || p[k] === null) continue;
      const v = Number(p[k]); if (!Number.isFinite(v) || v < 50 || v > 5000) throw bad(`Prezzo ${k} non valido (tra 50 e 5000)`);
      out[k] = Math.round(v * 100) / 100; n++;
    }
    if (!n) throw bad('Nessun prezzo da aggiornare');
    data.pricing = { ...(data.pricing || {}), private: out };
  }
  await dbq('UPDATE tours_catalog SET active=$1, data=$2, updated_at=NOW() WHERE id=$3', [active, JSON.stringify(data), t.id]);
  catalog.invalidate(); ai.invalidatePrompt();
  await audit('tour', t.id, 'pricing', before, { active, pricing: data.pricing });
  res.json({ success: true });
}));

/* ═══ REGISTRO DELLE MODIFICHE ═══ */
router.get('/admin/v2/audit', wrap(async (req, res) => {
  const r = await dbq('SELECT * FROM audit_log ORDER BY id DESC LIMIT $1', [Math.min(500, parseInt(req.query.limit, 10) || 100)]);
  res.json(r.rows);
}));

module.exports = router;
