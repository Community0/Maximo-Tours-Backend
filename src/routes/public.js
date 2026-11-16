/* ═══════════════════════════════════════════════════════════
   ROUTE PUBBLICHE — health, chat AI, catalogo tour, quote,
   checkout sicuro, booking legacy, recensioni, date bloccate,
   analytics, contenuti sito.
═══════════════════════════════════════════════════════════ */
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { q, isReady } = require('../db');
const { getIP, chatLimiter, bookingLimiter } = require('../middleware');
const catalog = require('../services/catalog');
const ai = require('../services/ai');
const { stripe } = require('../services/stripe');
const { sendBookingRequestEmails, sendPaymentConfirmedEmail } = require('../services/email');
const { checkBookingLeadTime } = require('../services/booking-time');

const router = express.Router();
router.use((req,res,next)=>{
 const read=['/health','/catalog/tours','/blocked-dates'];
 if(req.method==='GET'&&read.includes(req.path))return next();
 if(req.method==='POST'&&req.path==='/quote')return next();
 if(req.method==='POST'&&req.path==='/checkout'&&config.enablePayments&&isReady())return next();
 return res.status(503).json({error:'Endpoint not enabled for Maximo'});
});

/* ── APPLE PAY DOMAIN VERIFICATION ── */
router.get('/.well-known/apple-developer-merchantid-domain-association', (req, res) => {
  if (!config.applePayDomainFile) return res.status(404).send('Not configured');
  res.setHeader('Content-Type', 'text/plain');
  res.send(config.applePayDomainFile);
});

/* ── HEALTH ── */
router.get('/health', async (req, res) => {
  res.status(isReady()?200:503).json({
    status: isReady()?'ok':'unavailable',
    db: isReady(),
    stripe: !!stripe,
    anthropic: ai.isAvailable(),
    email: !!config.resendApiKey,
    time: new Date().toISOString(),
    version: '5.0.0',
  });
});

/* ── CATALOGO TOUR (pubblico) ── */
router.get('/catalog/tours', async (req, res) => {
  const tours = await catalog.getTours();
  res.json(tours);
});

/* ── CONTENUTI SITO (compat v4) ── */
router.get('/site-content', async (req, res) => {
  const r = await q('SELECT key, value FROM site_content');
  const content = {};
  if (r) r.rows.forEach(row => { content[row.key] = row.value; });
  res.json(content);
});

router.get('/site-content/:key', async (req, res) => {
  const r = await q('SELECT value FROM site_content WHERE key=$1', [req.params.key]);
  if (r && r.rows.length) return res.json(r.rows[0].value);
  res.status(404).json({ error: 'Contenuto non trovato' });
});

/* ── QUOTE: preventivo calcolato lato server ── */
router.post('/quote', async (req, res) => {
  try {
    const quote = await catalog.computeQuote(req.body || {});
    if (!quote.ok) return res.status(400).json(quote);
    res.json(quote);
  } catch (e) {
    console.error('[/quote]', e.message);
    res.status(500).json({ ok: false, error: 'Errore interno' });
  }
});

/* ── COUPON: validazione rapida per la UI ── */
router.post('/coupon/validate', async (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ valid: false, error: 'Codice richiesto' });
  const r = await q('SELECT code, percent, amount_off, min_amount, expires, max_uses, used, active FROM coupons WHERE UPPER(code)=$1', [code]);
  const c = r?.rows?.[0];
  const valid = !!(c && c.active &&
    (!c.expires || new Date(c.expires) >= new Date(new Date().toDateString())) &&
    (!c.max_uses || c.used < c.max_uses));
  if (!valid) return res.json({ valid: false, error: 'Coupon non valido o scaduto' });
  res.json({ valid: true, code: c.code, percent: Number(c.percent) || 0, amountOff: Number(c.amount_off) || 0, minAmount: Number(c.min_amount) || 0 });
});

