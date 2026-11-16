/* ═══════════════════════════════════════════════════════════
   MAXIMO TOURS — BACKEND v5 "MAXIMO SYSTEM"
   Un unico servizio Railway per: prenotazioni + Stripe,
   catalogo tour, CMS, coupon, concierge AI, area clienti,
   email transazionali, analytics, pannello Microwade.

   Compatibile al 100% con gli endpoint del backend v4:
   può essere puntato allo stesso DATABASE_URL senza
   nessuna migrazione manuale.
═══════════════════════════════════════════════════════════ */
const express = require('express');
const cors = require('cors');
const config = require('./src/config');
const { initDB } = require('./src/db');
const ai = require('./src/services/ai');
const { isAvailable: stripeAvailable } = require('./src/services/stripe');

const app = express();
app.set('trust proxy', 1);

/* Webhook Stripe: body RAW, prima del json parser */
app.use(require('./src/routes/webhook'));

app.use(express.json({ limit: '10mb' }));

/* ── CORS ── */

app.use(cors({
  origin: (origin, cb) => cb(null, config.corsOriginOk(origin)),
  credentials: true,
}));

/* ── Route ── */
app.use(require('./src/routes/requests'));
app.use(require('./src/routes/public'));
if(config.enableLegacyModules)app.use(require('./src/routes/user'));
app.use(require('./src/routes/admin'));
app.use(require('./src/routes/admin2')); /* nuovo Microwade: solo endpoint aggiuntivi sotto /admin/v2 */
if(config.enableLegacyModules)app.use(require('./src/routes/driver'));

/* ── 404 & errori ── */
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error('[Express Error]', err.message);
  res.status(500).json({ error: 'Errore interno del server' });
});

process.on('uncaughtException', err => console.warn('[uncaughtException]', err.message));
process.on('unhandledRejection', reason => console.warn('[unhandledRejection]', reason));

let server;
initDB().then(()=>{if(config.enableEmailBackups)require('./src/services/backup').startScheduler();
server = app.listen(config.port, () => {
  console.log(`
🛺  ═══════════════════════════════════════
    MAXIMO SYSTEM — Backend v5.0
    Porta:      ${config.port}
    Database:   ${config.databaseUrl ? '✅ configurato' : '⚠️  DATABASE_URL mancante'}
    Stripe:     ${stripeAvailable() ? '✅ OK' : '⚠️  STRIPE_SECRET_KEY mancante'}
    Anthropic:  ${ai.isAvailable() ? '✅ OK' : '⚠️  ANTHROPIC_API_KEY mancante'}
    Email:      ${config.resendApiKey ? '✅ Resend OK' : '⚠️  solo log console'}
    Admin:      ${config.adminPassword ? '✅ password impostata' : '❌ ADMIN_PASSWORD mancante'}
═══════════════════════════════════════════`);
});

}).catch(()=>{console.error('Database initialization failed');process.exit(1)});

/* ── Chiusura ordinata: al redeploy Railway invia SIGTERM. Smettiamo di accettare
   nuove connessioni e lasciamo finire le richieste in corso (un checkout a metà
   non va troncato); dopo 20 secondi usciamo comunque. ── */
let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[${signal}] chiusura ordinata…`);
  const force = setTimeout(() => process.exit(0), 20000);
  force.unref();
  if(!server)return process.exit(0);
  server.close(() => {
    const pool = require('./src/db').getPool();
    Promise.resolve(pool ? pool.end() : null).catch(() => {}).then(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
