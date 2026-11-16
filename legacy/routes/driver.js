/* ═══════════════════════════════════════════════════════════
   DRIVER LINK — spec AURA_DRIVER_APP_SPEC (P6 del pack).
   GET  /d/:token                 → pagina mobile single-file
   GET  /api/d/:token             → payload servizio
   POST /api/d/:token/status      → avanzamento stato sequenziale
   POST /api/d/:token/checklist   → checklist pre-tour (blocca "sto andando")
   POST /api/d/:token/report      → form post-tour 20 secondi
   POST /api/d/:token/review-sent → marca "review chiesta" (T9 inviato)
   POST /api/d/:token/problem     → segnalazione + email in centrale
═══════════════════════════════════════════════════════════ */
const express = require('express');
const config = require('../config');
const { q } = require('../db');
const { verifyToken } = require('../services/driverlink');
const catalog = require('../services/catalog');
const { sendMail } = require('../services/email');

const router = express.Router();

/* Sequenza stati: uno alla volta, nell'ordine (spec) */
const FLOW = ['assegnato', 'confermato', 'in_viaggio', 'a_bordo', 'completato'];
const CHECKLIST = [
  { id: 'acqua', label: 'Acqua fredda a bordo' },
  { id: 'cart', label: 'Cart pulita' },
  { id: 'qr', label: 'QR review sul cruscotto' },
  { id: 'salviette', label: 'Salviette' },
  { id: 'batteria', label: 'Batteria cart OK' },
  { id: 'telefono', label: 'Telefono carico' },
];

async function loadService(token) {
  const t = verifyToken(token);
  if (!t) return { error: 'expired' };
  const r = await q('SELECT * FROM bookings WHERE id=$1', [t.bookingId]);
  const b = r?.rows?.[0];
  if (!b) return { error: 'notfound' };
  /* il link vale solo per il driver a cui è stato assegnato il servizio */
  if (t.driverId && b.driver_id && t.driverId !== b.driver_id) return { error: 'expired' };
  let driver = null;
  if (b.driver_id) {
    const d = await q('SELECT id,name,phone FROM drivers WHERE id=$1', [b.driver_id]);
    driver = d?.rows?.[0] || null;
  }
  return { booking: b, driver, tokenData: t };
}

function extractFromNotes(notes, label) {
  const m = String(notes || '').match(new RegExp(label + ':\\s*([^·]+)'));
  return m ? m[1].trim() : '';
}

async function buildReviewLink() {
  const settings = await catalog.getContentKey('google_settings', {});
  const placeId = settings?.placeId || config.googlePlaceId;
  if (placeId) return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
  return 'https://www.google.com/search?q=Aura+Rome+Tours+reviews';
}

async function servicePayload(b, driver) {
  /* tappe e durata dal catalogo, cercando il tour per nome */
  let stops = [], duration = '';
  try {
    const tours = await catalog.getTours();
    const t = tours.find(x => x.names?.it === b.tour || x.names?.en === b.tour || x.id === b.tour);
    if (t) { stops = t.stops || []; duration = t.duration || ''; }
  } catch (_) {}

  const paid = b.payment_status === 'paid' || b.status === 'confirmed';
  const report = b.driver_report || {};
  const supplements = Array.isArray(b.breakdown?.supplements) ? b.breakdown.supplements : [];
  const phoneDigits = String(b.phone || '').replace(/\D/g, '');

  return {
    ok: true,
    booking: {
      id: b.id, date: b.date, time: b.time, name: b.name, people: b.people,
      phone: b.phone || '', notes: b.notes || '', tour: b.tour,
      amount: Number(b.amount) || 0, status: b.status,
    },
    hotel: extractFromNotes(b.notes, 'Pickup'),
    language: extractFromNotes(b.notes, 'Lingua'),
    supplements, stops, duration,
    paid,
    collect: paid ? 0 : Number(b.amount) || 0,
    fee: Number(b.driver_fee) || 0,
    driverName: driver?.name || '',
    driverStatus: b.driver_status || 'assegnato',
    reviewStatus: b.review_status || null,
    checklist: report.checklist || {},
    checklistItems: CHECKLIST,
    post: report.post || null,
    reviewLink: await buildReviewLink(),
    waCustomer: phoneDigits ? `https://wa.me/${phoneDigits}` : null,
    flow: FLOW,
  };
}

async function logEvent(bookingId, driverId, type, data) {
  await q('INSERT INTO driver_events (booking_id,driver_id,type,data) VALUES ($1,$2,$3,$4)',
    [bookingId, driverId || null, type, data ? JSON.stringify(data) : null]);
}

