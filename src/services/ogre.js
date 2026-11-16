/* ═══════════════════════════════════════════════════════════
   OGRE — regole di costo e calcolo del "Netto degli ogre".
   Unico punto in cui si calcola il netto: il pannello lo
   riceve già fatto. Sola lettura sulle prenotazioni: non
   tocca checkout, webhook né gli endpoint esistenti.
   Le regole stanno in admin_settings (NON in site_content,
   che è esposto pubblicamente da GET /site-content).
═══════════════════════════════════════════════════════════ */
const { q } = require('../db');

const DEFAULT_RULES = {
  bands: [
    { max: 3, label: '1–3', vehicle: 'Cart 4 posti', mezzo: 120, driver: 80, stripe: 20, acque: 0 },
    { max: 5, label: '4–5', vehicle: 'Cart 6 posti', mezzo: 120, driver: 80, stripe: 20, acque: 0 },
    { max: 7, label: '6–7', vehicle: 'Mezzo 8 posti', mezzo: 180, driver: 80, stripe: 20, acque: 10 },
  ],
  split: { a: 'Gianluca', b: 'Riccardo', pctA: 50 },
  goalPerDay: 8,
};

let cache = { rules: null, at: 0 };

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function normalizeRules(input) {
  const src = input && typeof input === 'object' ? input : {};
  const bands = DEFAULT_RULES.bands.map((def, i) => {
    const b = (Array.isArray(src.bands) && src.bands[i]) || {};
    return {
      max: def.max, label: def.label,
      vehicle: typeof b.vehicle === 'string' && b.vehicle.trim() ? b.vehicle.trim().slice(0, 60) : def.vehicle,
      mezzo: Math.max(0, num(b.mezzo, def.mezzo)),
      driver: Math.max(0, num(b.driver, def.driver)),
      stripe: Math.max(0, num(b.stripe, def.stripe)),
      acque: Math.max(0, num(b.acque, def.acque)),
    };
  });
  const s = src.split || {};
  return {
    bands,
    split: {
      a: typeof s.a === 'string' && s.a.trim() ? s.a.trim().slice(0, 40) : DEFAULT_RULES.split.a,
      b: typeof s.b === 'string' && s.b.trim() ? s.b.trim().slice(0, 40) : DEFAULT_RULES.split.b,
      pctA: Math.min(100, Math.max(0, num(s.pctA, 50))),
    },
    goalPerDay: Math.min(50, Math.max(1, Math.round(num(src.goalPerDay, 8)))),
  };
}

async function getRules({ fresh = false } = {}) {
  if (!fresh && cache.rules && Date.now() - cache.at < 30000) return cache.rules;
  const r = await q("SELECT value FROM admin_settings WHERE key='ogre_rules'");
  const rules = normalizeRules(r && r.rows.length ? r.rows[0].value : null);
  cache = { rules, at: Date.now() };
  return rules;
}

function invalidate() { cache = { rules: null, at: 0 }; }

/* ── lettura di una prenotazione ── */
const paxOf = b => Math.max(1, parseInt(b.people, 10) || 1);
const bandOf = (rules, pax) => rules.bands.find(x => pax <= x.max) || rules.bands[rules.bands.length - 1];
const isCancelled = b => ['cancelled', 'refunded'].includes(b.status);
/* checkout del sito iniziato e mai pagato: non è un tour, è un carrello abbandonato */
const isGhost = b => ['pending', 'payment_failed'].includes(b.status) && b.payment_method === 'stripe';
const isOnline = b => ['stripe', 'stripe_link'].includes(b.payment_method);
/* stessa logica già usata dalla pagina driver, resa esplicita:
   se payment_status è valorizzato decide lui, altrimenti (flusso storico del sito) vale lo stato confermato */
function isPaid(b) {
  if (isCancelled(b)) return false;
  if (b.payment_status) return b.payment_status === 'paid';
  return b.status === 'confirmed';
}

