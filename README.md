# Maximo Tours — backend e pannello Ogre

Repository pronto da caricare manualmente su GitHub e collegare a Railway. Richiede **Node 24** e **PostgreSQL dedicato a Maximo**. Il frontend rimane su Vercel.

## Cosa funziona in questa consegna

- Quattro tour privati, nomi in cinque lingue, prezzi calcolati dal server: **1–3 persone 320 €, 4 persone 390 €, 5–7 persone 470 €**. Per The Sweet Life/La Dolce Vita: 19,50 € per tappa extra, massimo sei.
- API di richiesta: contatti, telefono internazionale, hotel/pickup, data, persone, preferenze e accettazione informativa. Salvataggio transazionale su PostgreSQL; invii ripetuti con la stessa chiave non creano doppioni.
- Pannello **`/ogre`** con login, password definita da `ADMIN_PASSWORD`, sessioni di otto ore, logout e protezione delle modifiche.
- Elenco richieste con ricerca, filtro, paginazione, dettagli, note interne, stato della prenotazione e registrazione manuale dei pagamenti. Riepilogo richieste, confermate e incassi registrati; storico delle modifiche nel database.
- Calendario delle date non disponibili. Non modifica o cancella le richieste già presenti.
- Notifica email al gestore, opzionale, tramite Resend; coda persistente con tentativi successivi. Le richieste si salvano anche se le email non sono configurate.

## Stato reale e prossimi collegamenti

Questa versione gestisce **richieste da confermare**, non disponibilità di posti in tempo reale. Il frontend attuale invia ancora il riepilogo tramite WhatsApp: le richieste WhatsApp non appaiono automaticamente nel database. Il collegamento del modulo al nuovo endpoint sarà completato dopo che avrai l'URL Railway; prima servirà adeguare anche l'informativa del modulo e raccogliere hotel/pickup.

Gli stati “Incassato” e “Rimborsato” del pannello sono registrazioni manuali: non eseguono operazioni finanziarie. Stripe, Apple Pay, email al cliente, account clienti, driver, AI e vecchio pannello Aura **non sono attivati**. Il codice ereditato è conservato come riferimento e non viene esposto dal server corrente. Non basta inserire una chiave Stripe per abilitare i pagamenti: occorrono integrazione e collaudo specifici.

Il pannello è pronto localmente, ma `maximotours.it/ogre` non è ancora pubblicato. Le istruzioni per il collegamento da Vercel sono in `RAILWAY-VERCEL.md`.

## File da caricare su GitHub

Estrai lo ZIP e carica **il contenuto** della cartella nel repository: `Dockerfile`, `.dockerignore`, `package.json`, `package-lock.json`, `server.js`, `src`, `public`, `test`, `railway.json`, documentazione e `.env.example`. Mantieni `.gitignore`. Non caricare `.env`, password, chiavi, `node_modules` o backup del database. Il repository non contiene credenziali reali.

Da Railway: nuovo servizio dal repository GitHub, aggiungi PostgreSQL nello stesso progetto e imposta le variabili indicate in `VARIABILI.md`. La build usa il Dockerfile con Node 24. Avvio `npm start`, controllo salute `/health`. Le tabelle e i quattro tour vengono creati al primo avvio; i dati esistenti non vengono cancellati.

## Verifiche

`npm ci` e `npm test`: test prezzi e fasce, validazione, transazioni, duplicati, errori, login, sessione, CSRF, modifica prenotazioni e blocco date. I test di integrazione usano **PGlite (motore PostgreSQL locale)**, senza credenziali o dati reali; non sostituiscono il collaudo della connessione di rete Railway, dei cookie via Vercel, del servizio email e dei pagamenti.

Il pannello è verificato nel browser desktop e a larghezza mobile. Nessun tag analytics è caricato nell'area amministrativa.

Una sola istanza backend è la configurazione iniziale prevista: il limite richieste/login usa memoria per istanza. Prima di più repliche, spostare i limiti su uno storage condiviso. Il database e le sessioni sono già persistenti. Configura backup PostgreSQL dal pannello Railway; il vecchio invio automatico di backup via email non è attivo.