/* ── API ── */
router.get('/api/d/:token', async (req, res) => {
  const s = await loadService(req.params.token);
  if (s.error) return res.status(s.error === 'notfound' ? 404 : 410).json({ ok: false, error: s.error });
  res.json(await servicePayload(s.booking, s.driver));
});

router.post('/api/d/:token/status', async (req, res) => {
  const s = await loadService(req.params.token);
  if (s.error) return res.status(410).json({ ok: false, error: s.error });
  const b = s.booking;
  const next = String(req.body?.status || '');
  const cur = b.driver_status || 'assegnato';
  if (FLOW.indexOf(next) !== FLOW.indexOf(cur) + 1) {
    return res.status(409).json({ ok: false, error: `Da "${cur}" puoi passare solo a "${FLOW[FLOW.indexOf(cur) + 1] || '—'}"` });
  }
  if (next === 'in_viaggio') {
    const done = b.driver_report?.checklist || {};
    if (!CHECKLIST.every(c => done[c.id])) {
      return res.status(409).json({ ok: false, error: 'Completa la checklist prima di partire' });
    }
  }
  const extra = next === 'completato' ? ", review_status=COALESCE(review_status,'da_chiedere')" : '';
  await q(`UPDATE bookings SET driver_status=$1${extra}, updated_at=NOW() WHERE id=$2`, [next, b.id]);
  await logEvent(b.id, b.driver_id, 'status', { from: cur, to: next });
  res.json({ ok: true, driverStatus: next });
});

router.post('/api/d/:token/checklist', async (req, res) => {
  const s = await loadService(req.params.token);
  if (s.error) return res.status(410).json({ ok: false, error: s.error });
  const items = req.body?.items && typeof req.body.items === 'object' ? req.body.items : {};
  const clean = {};
  CHECKLIST.forEach(c => { clean[c.id] = !!items[c.id]; });
  const report = { ...(s.booking.driver_report || {}), checklist: clean };
  await q('UPDATE bookings SET driver_report=$1, updated_at=NOW() WHERE id=$2', [JSON.stringify(report), s.booking.id]);
  res.json({ ok: true, checklist: clean, complete: CHECKLIST.every(c => clean[c.id]) });
});

router.post('/api/d/:token/report', async (req, res) => {
  const s = await loadService(req.params.token);
  if (s.error) return res.status(410).json({ ok: false, error: s.error });
  const { happy, reviewAsked, tip, problems, vehicleNotes } = req.body || {};
  const post = {
    happy: !!happy,
    reviewAsked: !!reviewAsked,
    tip: Math.max(0, parseFloat(tip) || 0),
    problems: String(problems || '').slice(0, 800),
    vehicleNotes: String(vehicleNotes || '').slice(0, 800),
    at: new Date().toISOString(),
  };
  const report = { ...(s.booking.driver_report || {}), post };
  const reviewSql = reviewAsked ? ", review_status='chiesta'" : '';
  await q(`UPDATE bookings SET driver_report=$1${reviewSql}, updated_at=NOW() WHERE id=$2`, [JSON.stringify(report), s.booking.id]);
  await logEvent(s.booking.id, s.booking.driver_id, 'post_tour_report', post);
  if (post.problems) {
    sendMail(config.adminEmail, `⚠ Nota post-tour ${s.booking.id} — ${s.booking.name}`,
      `<p><b>${s.driver?.name || 'Driver'}</b> segnala dopo il tour <b>${s.booking.id}</b>:</p><p>${post.problems}</p>`,
      { kind: 'admin', relatedBookingId: s.booking.id }).catch(() => {});
  }
  res.json({ ok: true });
});

router.post('/api/d/:token/review-sent', async (req, res) => {
  const s = await loadService(req.params.token);
  if (s.error) return res.status(410).json({ ok: false, error: s.error });
  await q("UPDATE bookings SET review_status='chiesta', updated_at=NOW() WHERE id=$1", [s.booking.id]);
  await logEvent(s.booking.id, s.booking.driver_id, 'review_link_sent', null);
  res.json({ ok: true, reviewStatus: 'chiesta' });
});

