# Verifiche — 16 novembre 2026

- Node 24: 9 test superati, comprendenti unit test, API HTTP e integrazione PostgreSQL locale PGlite.
- Tutte le fasce prezzo dei quattro tour: 1–3 → 320 €, 4 → 390 €, 5–7 → 470 €. Cinque ospiti con due tappe extra → 509 €.
- Salvataggio reale nel motore PostgreSQL locale, invio duplicato, conflitto sulla chiave, errore database, date bloccate, login valido/errato, cookie HttpOnly/SameSite, CSRF, logout, modifica concorrente e storico verificati.
- Browser: accesso, richiesta di prova, salvataggio note, blocco/sblocco date e logout. Desktop e viewport mobile 390 px. Dopo la correzione del layout tabella, larghezza del documento 375 px (barra laterale inclusa nella viewport), nessun overflow orizzontale della pagina. Le righe diventano schede leggibili su telefono.
- Screenshot `admin-desktop.png` e `admin-mobile.png`: contengono esclusivamente una richiesta locale di prova, non dati di clienti. Nessun dato di prova viene inserito dal backend di produzione.
- Dipendenze: audit npm senza vulnerabilità note dopo aggiornamento e correzione della dipendenza `qs`.
- Frontend: 40 pagine multilingua verificate; cinque flussi checkout WhatsApp testati con i prezzi aggiornati.

Non ancora verificati: build Docker su Railway (Docker non disponibile localmente), connessione al PostgreSQL Railway, routing e cookie attraverso Vercel, consegna email Resend, transazioni Stripe, dispositivo iPhone fisico. Nessun deploy o collegamento esterno è stato effettuato.
