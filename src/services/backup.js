/* ═══════════════════════════════════════════════════════════
   BACKUP — export logico completo del database.
   1. GET /admin/backup → dump JSON scaricabile da Microwade
   2. Email automatica giornaliera con dump .json.gz allegato
      (off-site reale: finisce nella casella ADMIN_EMAIL)
   Ripristino: scripts/restore.js + RESTORE.md
═══════════════════════════════════════════════════════════ */
const zlib = require('zlib');
const config = require('../config');
const { q, isReady } = require('./../db');
const { sendMail } = require('./email');

/* Tabelle core: integrali. Log: limitati alle righe più recenti. */
const CORE_TABLES = ['bookings', 'reviews', 'users', 'coupons', 'tours_catalog', 'site_content', 'blocked_dates', 'user_photos', 'referrals', 'drivers', 'partners', 'admin_settings', 'ogre_splits'];
const LOG_TABLES = [
  { name: 'email_logs', limit: 2000, omit: ['html_preview'] },
  { name: 'chat_logs', limit: 5000, omit: [] },
  { name: 'analytics_events', limit: 20000, omit: [] },
  { name: 'ads_reports', limit: 100, omit: [] },
  { name: 'driver_events', limit: 3000, omit: [] },
  { name: 'audit_log', limit: 5000, omit: [] },
];

async function buildDump() {
  if (!isReady()) throw new Error('Database non disponibile');
  const dump = {
    meta: {
      system: 'maximo-tours-backend',
      version: '5.0.0',
      createdAt: new Date().toISOString(),
      note: 'Ripristino: vedi RESTORE.md nel repo backend',
    },
    tables: {},
  };
  for (const table of CORE_TABLES) {
    const r = await q(`SELECT * FROM ${table}`);
    dump.tables[table] = r ? r.rows : [];
  }
  for (const { name, limit, omit } of LOG_TABLES) {
    const r = await q(`SELECT * FROM ${name} ORDER BY created_at DESC LIMIT ${limit}`);
    let rows = r ? r.rows : [];
    if (omit.length) rows = rows.map(row => { const c = { ...row }; omit.forEach(k => delete c[k]); return c; });
    dump.tables[name] = rows;
  }
  const counter = await q("SELECT last_value FROM booking_counter");
  dump.meta.bookingCounter = counter?.rows?.[0]?.last_value || null;
  return dump;
}

async function sendBackupEmail() {
  if (!config.resendApiKey) return { success: false, reason: 'RESEND_API_KEY mancante' };
  const dump = await buildDump();
  const json = JSON.stringify(dump);
  const gz = zlib.gzipSync(Buffer.from(json, 'utf8'));
  const sizeKb = Math.round(gz.length / 1024);
  if (gz.length > 15 * 1024 * 1024) {
    return { success: false, reason: `Dump troppo grande per email (${sizeKb} KB): configura uno storage esterno` };
  }
  const day = new Date().toISOString().slice(0, 10);
  const rows = Object.entries(dump.tables).map(([t, r]) => `<tr><td style="padding:4px 14px 4px 0;color:#9A9088">${t}</td><td><b>${r.length}</b></td></tr>`).join('');
  const html = `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#0F0C09;color:#F2EBDD;border-radius:14px;padding:30px;border:1px solid rgba(217,142,95,.2)">
    <div style="font-family:Georgia,serif;color:#D98E5F;font-size:22px">Aura System · Backup giornaliero</div>
    <p style="color:#A3968A;font-size:13px;line-height:1.7">Backup completo del database del ${day} in allegato (<b>${sizeKb} KB</b>, JSON compresso).
    Conserva queste email: sono la tua assicurazione. Per ripristinare: <code>RESTORE.md</code> nel repo backend.</p>
    <table style="font-size:13px;border-collapse:collapse">${rows}</table>
  </div>`;

  /* invio diretto via Resend con allegato */
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.resendApiKey}` },
      body: JSON.stringify({
        from: `Aura System <noreply@${(config.resendFromEmail.match(/@([^>\s]+)/) || [])[1] || 'maximotours.it'}>`,
        to: [config.adminEmail],
        subject: `🗄 Backup DB Aura — ${day} (${sizeKb} KB)`,
        html,
        attachments: [{ filename: `aura-backup-${day}.json.gz`, content: gz.toString('base64') }],
      }),
    });
    const text = await resp.text();
    if (!resp.ok) return { success: false, reason: text };
    console.log(`🗄 Backup email inviato (${sizeKb} KB) a ${config.adminEmail}`);
    return { success: true, sizeKb };
  } catch (e) {
    console.warn('[backup email]', e.message);
    return { success: false, reason: e.message };
  }
}

/* Scheduler: primo backup 2 minuti dopo il boot (così ogni deploy ne genera uno),
   poi ogni 24 ore. Stato esposto per Microwade. */
const state = { lastRun: null, lastResult: null };

function startScheduler() {
  const run = async () => {
    try {
      state.lastResult = await sendBackupEmail();
    } catch (e) {
      state.lastResult = { success: false, reason: e.message };
    }
    state.lastRun = new Date().toISOString();
  };
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, 24 * 3600 * 1000).unref();
}

module.exports = { buildDump, sendBackupEmail, startScheduler, state };
