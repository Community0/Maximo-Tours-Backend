/* ═══════════════════════════════════════════════════════════
   RESTORE — ripristina un backup JSON nel database.
   Uso:  DATABASE_URL=postgres://...  node scripts/restore.js aura-backup-2026-07-06.json
   (accetta anche .json.gz)
   Sicurezza: NON cancella nulla. Inserisce con ON CONFLICT DO NOTHING:
   le righe già presenti restano intatte, quelle mancanti vengono ricreate.
═══════════════════════════════════════════════════════════ */
require('dotenv').config();
const fs = require('fs');
const zlib = require('zlib');
const { Pool } = require('pg');

const file = process.argv[2];
if (!file) { console.error('Uso: node scripts/restore.js <file-backup.json[.gz]>'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL mancante'); process.exit(1); }

let raw = fs.readFileSync(file);
if (file.endsWith('.gz')) raw = zlib.gunzipSync(raw);
const dump = JSON.parse(raw.toString('utf8'));

const KEYS = {
  bookings: 'id', reviews: 'id', users: 'id', coupons: 'code',
  tours_catalog: 'id', site_content: 'key', blocked_dates: 'date',
  user_photos: 'id', referrals: 'id',
  drivers: 'id', partners: 'code', admin_settings: 'key', ogre_splits: 'month',
};

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log(`Backup del ${dump.meta?.createdAt} — ripristino (solo righe mancanti)…`);

  for (const [table, pk] of Object.entries(KEYS)) {
    const rows = dump.tables?.[table] || [];
    if (!rows.length) { console.log(`  ${table}: 0 righe nel dump`); continue; }
    let inserted = 0;
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map(c => {
        const v = row[c];
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      });
      const placeholders = cols.map((_, i) => '$' + (i + 1)).join(',');
      try {
        const r = await pool.query(
          `INSERT INTO ${table} (${cols.map(c => '"' + c + '"').join(',')}) VALUES (${placeholders}) ON CONFLICT ("${pk}") DO NOTHING`,
          vals
        );
        inserted += r.rowCount;
      } catch (e) {
        console.warn(`  ⚠ ${table} riga saltata:`, e.message.slice(0, 100));
      }
    }
    console.log(`  ${table}: ${inserted}/${rows.length} righe ripristinate`);
  }

  if (dump.meta?.bookingCounter) {
    try {
      await pool.query(`SELECT setval('booking_counter', GREATEST((SELECT last_value FROM booking_counter), $1))`, [parseInt(dump.meta.bookingCounter)]);
      console.log(`  booking_counter allineato a ≥ ${dump.meta.bookingCounter}`);
    } catch (e) { console.warn('  ⚠ counter:', e.message); }
  }

  await pool.end();
  console.log('✅ Ripristino completato.');
})();