/* ── CHECKOUT SICURO: prezzo calcolato dal server, booking + PaymentIntent ── */
router.post('/checkout', bookingLimiter, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Pagamenti non disponibili. Contattaci su WhatsApp.' });
    const { customer = {}, booking = {}, attribution } = req.body || {};
    const { name, email, phone } = customer;
    if (!name || !email) return res.status(400).json({ error: 'Nome ed email obbligatori' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email non valida' });

    /* Il blocco last minute viene controllato ANCHE sul server, prima di
       creare un PaymentIntent: il frontend non può sostituire questa verifica. */
    const leadTime = checkBookingLeadTime(booking.date, booking.time);
    if (!leadTime.ok) {
      return res.status(422).json({ error: leadTime.error, code: leadTime.code });
    }

    /* pausa prenotazioni (interruttore in Microwade → Contenuti) */
    const bs = await catalog.getContentKey('business_settings', {});
    if (bs?.bookingPaused) {
      return res.status(503).json({ error: bs.pausedMessage || 'Prenotazioni momentaneamente in pausa. Scrivici su WhatsApp!' });
    }

    const quote = await catalog.computeQuote(booking);
    if (!quote.ok) return res.status(400).json({ error: quote.error || 'Preventivo non valido' });
    if (quote.totalCents < 50) return res.status(400).json({ error: 'Importo non valido' });

    /* data bloccata? */
    if (booking.date) {
      const blocked = await q('SELECT date FROM blocked_dates WHERE date=$1', [booking.date]);
      if (blocked && blocked.rows.length) {
        return res.status(409).json({ error: 'Data non disponibile. Scegli un altro giorno.' });
      }
    }

    let bookingId = 'MX' + crypto.randomBytes(16).toString('hex');
    if (isReady()) {

    }

    const pi = await stripe.paymentIntents.create({
      amount: quote.totalCents,
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: {
        bookingId,
        tour: String(quote.tourName).slice(0, 500),
        people: String(quote.people),
        mode: quote.mode,
        coupon: quote.couponApplied?.code || '',
      },
      receipt_email: email,
      description: `Maximo Tours — ${quote.tourName} [${bookingId}]`,
    });

    if (isReady()) {
      const saved = await q(
        `INSERT INTO bookings (id,name,email,phone,tour,people,date,time,notes,payment_method,stripe_payment_id,status,amount,coupon_code,breakdown)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'stripe',$10,'pending',$11,$12,$13)`,
        [
          bookingId, name, email, phone || null,
          quote.tourName, String(quote.people),
          booking.date || null, booking.time || null, booking.notes || null,
          pi.id, quote.total, quote.couponApplied?.code || null,
          JSON.stringify({ ...quote, attribution: attribution && typeof attribution === 'object' ? attribution : null }),
        ]
      );
    }

    /* A payment cannot be presented as created without a persisted booking. */
    const persisted=await q('SELECT id FROM bookings WHERE id=$1',[bookingId]);
    if(!persisted?.rows?.length){await stripe.paymentIntents.cancel(pi.id).catch(()=>{});throw new Error('Booking persistence failed');}
    /* email "richiesta ricevuta" (non blocca la risposta) */
    sendBookingRequestEmails({
      bookingId, name, email, phone,
      tour: quote.tourName, people: String(quote.people),
      date: booking.date, time: booking.time, notes: booking.notes,
      amount: quote.total, couponCode: quote.couponApplied?.code, stripePaymentId: pi.id,
    }).then(r => {
      if (r?.success) q('UPDATE bookings SET email_booking_received_sent=TRUE, updated_at=NOW() WHERE id=$1', [bookingId]);
    }).catch(() => {});

    res.json({
      success: true,
      bookingId,
      clientSecret: pi.client_secret,
      quote: { items: quote.items, subtotal: quote.subtotal, discount: quote.discount, total: quote.total },
    });
  } catch (e) {
    console.error('[/checkout]', e.message);
    res.status(500).json({ error: 'Errore interno. Contattaci su WhatsApp: ' + config.publicWhatsapp });
  }
});