router.post('/api/d/:token/problem', async (req, res) => {
  const s = await loadService(req.params.token);
  if (s.error) return res.status(410).json({ ok: false, error: s.error });
  const text = String(req.body?.text || '').slice(0, 1000).trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Descrivi il problema' });
  await logEvent(s.booking.id, s.booking.driver_id, 'problem', { text });
  sendMail(config.adminEmail, `🚨 PROBLEMA in strada — ${s.booking.id} (${s.booking.name})`,
    `<p style="font-size:16px"><b>${s.driver?.name || 'Driver'}</b> segnala un problema sul servizio <b>${s.booking.id}</b> — ${s.booking.name}, ${s.booking.date} ${s.booking.time || ''}:</p>
     <p style="font-size:15px;background:#f6e5e5;padding:14px;border-radius:8px">${text.replace(/</g, '&lt;')}</p>
     <p>Cliente: ${s.booking.phone || 'telefono non registrato'}</p>`,
    { kind: 'admin', relatedBookingId: s.booking.id }).catch(() => {});
  res.json({ ok: true });
});

/* ── PAGINA MOBILE ── */
router.get('/d/:token', async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const t = verifyToken(req.params.token);
  if (!t) return res.status(410).send(expiredPage());
  res.send(driverPage());
});

function expiredPage() {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link scaduto — Aura</title><style>body{margin:0;font-family:system-ui;background:#120D09;color:#F2EBDD;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}h1{font-size:22px}p{color:#A3968A;line-height:1.6}</style></head>
<body><div><div style="font-size:44px">⏳</div><h1>Link scaduto o non valido</h1><p>Questo link di servizio non è più attivo.<br>Chiedi ad Aura di rimandartelo su WhatsApp.</p></div></body></html>`;
}

function driverPage() {
  return `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#120D09">
<title>Servizio Aura — Driver</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,650&family=Archivo:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#120D09;--card:#1B140E;--card2:#221A12;--ink:#F2EBDD;--muted:#A3968A;--dim:#6E6257;--terra:#D98E5F;--terra2:#A4441F;--ok:#4ade80;--err:#F87171;--warn:#FBBF24;--bd:rgba(217,142,95,.16)}
*{box-sizing:border-box;margin:0}
body{background:var(--bg);color:var(--ink);font-family:Archivo,system-ui,sans-serif;padding:16px 14px 120px;max-width:520px;margin:0 auto;-webkit-tap-highlight-color:transparent}
.brand{display:flex;align-items:center;justify-content:space-between;padding:2px 2px 14px}
.brand b{font-family:Fraunces,serif;font-weight:650;font-size:17px;letter-spacing:.02em}
.brand small{color:var(--dim);font-size:10px;letter-spacing:.22em;text-transform:uppercase}
.card{background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:16px;margin-bottom:12px}
.lbl{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--terra);margin-bottom:10px;font-weight:700}
.big{font-family:Fraunces,serif;font-size:30px;line-height:1.1}
.muted{color:var(--muted);font-size:13px;line-height:1.55}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:14px}
.row:last-child{border-bottom:none}
.row span{color:var(--muted);font-size:12.5px}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;border:none;border-radius:14px;padding:17px;font-family:Archivo;font-size:15px;font-weight:800;letter-spacing:.04em;cursor:pointer;text-decoration:none;text-align:center}
.btn:active{transform:scale(.98)}
.btn.primary{background:var(--terra2);color:#fff}
.btn.ghost{background:var(--card2);color:var(--ink);border:1px solid var(--bd);font-weight:600}
.btn.sm{padding:12px;font-size:13px;border-radius:11px;width:auto;flex:1}
.btn:disabled{opacity:.35;pointer-events:none}
.badge{border-radius:12px;padding:16px;text-align:center;font-weight:800;font-size:17px;letter-spacing:.05em}
.badge.paid{background:rgba(74,222,128,.12);color:var(--ok);border:1px solid rgba(74,222,128,.35)}
.badge.cash{background:rgba(248,113,113,.12);color:var(--err);border:1px solid rgba(248,113,113,.4)}
.steps{display:flex;gap:5px;margin-bottom:14px}
.steps i{flex:1;height:4px;border-radius:4px;background:var(--card2)}
.steps i.on{background:var(--terra)}
.chk{display:flex;align-items:center;gap:12px;padding:13px 12px;border:1px solid var(--bd);border-radius:12px;margin-bottom:8px;font-size:14.5px;cursor:pointer;background:var(--card2)}
.chk input{width:22px;height:22px;accent-color:var(--terra2)}
.chk.done{border-color:rgba(74,222,128,.4)}
.chip{display:inline-block;background:var(--card2);border:1px solid var(--bd);border-radius:999px;padding:5px 11px;font-size:12px;margin:0 5px 6px 0;color:var(--muted)}
.stops li{color:var(--muted);font-size:13.5px;padding:4px 0}
input[type=number],textarea{width:100%;background:var(--card2);border:1px solid var(--bd);border-radius:11px;color:var(--ink);padding:12px;font-family:Archivo;font-size:14px}
textarea{min-height:70px;resize:vertical}
.footer{position:fixed;left:0;right:0;bottom:0;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 30%);display:flex;gap:8px;max-width:520px;margin:0 auto}
.toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:var(--card2);border:1px solid var(--bd);border-radius:11px;padding:11px 18px;font-size:13.5px;z-index:50;max-width:90%}
.overlay{position:fixed;inset:0;background:rgba(10,7,5,.82);display:none;align-items:flex-end;z-index:40}
.overlay.on{display:flex}
.sheet{background:var(--card);border-radius:20px 20px 0 0;padding:20px 16px calc(20px + env(safe-area-inset-bottom));width:100%;max-width:520px;margin:0 auto}
.pulse{animation:pu 2s infinite}
@keyframes pu{0%,100%{opacity:1}50%{opacity:.55}}
</style></head>
<body>
<div class="brand"><b>AURA <span style="color:var(--terra)">·</span> DRIVER</b><small id="bid"></small></div>
<div id="app"><div class="card muted pulse" style="text-align:center;padding:40px">Carico il servizio…</div></div>
<div class="footer" id="foot" style="display:none">
  <button class="btn ghost sm" onclick="openProblem()">🚨 Problema</button>
  <button class="btn ghost sm" id="rev-btn" onclick="sendReview()">⭐ Review link</button>