function defaultCosts(b, rules) {
  const band = bandOf(rules, paxOf(b));
  return {
    v: 2, auto: true,
    mezzo: band.mezzo,
    driver: b.driver_fee != null ? Math.max(0, num(b.driver_fee)) : band.driver,
    stripe: isOnline(b) ? band.stripe : 0,
    acque: band.acque,
    altri: 0,
    vehicle: b.vehicle || band.vehicle,
  };
}

/* legge i costi salvati (nuova forma v2, vecchia forma del pannello attuale) o li calcola dalle regole */
function readCosts(b, rules) {
  const c = b.costs && typeof b.costs === 'object' ? b.costs : null;
  if (c && c.v === 2) {
    return {
      v: 2, auto: !!c.auto, saved: true,
      mezzo: num(c.mezzo), driver: num(c.driver), stripe: num(c.stripe), acque: num(c.acque), altri: num(c.altri),
      altriNota: typeof c.altriNota === 'string' ? c.altriNota : '',
      vehicle: c.vehicle || b.vehicle || bandOf(rules, paxOf(b)).vehicle,
      hand: c.hand && typeof c.hand === 'object' ? c.hand : {},
    };
  }
  if (c && c.margin !== undefined) {
    return {
      v: 1, auto: false, saved: true, legacy: true,
      mezzo: num(c.vehicle), driver: num(c.driver), stripe: num(c.feeCarta), acque: num(c.kit),
      altri: num(c.commPartner) + num(c.commOta), altriNota: (num(c.commPartner) + num(c.commOta)) ? 'Commissioni partner' : '',
      vehicle: b.vehicle || bandOf(rules, paxOf(b)).vehicle, hand: {},
    };
  }
  return { ...defaultCosts(b, rules), saved: false, altriNota: '', hand: {} };
}

function netOf(b, costs) {
  if (isCancelled(b) || isGhost(b)) return 0;
  return Math.round((num(b.amount) - costs.mezzo - costs.driver - costs.stripe - costs.acque - costs.altri) * 100) / 100;
}

/* forma unica che il pannello riceve */
function shape(b, rules) {
  const costs = readCosts(b, rules);
  const notes = String(b.notes || '');
  const pickup = (notes.match(/Pickup:\s*([^·]+)/) || [])[1];
  return {
    id: b.id, name: b.name, email: b.email, phone: b.phone || '',
    tour: b.tour, pax: paxOf(b), people: b.people,
    date: b.date, time: b.time || '',
    dateOk: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')),
    notes, notesAdmin: b.notes_admin || '', pickup: pickup ? pickup.trim() : '',
    status: b.status, paymentStatus: b.payment_status || null, paymentMethod: b.payment_method || null,
    channel: b.channel || (b.payment_method === 'stripe' ? 'sito' : null), partnerSource: b.partner_source || null,
    amount: num(b.amount), couponCode: b.coupon_code || null,
    stripePaymentId: b.stripe_payment_id || null,
    attribution: (b.breakdown && b.breakdown.attribution) || null,
    driverId: b.driver_id || null, driverFee: b.driver_fee != null ? num(b.driver_fee) : null,
    driverStatus: b.driver_status || null, driverPaid: !!b.driver_paid, partnerPaid: !!b.partner_paid,
    reviewStatus: b.review_status || null,
    vehicle: costs.vehicle,
    cancelled: isCancelled(b), ghost: isGhost(b), paid: isPaid(b), online: isOnline(b),
    costs, net: netOf(b, costs),
    archivedAt: b.archived_at || null,
    createdAt: b.created_at, updatedAt: b.updated_at,
  };
}

/* data di oggi a Roma (il server gira in UTC) */
function romeToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function romeNow() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  return { hour: +p.find(x => x.type === 'hour').value, minute: +p.find(x => x.type === 'minute').value };
}
/* giorno (Roma) di un istante */
function romeDay(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

module.exports = {
  DEFAULT_RULES, normalizeRules, getRules, invalidate,
  paxOf, bandOf, isCancelled, isGhost, isOnline, isPaid,
  defaultCosts, readCosts, netOf, shape, romeToday, romeNow, romeDay, num,
};
