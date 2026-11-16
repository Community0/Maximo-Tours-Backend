/* ═══════════════════════════════════════════════════════════
   CATALOGO & PRICING — la fonte di verità dei prezzi.
   Il frontend NON invia mai importi: chiede un preventivo
   (quote) e il server calcola tutto dal catalogo nel DB.
═══════════════════════════════════════════════════════════ */
const { q } = require('../db');

let cache = { tours: null, at: 0 };
const CACHE_MS = 30000;

/* ── Video hover dei tour (file già presenti nella cartella /media/ su Aruba).
   I tour vengono letti da PostgreSQL: il seed iniziale NON aggiorna le righe
   già presenti. Questa mappatura aggiunge hoverVideo solo se assente/vuoto
   nell'oggetto restituito dall'API, senza scrivere sul DB e senza modificare
   prezzi, disponibilità o altri campi.

   Per disattivare intenzionalmente il fallback su un tour, impostare
   hoverVideo: false nel JSON del catalogo. Un valore non vuoto nel DB
   ha sempre la precedenza su quanto definito qui. */
const HOVER_VIDEO_FALLBACKS = Object.freeze({
  grande_bellezza: '/media/grandebellezza.mp4',
  full_roma:       '/media/fullroma.mp4',
  roma_night:      '/media/romebynight.mp4',
  tour_van:        '/media/vantour.mp4',
  tour_500:        '/media/video500.mp4',
  concierge_van:   '/media/van-concierge.mp4', // verificare il nome completo su Aruba
  // custom, vip_tour, ecc.: mappatura non ancora confermata.
});

function withHoverVideoFallback(tour) {
  const fallback = HOVER_VIDEO_FALLBACKS[tour.id];
  if (!fallback) return tour;
  const value = tour.hoverVideo;
  if (value === undefined || value === null || value === '') {
    return { ...tour, hoverVideo: fallback };
  }
  return tour;
}


async function getTours({ includeInactive = false, fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cache.tours && now - cache.at < CACHE_MS) {
    return includeInactive ? cache.tours : cache.tours.filter(t => t.active);
  }
  const r = await q('SELECT id, sort, active, data, updated_at FROM tours_catalog ORDER BY sort, id');
  if(!r)throw new Error('Catalogue database unavailable');
  const tours = r
    ? r.rows.map(row => withHoverVideoFallback({ id: row.id, sort: row.sort, active: row.active, updatedAt: row.updated_at, ...row.data }))
    : [];
  cache = { tours, at: now };
  return includeInactive ? tours : tours.filter(t => t.active);
}

function invalidate() { cache = { tours: null, at: 0 }; }

async function getTour(id) {
  const tours = await getTours({ includeInactive: true });
  return tours.find(t => t.id === id) || null;
}

async function getContentKey(key, fallback = null) {
  const r = await q('SELECT value FROM site_content WHERE key=$1', [key]);
  return r && r.rows.length ? r.rows[0].value : fallback;
}

function paxBand(people) {
  const n = Math.max(1, parseInt(people) || 1);
  if (n <= 3) return '1-3';
  if (n === 4) return '4';
  return '5-7';
}

/* ── Calcolo preventivo ──
   input: { tourId, people, mode, extraStops, extras:{childSeat:bool}, coupon }
   output: { ok, tour, items[], subtotal, discount, total, totalCents, couponApplied } */
async function computeQuote(input = {}) {
  if(input.coupon || (input.extras && Object.keys(input.extras).length))return {ok:false,error:'Unsupported option'};
  const tour = await getTour(String(input.tourId || ''));
  if (!tour || !tour.active) return { ok: false, error: 'Tour non trovato' };

  if(!Number.isInteger(input.people)||input.people<1||input.people>7)return {ok:false,error:'Guests must be an integer from 1 to 7'};
  if(input.mode && input.mode!=='private')return {ok:false,error:'Private tours only'};
  const count=input.extraStops??0;if(!Number.isInteger(count)||count<0||count>6||(!tour.custom&&count))return {ok:false,error:'Invalid extra stops'};
  const people=input.people;
  const items = [];
  let subtotal = 0;

  const shared = tour.pricing?.shared;
  const priv = tour.pricing?.private;
  const mode = input.mode === 'shared' && shared ? 'shared' : 'private';

  if (mode === 'shared') {
    if (people < (shared.minPax || 1) || people > (shared.maxPax || 15)) {
      return { ok: false, error: `Questa esperienza accetta da ${shared.minPax || 1} a ${shared.maxPax || 15} ospiti` };
    }
    const base = Number(shared.perPerson) * people;
    items.push({ key: 'base', label: `${people} × €${shared.perPerson}`, amount: base });
    subtotal += base;
  } else {
    if (!priv) return { ok: false, error: 'Tariffa privata non disponibile per questo tour' };
    if (people > (tour.maxPax || 7)) {
      return { ok: false, error: `Il cart privato ospita fino a ${tour.maxPax || 7} persone` };
    }
    const band = paxBand(people);
    const base = Number(priv[band]);
    if (!Number.isFinite(base) || base <= 0) return { ok: false, error: 'Prezzo non configurato' };
    items.push({ key: 'base', label: `Tour privato (${band} ospiti)`, amount: base });
    subtotal += base;

    const extraStops = Math.max(0, Math.min(20, parseInt(input.extraStops) || 0));
    if (extraStops > 0 && tour.custom?.extraStopFee) {
      const fee = Number(tour.custom.extraStopFee) * extraStops;
      items.push({ key: 'extraStops', label: `${extraStops} tappe extra`, amount: fee });
      subtotal += fee;
    }
  }

  if (input.extras?.childSeat) {
    const extrasCfg = await getContentKey('booking_extras', {});
    const price = Number(extrasCfg?.childSeat?.price ?? 25);
    items.push({ key: 'childSeat', label: 'Seggiolino bimbo', amount: price });
    subtotal += price;
  }

  /* ── Coupon ── */
  let discount = 0;
  let couponApplied = null;
  const code = String(input.coupon || '').trim().toUpperCase();
  if (code) {
    const r = await q('SELECT * FROM coupons WHERE UPPER(code)=$1', [code]);
    const c = r?.rows?.[0];
    const valid =
      c && c.active &&
      (!c.expires || new Date(c.expires) >= new Date(new Date().toDateString())) &&
      (!c.max_uses || c.used < c.max_uses) &&
      subtotal >= Number(c.min_amount || 0);
    if (valid) {
      discount = Math.min(subtotal, Number(c.percent) > 0 ? subtotal * Number(c.percent) / 100 : Number(c.amount_off || 0));
      discount = Math.round(discount * 100) / 100;
      couponApplied = { code: c.code, percent: Number(c.percent) || 0, amountOff: Number(c.amount_off) || 0 };
    } else {
      return { ok: false, error: 'Coupon non valido o scaduto', couponInvalid: true };
    }
  }

  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  return {
    ok: true,
    tourId: tour.id,
    tourName: tour.names?.[input.lang] || tour.names?.en || tour.id,
    mode,
    people,
    items,
    subtotal,
    discount,
    couponApplied,
    total,
    totalCents: Math.round(total * 100),
    currency: 'eur',
  };
}

async function redeemCoupon(code) {
  if (!code) return;
  await q('UPDATE coupons SET used = used + 1 WHERE UPPER(code)=UPPER($1)', [String(code).trim()]);
}

module.exports = { getTours, getTour, invalidate, computeQuote, redeemCoupon, paxBand, getContentKey };