</div>
<div class="overlay" id="ov"><div class="sheet">
  <div class="lbl">Segnala un problema</div>
  <p class="muted" style="margin-bottom:12px">Arriva subito in centrale. Per emergenze chiama direttamente.</p>
  <textarea id="pb-text" placeholder="Cosa sta succedendo?"></textarea>
  <div style="display:flex;gap:8px;margin-top:12px">
    <button class="btn ghost sm" onclick="document.getElementById('ov').classList.remove('on')">Annulla</button>
    <button class="btn primary sm" onclick="submitProblem(this)">Invia in centrale</button>
  </div>
</div></div>
<script>
'use strict';
var TOKEN = location.pathname.split('/').pop();
var S = null;
var LABELS = { assegnato:'CONFERMA SERVIZIO', confermato:'STO ANDANDO', in_viaggio:'CLIENTE A BORDO', a_bordo:'TOUR COMPLETATO' };

function esc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toast(msg){ var el=document.createElement('div'); el.className='toast'; el.textContent=msg; document.body.appendChild(el); setTimeout(function(){el.remove();},3200); }

function api(path, body){
  return fetch('/api/d/'+TOKEN+path, body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
    .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||'Errore'); return j; }); });
}

function countdown(){
  if(!S||!S.booking.date) return '';
  var d=String(S.booking.date).slice(0,10), t=(S.booking.time||'09:00');
  var pk=new Date(d+'T'+t+':00'); if(isNaN(pk)) return '';
  var diff=pk.getTime()-Date.now();
  if(S.driverStatus==='completato') return 'Servizio completato';
  if(diff<-4*3600000) return 'Pickup passato';
  if(diff<0) return 'ORA — cliente in attesa';
  var h=Math.floor(diff/3600000), m=Math.floor(diff%3600000/60000);
  return 'Pickup tra '+(h>0?h+'h ':'')+m+'m';
}

