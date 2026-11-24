/* PostgreSQL schema adapted for a separate Maximo database. */
const { Pool } = require('pg');
const config = require('./config');

let db = null;
let dbReady = false;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    tour TEXT NOT NULL,
    people TEXT,
    date TEXT,
    time TEXT,
    notes TEXT,
    payment_method TEXT,
    stripe_payment_id TEXT,
    status TEXT DEFAULT 'pending',
    amount NUMERIC,
    notes_admin TEXT DEFAULT '',
    email_booking_received_sent BOOLEAN DEFAULT FALSE,
    email_payment_confirmed_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT,
    tour_name TEXT,
    stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
    text TEXT NOT NULL,
    approved BOOLEAN DEFAULT FALSE,
    booking_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS blocked_dates (
    date TEXT PRIMARY KEY,
    reason TEXT DEFAULT 'Indisponibile',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS analytics_events (
    id SERIAL PRIMARY KEY,
    event TEXT NOT NULL,
    page TEXT,
    ip TEXT,
    user_agent TEXT,
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS analytics_ips (
    ip TEXT PRIMARY KEY,
    visits INTEGER DEFAULT 1,
    last_seen TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS chat_logs (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    message TEXT NOT NULL,
    lang TEXT,
    ip TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS site_content (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    verified BOOLEAN DEFAULT FALSE,
    verify_code TEXT,
    verify_expires TIMESTAMPTZ,
    referral_code TEXT UNIQUE,
    referred_by TEXT,
    loyalty_points INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS user_photos (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    booking_id TEXT,
    title TEXT,
    url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    referrer_email TEXT NOT NULL,
    referred_email TEXT NOT NULL,
    booking_id TEXT,
    discount_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS email_logs (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT,
    direction TEXT DEFAULT 'outbound',
    sender TEXT,
    recipient TEXT,
    subject TEXT,
    status TEXT DEFAULT 'queued',
    provider TEXT DEFAULT 'resend',
    provider_message_id TEXT,
    related_booking_id TEXT,
    related_user_email TEXT,
    reply_to TEXT,
    error TEXT,
    html_preview TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE SEQUENCE IF NOT EXISTS booking_counter START 1001;

  /* ── NUOVE TABELLE v5 ── */
  CREATE TABLE IF NOT EXISTS tours_catalog (
    id TEXT PRIMARY KEY,
    sort INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY,
    percent NUMERIC DEFAULT 0,
    amount_off NUMERIC DEFAULT 0,
    min_amount NUMERIC DEFAULT 0,
    expires DATE,
    max_uses INTEGER DEFAULT 0,
    used INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS ads_reports (
    id BIGSERIAL PRIMARY KEY,
    platform TEXT,
    goal TEXT,
    report TEXT,
    raw_summary JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  /* ── NUOVE TABELLE round 12: driver network, partner hotel, review machine ── */
  CREATE TABLE IF NOT EXISTS drivers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    languages JSONB DEFAULT '[]',
    can_drive BOOLEAN DEFAULT TRUE,
    rate_standard NUMERIC DEFAULT 0,
    rate_night NUMERIC DEFAULT 0,
    style TEXT DEFAULT '',
    zones TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    flag TEXT DEFAULT 'attivo',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS partners (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    model TEXT DEFAULT 'commission',
    pct NUMERIC DEFAULT 12,
    segment TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS driver_events (
    id BIGSERIAL PRIMARY KEY,
    booking_id TEXT,
    driver_id TEXT,
    type TEXT NOT NULL,
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email_booking_received_sent BOOLEAN DEFAULT FALSE;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email_payment_confirmed_sent BOOLEAN DEFAULT FALSE;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coupon_code TEXT;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS breakdown JSONB;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS channel TEXT;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS partner_source TEXT;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS costs JSONB;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_id TEXT;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_fee NUMERIC;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_status TEXT;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_report JSONB;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_paid BOOLEAN DEFAULT FALSE;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS partner_paid BOOLEAN DEFAULT FALSE;
  ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_status TEXT;
  ALTER TABLE reviews ADD COLUMN IF NOT EXISTS driver_id TEXT;
  ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS user_agent TEXT;
`;

/* ── Schema v6 (nuovo Microwade): SOLO aggiunte. Ogni istruzione gira da sola,
   così un eventuale errore non blocca le altre né l'avvio del server. ── */
const SCHEMA_V6 = [
  `CREATE TABLE IF NOT EXISTS admin_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS ogre_splits (month TEXT PRIMARY KEY, amount NUMERIC DEFAULT 0, shares JSONB, note TEXT DEFAULT '', split_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS audit_log (id BIGSERIAL PRIMARY KEY, entity TEXT, entity_id TEXT, action TEXT, before JSONB, after JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
  `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS vehicle TEXT`,
];

/* ── Catalogo iniziale: i tour reali con i prezzi attuali ──
   Viene inserito SOLO se tours_catalog è vuota: dopo il primo
   avvio ogni modifica passa da Microwade. */
const SEED_TOURS = [{"id": "roma-iconica", "sort": 0, "active": true, "data": {"slug": "roma-iconica", "names": {"it": "Roma Iconica", "en": "Iconic Rome", "fr": "Rome iconique", "es": "Roma icónica", "de": "Ikonisches Rom"}, "descriptions": {"it": "Sei tappe tra i simboli del centro storico, dal Colosseo alla Fontana di Trevi. Un giro panoramico all’aperto, con il golf cart riservato al tuo gruppo.", "en": "Six stops in the historic centre, from the Colosseum to the Trevi Fountain. An open-air sightseeing route, with a golf cart reserved for your group.", "fr": "Six étapes parmi les incontournables du centre historique, du Colisée à la fontaine de Trevi. Une visite panoramique en plein air, avec une voiturette réservée à votre groupe.", "es": "Seis paradas entre los iconos del centro histórico, del Coliseo a la Fontana de Trevi. Un recorrido panorámico al aire libre, con un carrito de golf reservado para tu grupo.", "de": "Sechs Stationen zu den Wahrzeichen der Altstadt, vom Kolosseum bis zum Trevi-Brunnen. Eine Panoramatour unter freiem Himmel, mit einem Golfcart nur für Ihre Gruppe."}, "pricing": {"private": {"1-3": 320, "4": 390, "5-7": 470}}, "maxPax": 7, "stops": ["Colosseo", "Fori Imperiali", "Piazza Venezia", "Pantheon", "Piazza Navona", "Fontana di Trevi"], "duration": "2 ore e 30", "image": "/assets/roma-0.jpg", "hoverVideo": "/assets/tour-iconica.mp4"}}, {"id": "roma-completa", "sort": 1, "active": true, "data": {"slug": "roma-completa", "names": {"it": "Roma Completa", "en": "Complete Rome", "fr": "Rome au complet", "es": "Roma al completo", "de": "Rom komplett"}, "descriptions": {"it": "Dai monumenti del centro a Trastevere, fino ai panorami del Gianicolo e all’Aventino. Dieci tappe e una pausa in un caffè storico.", "en": "From the city centre to Trastevere and the views from the Janiculum and Aventine hills. Ten stops and a break at a historic café.", "fr": "Des monuments du centre au Trastevere, jusqu’aux panoramas du Janicule et de l’Aventin. Dix étapes et une pause dans un café historique.", "es": "De los monumentos del centro a Trastevere, pasando por las vistas del Janículo y el Aventino. Diez paradas y una pausa en un café histórico.", "de": "Von den Sehenswürdigkeiten im Zentrum nach Trastevere und weiter zu den Aussichtspunkten auf dem Gianicolo und Aventin. Zehn Stationen und eine Pause in einem historischen Café."}, "pricing": {"private": {"1-3": 320, "4": 390, "5-7": 470}}, "maxPax": 7, "stops": ["Colosseo", "Fori Imperiali", "Piazza Venezia", "Pantheon", "Piazza Navona", "Fontana di Trevi", "Piazza di Spagna", "Trastevere", "Gianicolo", "Aventino"], "duration": "3 ore", "image": "/assets/roma-1.jpg", "hoverVideo": "/assets/tour-sacra.mp4"}}, {"id": "la-dolce-vita", "sort": 2, "active": true, "data": {"slug": "la-dolce-vita", "names": {"it": "La Dolce Vita", "en": "The Sweet Life", "fr": "La douce vie", "es": "La dulce vida", "de": "Das süße Leben"}, "descriptions": {"it": "Parti dal percorso completo e personalizza il giro con i luoghi che vuoi vedere. Ogni tappa aggiuntiva costa 19,50 € e richiede circa 15 minuti.", "en": "Start with the full itinerary and add the places you want to see. Each extra stop costs €19.50 and adds around 15 minutes.", "fr": "Partez de l’itinéraire complet et ajoutez les lieux que vous souhaitez découvrir. Chaque étape supplémentaire coûte 19,50 € et dure environ 15 minutes.", "es": "Parte del recorrido completo y añade los lugares que quieres conocer. Cada parada adicional cuesta 19,50 € y dura unos 15 minutos.", "de": "Ergänzen Sie die vollständige Route um die Orte, die Sie besonders interessieren. Jede zusätzliche Station kostet 19,50 € und verlängert die Tour um etwa 15 Minuten."}, "pricing": {"private": {"1-3": 320, "4": 390, "5-7": 470}}, "maxPax": 7, "stops": ["Colosseo", "Fori Imperiali", "Piazza Venezia", "Pantheon", "Piazza Navona", "Fontana di Trevi", "Piazza di Spagna", "Trastevere", "Gianicolo", "Aventino"], "duration": "Da 3 ore", "image": "/assets/roma-2.jpg", "hoverVideo": "/assets/tour-dolcevita.mp4", "custom": {"includedStops": 10, "extraStopFee": 19.5}}}, {"id": "roma-by-night", "sort": 3, "active": true, "data": {"slug": "roma-by-night", "names": {"it": "Roma by Night", "en": "Rome by Night", "fr": "Rome de nuit", "es": "Roma de noche", "de": "Rom bei Nacht"}, "descriptions": {"it": "Dalla Fontana di Trevi alle piazze illuminate del centro. Cinque tappe in golf cart, con partenza legata al tramonto e orario da concordare.", "en": "From the Trevi Fountain to the illuminated squares of the historic centre. Five golf cart stops, with departure around sunset or at an agreed time.", "fr": "De la fontaine de Trevi aux places illuminées du centre. Cinq étapes en voiturette, avec un départ autour du coucher du soleil, à une heure à convenir.", "es": "De la Fontana de Trevi a las plazas iluminadas del centro. Cinco paradas en carrito de golf, con salida al atardecer y horario por acordar.", "de": "Vom Trevi-Brunnen zu den beleuchteten Plätzen im Zentrum. Fünf Stationen im Golfcart, mit Start zum Sonnenuntergang und einer Uhrzeit nach Absprache."}, "pricing": {"private": {"1-3": 320, "4": 390, "5-7": 470}}, "maxPax": 7, "stops": ["Fontana di Trevi", "Piazza Navona", "Pantheon", "Piazza di Spagna", "Piazza Venezia"], "duration": "Da 2 ore a 2 ore e 30 minuti", "image": "/assets/roma-3.jpg", "hoverVideo": "/assets/tour-night.mp4"}}];

/* Impostazioni business di default (chiavi site_content), inserite solo se assenti */
const SEED_CONTENT = {
  business_settings: {
    whatsapp: '+39 320 689 1014',
    whatsappHref: 'https://wa.me/393206891014',
    phone: config.publicPhone,
    email: config.adminEmail,
    pickupNote: 'Pickup in hotel o punto concordato nel centro di Roma',
    cancellationHours: null,
    timeSlots: [],
  },
  booking_extras: {
    childSeat: { price: 25, labels: { it: 'Seggiolino bimbo', en: 'Child seat' } },
  },
};

async function initDB() {
 if(!config.databaseUrl)throw new Error('DATABASE_URL required');
 db=new Pool({connectionString:config.databaseUrl,ssl:process.env.PG_SSL==='true'?{rejectUnauthorized:true}:false,max:10,connectionTimeoutMillis:5000});
 db.on('error',()=>console.error('Database pool connection interrupted'));
 await db.query(SCHEMA);
 for(const stmt of SCHEMA_V6)await db.query(stmt);
 await db.query(`CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, password_version TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL); CREATE TABLE IF NOT EXISTS request_keys (
 key UUID PRIMARY KEY, payload_hash TEXT NOT NULL, booking_id TEXT NOT NULL REFERENCES bookings(id)
 );
 CREATE TABLE IF NOT EXISTS notification_outbox (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id),
 status TEXT NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0,
 next_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );`);
 await db.query(require('./payment-schema'));
 await db.query(require('./operations-schema'));
 await db.query(`INSERT INTO maximo_resources(id,kind,name,seats)
 SELECT 'cart-'||LPAD(n::text,2,'0'),'vehicle','Golf cart '||n,7
 FROM generate_series(1,$1::integer) n
 WHERE NOT EXISTS (SELECT 1 FROM maximo_resources WHERE kind='vehicle')
 ON CONFLICT(id) DO NOTHING`,[config.fleetSize]);
 await seed();dbReady=true;
}

async function seed() {
  try {
    {
      for (const tour of SEED_TOURS) {
        await db.query(
          'INSERT INTO tours_catalog (id, sort, active, data) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
          [tour.id, tour.sort, tour.active, tour.data]
        );
      }
      console.log('Maximo catalogue initialized');
    }
    for (const [key, value] of Object.entries(SEED_CONTENT)) {
      await db.query(
        'INSERT INTO site_content (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING',
        [key, JSON.stringify(value)]
      );
    }
  } catch (e) {
    throw e;
  }
}

/* Query helper: non lancia mai, ritorna null su errore (il server resta vivo) */
async function q(sql, vals = []) {
  if (!db) return null;
  if (!dbReady) {
    return null;
  }
  try {
    return await db.query(sql, vals);
  } catch (e) {
    console.error('[DB]', e.message, '| SQL:', String(sql).slice(0, 90));
    if (e.message.includes('Connection terminated') || e.message.includes('Client has encountered')) {
      console.error('Database connection interrupted');
    }
    return null;
  }
}

module.exports = {
  initDB,
  q,
  isReady: () => dbReady,
  getPool: () => db,
};