/* ── STATO PRENOTAZIONE (pagina di conferma) ── */
router.get('/booking-status', async (req, res) => {
  try {
    const { pi: piId, booking: bookingId } = req.query;
    if (!piId && !bookingId) return res.status(400).json({ error: 'Parametro mancante' });
    let row = null;
    if (piId) {
      const r = await q('SELECT id,name,tour,people,date,time,status,amount FROM bookings WHERE stripe_payment_id=$1 LIMIT 1', [String(piId)]);
      row = r?.rows?.[0] || null;
    } else {
      const r = await q('SELECT id,name,tour,people,date,time,status,amount FROM bookings WHERE id=$1 LIMIT 1', [String(bookingId).toUpperCase().trim()]);
      row = r?.rows?.[0] || null;
    }
    let paymentStatus = null;
    let pi = null;
    if (piId && stripe) {
      try { pi = await stripe.paymentIntents.retrieve(String(piId)); paymentStatus = pi.status; } catch (_) {}
    }

    /* Conferma server-side senza webhook: se Stripe dice "succeeded" e la
       prenotazione è ancora pending, la confermiamo qui (stessa logica del
       webhook: stato, coupon, email — l'email parte una sola volta). */
    if (pi && paymentStatus === 'succeeded' && row && row.status === 'pending') {
      const paidEur = (pi.amount_received || pi.amount) / 100;
      await q(
        "UPDATE bookings SET status='confirmed', payment_status='paid', amount=$2, updated_at=NOW() WHERE id=$1",
        [row.id, paidEur]
      );
      const fullRes = await q('SELECT * FROM bookings WHERE id=$1 LIMIT 1', [row.id]);
      const full = fullRes?.rows?.[0];
      if (full?.coupon_code) await catalog.redeemCoupon(full.coupon_code);
      if (full && !full.email_payment_confirmed_sent) {
        sendPaymentConfirmedEmail(full, pi).then(r => {
          if (r?.success) q('UPDATE bookings SET email_payment_confirmed_sent=TRUE, updated_at=NOW() WHERE id=$1', [full.id]);
        }).catch(() => {});
      }
      row = { ...row, status: 'confirmed' };
      console.log(`✅ Pagamento confermato via booking-status: ${pi.id} — €${paidEur}`);
    }

    if (!row && !paymentStatus) return res.status(404).json({ error: 'Prenotazione non trovata' });
    res.json({ booking: row, paymentStatus });
  } catch (e) { res.status(500).json({ error: 'Errore interno' }); }
});

/* ═══ COMPAT v4 — usati dalla pagina /tours live ═══ */

/* ── PAYMENT INTENT (legacy: importo dal client — mantenuto per compatibilità).
   Quando il vecchio /tours non serve più: DISABLE_LEGACY_CHECKOUT=true su Railway
   chiude questa porta (l'unico punto dove il client decide l'importo). ── */
