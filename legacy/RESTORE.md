# 🗄 RESTORE — procedura di ripristino del database

## Da dove arrivano i backup
1. **Email automatica giornaliera** a `ADMIN_EMAIL` con allegato `aura-backup-AAAA-MM-GG.json.gz`
   (parte 2 minuti dopo ogni avvio del server, poi ogni 24h — richiede `RESEND_API_KEY`).
2. **Download manuale** da Microwade → Impostazioni → Backup → "Scarica backup adesso".

Conserva le email: sono la tua assicurazione off-site. Non cancellarle.

## Scenario A — Ripristino su un database NUOVO (disastro totale)
1. Railway → crea un nuovo plugin Postgres → copia il nuovo `DATABASE_URL`.
2. Metti il nuovo `DATABASE_URL` nelle Variables del servizio backend → il server al boot
   ricrea da solo tutte le tabelle vuote (aspetta il log `✅ Database pronto`).
3. Scarica l'allegato del backup più recente dalla email.
4. Dal tuo PC, nella cartella `backend`:
   ```bash
   npm install
   set DATABASE_URL=postgres://... (il NUOVO url, con host pubblico Railway)
   node scripts/restore.js aura-backup-2026-07-06.json.gz
   ```
5. Verifica su Microwade: prenotazioni, tour e coupon devono esserci tutti.

## Scenario B — Recupero di righe cancellate per sbaglio
Stessa procedura, puntando al database ATTUALE: lo script usa
`ON CONFLICT DO NOTHING`, quindi **non tocca le righe esistenti** e reinserisce
solo quelle mancanti. Zero rischio di sovrascrittura.

## Prova di ripristino (da fare una volta, come da EXECUTION_ORDER)
1. Crea un Postgres temporaneo su Railway (o in locale).
2. Esegui lo Scenario A puntando a quel DB.
3. Controlla i conteggi stampati dallo script (`bookings: N/N righe ripristinate`).
4. Cancella il DB temporaneo. Annota la data della prova qui sotto.

> Ultima prova di restore eseguita: ____________ (compila dopo il test)

## Cosa contiene il dump
Tabelle core integrali (bookings, reviews, users, coupons, tours_catalog,
site_content, blocked_dates, user_photos, referrals) + log recenti
(email_logs senza anteprime html, chat_logs, analytics_events, ads_reports)
+ valore del contatore prenotazioni.