function render(){
  var b=S.booking;
  document.getElementById('bid').textContent=b.id;
  document.getElementById('foot').style.display='flex';
  var idx=S.flow.indexOf(S.driverStatus);
  var next=S.flow[idx+1]||null;
  var checklistOk=S.checklistItems.every(function(c){return S.checklist[c.id];});
  var showChecklist=S.driverStatus==='confermato'&&!checklistOk;
  var mapsQ=encodeURIComponent((S.hotel||'')+' Roma');
  var phoneDigits=String(b.phone||'').replace(/\\D/g,'');

  var html='';
  /* 1. header servizio */
  html+='<div class="card"><div class="lbl">Servizio</div>'
    +'<div class="big">'+esc(fdate(b.date))+(b.time?' · '+esc(b.time):'')+'</div>'
    +'<div style="color:var(--terra);font-weight:700;font-size:14px;margin-top:8px" id="cd">'+countdown()+'</div></div>';

  /* 2. cliente */
  html+='<div class="card"><div class="lbl">Cliente</div>'
    +'<div class="row"><span>Nome</span><b>'+esc(b.name)+'</b></div>'
    +'<div class="row"><span>Ospiti</span><b>'+esc(b.people||'?')+' pax</b></div>'
    +(S.language?'<div class="row"><span>Lingua</span><b>'+esc(S.language)+'</b></div>':'')
    +(S.hotel?'<div class="row"><span>Pickup</span><a style="color:var(--terra);font-weight:700;text-decoration:none" href="https://www.google.com/maps/search/?api=1&query='+mapsQ+'">'+esc(S.hotel)+' →</a></div>':'')
    +(phoneDigits?'<div style="display:flex;gap:8px;margin-top:12px"><a class="btn ghost sm" href="tel:'+phoneDigits+'">📞 Chiama</a><a class="btn ghost sm" href="https://wa.me/'+phoneDigits+'">💬 WhatsApp</a></div>':'')
    +'</div>';

  /* 3. servizio */
  html+='<div class="card"><div class="lbl">Tour</div>'
    +'<div style="font-family:Fraunces,serif;font-size:20px;margin-bottom:4px">'+esc(b.tour)+'</div>'
    +(S.duration?'<div class="muted">Durata '+esc(S.duration)+'</div>':'')
    +(S.stops.length?'<ul class="stops" style="padding-left:18px;margin-top:10px">'+S.stops.map(function(s){return '<li>'+esc(s)+'</li>';}).join('')+'</ul>':'')
    +(S.supplements.length?'<div style="margin-top:10px">'+S.supplements.map(function(s){return '<span class="chip">+ '+esc(s)+'</span>';}).join('')+'</div>':'')
    +(b.notes?'<div class="muted" style="margin-top:10px;background:var(--card2);border-radius:10px;padding:10px 12px">'+esc(b.notes)+'</div>':'')
    +'</div>';

  /* 4. pagamento — chiarezza assoluta */
  html+='<div class="card"><div class="lbl">Pagamento</div>'
    +(S.paid
      ?'<div class="badge paid">✓ GIÀ PAGATO — non incassare nulla</div>'
      :'<div class="badge cash">INCASSA €'+S.collect.toFixed(0)+' CASH</div>')
    +'</div>';

  /* 5. compenso */
  html+='<div class="card" style="display:flex;justify-content:space-between;align-items:center"><div><div class="lbl" style="margin-bottom:4px">Il tuo compenso</div>'
    +'<div class="muted">pagato con il prossimo payout</div></div>'
    +'<div class="big" style="color:var(--terra)">€'+S.fee.toFixed(0)+'</div></div>';

  /* checklist pre-tour */
  if(S.driverStatus==='confermato'){
    html+='<div class="card"><div class="lbl">Checklist pre-tour '+(checklistOk?'✓':'')+'</div>'
      +S.checklistItems.map(function(c){
        var on=!!S.checklist[c.id];
        return '<label class="chk'+(on?' done':'')+'"><input type="checkbox" data-chk="'+c.id+'"'+(on?' checked':'')+'> '+esc(c.label)+'</label>';
      }).join('')
      +'<p class="muted" style="font-size:12px;margin-top:6px">Tutte spuntate per sbloccare "STO ANDANDO".</p></div>';
  }

  /* stato + bottone azione */
  html+='<div class="card"><div class="lbl">Stato servizio</div>'
    +'<div class="steps">'+S.flow.slice(1).map(function(s,i){return '<i class="'+(idx>=i+1?'on':'')+'"></i>';}).join('')+'</div>';
  if(S.driverStatus==='completato'){
    html+='<div style="text-align:center;color:var(--ok);font-weight:800;font-size:16px;padding:6px 0">✓ TOUR COMPLETATO</div>';
  } else if(next){
    html+='<button class="btn primary" id="next-btn" '+(showChecklist&&next==='in_viaggio'?'disabled':'')+' onclick="advance(\\''+next+'\\',this)">'+LABELS[S.driverStatus]+'</button>';
  }
  html+='</div>';

  /* post-tour: form 20 secondi */
  if(S.driverStatus==='completato'){
    if(S.post){
      html+='<div class="card" style="border-color:rgba(74,222,128,.35)"><div class="lbl" style="color:var(--ok)">Report inviato ✓</div>'
        +'<div class="muted">Grazie! '+(S.post.reviewAsked?'Review chiesta ✓':'')+(S.post.tip?' · mancia €'+S.post.tip:'')+'</div></div>';
    } else {
      html+='<div class="card"><div class="lbl">Post-tour — 20 secondi</div>'
        +'<label class="chk"><input type="checkbox" id="pt-happy" checked> Cliente felice</label>'
        +'<label class="chk"><input type="checkbox" id="pt-review"> Ho chiesto la review</label>'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:4px 0 8px">'
        +'<div><div class="muted" style="font-size:11px;margin-bottom:4px">Mancia ricevuta €</div><input type="number" id="pt-tip" value="0" min="0"></div>'
        +'<div><div class="muted" style="font-size:11px;margin-bottom:4px">Km / note mezzo</div><input type="number" id="pt-km" placeholder="opzionale" style="width:100%"></div></div>'
        +'<textarea id="pt-problems" placeholder="Problemi? (opzionale)"></textarea>'
        +'<button class="btn primary" style="margin-top:10px" onclick="sendReport(this)">Invia report</button></div>';
    }
  }

  document.getElementById('app').innerHTML=html;
  var revBtn=document.getElementById('rev-btn');
  if(revBtn&&S.reviewStatus==='chiesta') revBtn.textContent='⭐ Review chiesta ✓';

  document.querySelectorAll('[data-chk]').forEach(function(el){
    el.addEventListener('change', function(){
      S.checklist[el.dataset.chk]=el.checked;
      api('/checklist',{items:S.checklist}).then(function(r){
        S.checklist=r.checklist; render();
      }).catch(function(e){toast(e.message);});
    });
  });
}