router.post('/create-payment-intent', async (req, res) => {
  try {
    if (process.env.DISABLE_LEGACY_CHECKOUT === 'true') {
      return res.status(410).json({ error: 'Endpoint dismesso: usa /checkout' });
    }
    if (!stripe) return res.status(503).json({ error: 'Pagamenti non disponibili. Contattaci su WhatsApp.' });
    const { amount, tour, people, customerEmail } = req.body;
    if (!amount || typeof amount !== 'number' || amount < 50 || amount > 1000000)
      return res.status(400).json({ error: 'Importo non valido' });
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: { tour: String(tour || '').slice(0, 500), people: String(people || '').slice(0, 20) },
      receipt_email: customerEmail || undefined,
      description: `Maximo Tours — ${tour || 'Tour privato'}`,
    });
    res.json({ clientSecret: pi.client_secret });
  } catch (e) {
    console.error('[/create-payment-intent]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── BOOKING (legacy) ── */
router.post('/booking', bookingLimiter, async (req, res) => {
  try {
    const { name, email, phone, tour, people, date, time, notes, paymentMethod, stripePaymentId, amount } = req.body;
    if (!name || !email || !tour) return res.status(400).json({ error: 'Campi obbligatori mancanti' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email non valida' });

    let bookingId = 'MX' + crypto.randomBytes(16).toString('hex');
    if (isReady()) {

      await q(
        `INSERT INTO bookings (id,name,email,phone,tour,people,date,time,notes,payment_method,stripe_payment_id,status,amount,email_booking_received_sent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,FALSE)`,
        [bookingId, name, email, phone || null, tour, people || null, date || null, time || null, notes || null, paymentMethod || null, stripePaymentId || null, amount || null]
      );
    }

    const reqMail = await sendBookingRequestEmails({ bookingId, name, email, phone, tour, people, date, time, notes, paymentMethod, stripePaymentId, amount }).catch(() => null);
    if (isReady() && reqMail?.success) {
      await q('UPDATE bookings SET email_booking_received_sent=TRUE, updated_at=NOW() WHERE id=$1', [bookingId]);
    }
    res.json({ success: true, bookingId });
  } catch (e) {
    console.error('[/booking]', e.message);
    res.status(500).json({ error: 'Errore interno. Contattaci su WhatsApp: ' + config.publicWhatsapp });
  }
});

/* ── CHAT AI ── */
router.post('/chat', chatLimiter, async (req, res) => {
  const fallback = { reply: `Ciao! 👋 Per informazioni e prenotazioni scrivici su WhatsApp: **${config.publicWhatsapp}** — rispondiamo in pochi minuti! 💬` };
  if (!ai.isAvailable()) return res.json(fallback);
  try {
    const { messages = [], lang = 'it', sessionId } = req.body;
    const ip = getIP(req);
    const sid = sessionId || crypto.randomUUID();
    const nLang = ai.normalizeLang(lang);

    const rawHistory = messages.slice(-14).filter(m => m.role && m.content && typeof m.content === 'string');
    const cleanHistory = [];
    for (const msg of rawHistory) {
      const role = msg.role === 'assistant' ? 'assistant' : 'user';
      if (cleanHistory.length === 0 && role === 'assistant') continue;
      if (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === role) continue;
      cleanHistory.push({ role, content: String(msg.content).slice(0, 800) });
    }
    const msgsToSend = cleanHistory.length ? cleanHistory : [{ role: 'user', content: 'Ciao' }];

    const reply = (await ai.chat(msgsToSend, nLang)) || 'Come posso aiutarti? 😊';

    const lastUser = cleanHistory.filter(m => m.role === 'user').pop();
    if (lastUser) {
      q('INSERT INTO chat_logs (session_id,role,message,lang,ip) VALUES ($1,$2,$3,$4,$5)', [sid, 'user', lastUser.content, nLang, ip]);
      q(`INSERT INTO analytics_events (event,page,ip) VALUES ('chat_message','chatbot',$1)`, [ip]);
    }
    q('INSERT INTO chat_logs (session_id,role,message,lang,ip) VALUES ($1,$2,$3,$4,$5)', [sid, 'assistant', reply, nLang, ip]);

    res.json({ reply, sessionId: sid });
  } catch (e) {
    console.error('[/chat]', e.message);
    res.json(fallback);
  }
});

/* ── RECENSIONI ── */
router.get('/reviews', async (req, res) => {
  const r = await q('SELECT * FROM reviews WHERE approved=TRUE ORDER BY created_at DESC LIMIT 50');
  res.json(r ? r.rows : []);
});

/* ── RECENSIONI GOOGLE (Places API, cache 12h su DB) ──
   Env necessarie: GOOGLE_MAPS_API_KEY + GOOGLE_PLACE_ID
   (il Place ID è anche configurabile da Microwade → chiave google_settings) */
router.get('/reviews/google', async (req, res) => {
  try {
    const settings = await catalog.getContentKey('google_settings', {});
    const placeId = settings?.placeId || config.googlePlaceId;
    if (!placeId || !config.googleApiKey) {
      return res.json({ configured: false });
    }

    const cache = await catalog.getContentKey('google_reviews_cache', null);
    const fresh = cache?.fetchedAt && Date.now() - new Date(cache.fetchedAt).getTime() < 12 * 3600 * 1000;
    if (fresh && cache.data) {
      return res.json({ configured: true, placeId, cached: true, ...cache.data });
    }

    const url = 'https://maps.googleapis.com/maps/api/place/details/json'
      + '?place_id=' + encodeURIComponent(placeId)
      + '&fields=' + encodeURIComponent('rating,user_ratings_total,reviews,url,name')
      + '&key=' + config.googleApiKey;
    const j = await fetch(url).then(r => r.json());

    if (j.status !== 'OK') {
      console.warn('[google-reviews]', j.status, j.error_message || '');
      /* se Google fallisce, servi comunque l'ultima cache disponibile */
      if (cache?.data) return res.json({ configured: true, placeId, stale: true, ...cache.data });
      return res.json({ configured: true, placeId, error: j.status });
    }

    const data = {
      name: j.result.name || 'Maximo Tours',
      rating: j.result.rating || null,
      total: j.result.user_ratings_total || 0,
      url: j.result.url || null,
      reviews: (j.result.reviews || [])
        .filter(r => r && r.text && r.author_name)
        .map(r => ({
          author: r.author_name,
          avatar: r.profile_photo_url || null,
          rating: r.rating,
          text: String(r.text).slice(0, 600),
          time: r.relative_time_description || '',
          lang: r.language || '',
        })),
    };

    await q(
      `INSERT INTO site_content (key, value, updated_at) VALUES ('google_reviews_cache', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify({ fetchedAt: new Date().toISOString(), data })]
    );

    res.json({ configured: true, placeId, ...data });
  } catch (e) {
    console.error('[/reviews/google]', e.message);
    res.json({ configured: false, error: e.message });
  }
});

router.post('/reviews', async (req, res) => {
  try {
    const { name, location, stars, text, tourName } = req.body;
    if (!name || !text || !stars) return res.status(400).json({ error: 'Campi mancanti' });
    const s = parseInt(stars);
    if (isNaN(s) || s < 1 || s > 5) return res.status(400).json({ error: 'Stelle non valide' });
    const id = crypto.randomUUID();
    await q('INSERT INTO reviews (id,name,location,tour_name,stars,text,approved) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, name, location || '', tourName || '', s, text, s >= 4]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Errore interno' }); }
});

router.post('/review-login', async (req, res) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'Codice prenotazione richiesto' });
    const id = bookingId.toUpperCase().trim();
    const r = await q('SELECT id,name,tour,email FROM bookings WHERE id=$1', [id]);
    if (!r || !r.rows.length) return res.status(404).json({ error: 'Prenotazione non trovata' });
    const existing = await q('SELECT id FROM reviews WHERE booking_id=$1', [id]);
    if (existing && existing.rows.length) return res.status(409).json({ error: 'Hai già lasciato una recensione per questa prenotazione' });
    res.json({ success: true, name: r.rows[0].name, tour: r.rows[0].tour });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/review-submit', async (req, res) => {
  try {
    const { bookingId, stars, text, location } = req.body;
    if (!bookingId || !stars || !text) return res.status(400).json({ error: 'Campi mancanti' });
    const s = parseInt(stars);
    if (isNaN(s) || s < 1 || s > 5) return res.status(400).json({ error: 'Stelle non valide' });
    const id = bookingId.toUpperCase().trim();
    const bk = await q('SELECT id,name,tour FROM bookings WHERE id=$1', [id]);
    if (!bk || !bk.rows.length) return res.status(404).json({ error: 'Prenotazione non trovata' });
    const dup = await q('SELECT id FROM reviews WHERE booking_id=$1', [id]);
    if (dup && dup.rows.length) return res.status(409).json({ error: 'Recensione già inviata' });
    await q('INSERT INTO reviews (id,name,location,tour_name,stars,text,approved,booking_id) VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7)',
      [crypto.randomUUID(), bk.rows[0].name, location || '', bk.rows[0].tour || '', s, text, id]);
    /* review machine: il booking ha chiuso il cerchio */
    await q("UPDATE bookings SET review_status='ricevuta', updated_at=NOW() WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── DATE BLOCCATE ── */
router.get('/blocked-dates', async (req, res) => {
  const r = await q('SELECT * FROM blocked_dates ORDER BY date');
  res.json(r ? r.rows : []);
});

/* ── ANALYTICS ── */
router.post('/analytics/track', async (req, res) => {
  try {
    const { event, page, data } = req.body;
    if (!event) return res.status(400).json({ error: 'event required' });
    const ev = String(event).slice(0, 80);
    const ip = getIP(req);
    const ua = (req.headers['user-agent'] || '').slice(0, 500) || null;
    const enrichedData = data ? { ...data, userAgent: ua } : (ua ? { userAgent: ua } : null);
    await q('INSERT INTO analytics_events (event,page,ip,user_agent,data) VALUES ($1,$2,$3,$4,$5)',
      [ev, page?.slice(0, 100) || null, ip, ua, enrichedData ? JSON.stringify(enrichedData) : null]);
    if (ev === 'page_view') {
      await q(`INSERT INTO analytics_ips (ip,visits,last_seen) VALUES ($1,1,NOW())
         ON CONFLICT (ip) DO UPDATE SET visits=analytics_ips.visits+1, last_seen=NOW()`, [ip]);
    } else {
      await q(`INSERT INTO analytics_ips (ip,visits,last_seen) VALUES ($1,0,NOW())
         ON CONFLICT (ip) DO UPDATE SET last_seen=NOW()`, [ip]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[analytics/track]', e.message);
    res.json({ ok: false });
  }
});

router.get('/analytics/health', async (req, res) => {
  const last = await q('SELECT created_at FROM analytics_events ORDER BY created_at DESC LIMIT 1');
  const count24h = await q(`SELECT COUNT(*) FROM analytics_events WHERE created_at > NOW() - INTERVAL '24 hours'`);
  const totalCount = await q('SELECT COUNT(*) FROM analytics_events');
  res.json({
    dbReady: isReady(),
    lastEvent: last?.rows[0]?.created_at || null,
    events24h: parseInt(count24h?.rows[0]?.count || 0),
    totalEvents: parseInt(totalCount?.rows[0]?.count || 0),
  });
});

module.exports = router;