function fdate(v){
  if(!v) return '—';
  var s=String(v).slice(0,10), p=s.split('-');
  if(p.length===3) return p[2]+'/'+p[1]+'/'+p[0];
  return s;
}

function advance(next, btn){
  btn.disabled=true;
  api('/status',{status:next}).then(function(){
    S.driverStatus=next; render();
    if(next==='completato') toast('Grande! Compila il report post-tour 🙌');
  }).catch(function(e){ toast(e.message); btn.disabled=false; });
}

function sendReport(btn){
  btn.disabled=true;
  api('/report',{
    happy:document.getElementById('pt-happy').checked,
    reviewAsked:document.getElementById('pt-review').checked,
    tip:document.getElementById('pt-tip').value,
    vehicleNotes:document.getElementById('pt-km').value,
    problems:document.getElementById('pt-problems').value,
  }).then(function(){
    S.post={reviewAsked:document.getElementById('pt-review').checked, tip:parseFloat(document.getElementById('pt-tip').value)||0};
    if(S.post.reviewAsked) S.reviewStatus='chiesta';
    render(); toast('Report inviato ✓');
  }).catch(function(e){ toast(e.message); btn.disabled=false; });
}

function sendReview(){
  var msg='Thank you for choosing Aura! If you enjoyed the experience, a Google review means the world to a small team like ours: '+S.reviewLink+' . And if you come back to Rome, this code gives you 10% off: AURARETURN';
  api('/review-sent').then(function(){ S.reviewStatus='chiesta'; render(); }).catch(function(){});
  if(S.waCustomer) window.open(S.waCustomer+'?text='+encodeURIComponent(msg),'_blank');
  else { navigator.clipboard&&navigator.clipboard.writeText(msg); toast('Messaggio copiato — incollalo al cliente'); }
}

function openProblem(){ document.getElementById('ov').classList.add('on'); }
function submitProblem(btn){
  var text=document.getElementById('pb-text').value.trim();
  if(!text) return toast('Descrivi il problema');
  btn.disabled=true;
  api('/problem',{text:text}).then(function(){
    document.getElementById('ov').classList.remove('on');
    document.getElementById('pb-text').value='';
    toast('Segnalazione inviata in centrale ✓');
    btn.disabled=false;
  }).catch(function(e){ toast(e.message); btn.disabled=false; });
}

function load(){
  api('').then(function(data){ S=data; render(); })
  .catch(function(){ document.getElementById('app').innerHTML='<div class="card" style="text-align:center;padding:36px"><div style="font-size:36px">⏳</div><b>Link scaduto o servizio non trovato</b><p class="muted" style="margin-top:8px">Chiedi ad Aura di rimandarti il link.</p></div>'; });
}
load();
setInterval(function(){ var cd=document.getElementById('cd'); if(cd) cd.textContent=countdown(); }, 30000);
/* aggiornamento soft ogni 60s se la pagina è visibile */
setInterval(function(){ if(document.visibilityState==='visible'&&S&&S.driverStatus!=='completato') load(); }, 60000);
</script>
</body></html>`;
}

module.exports = router;
