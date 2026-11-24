# Maximo Tours backend 2.0.0 — 24 novembre 2026

Node 24, Express e PostgreSQL per Maximo Tours. Frontend pubblico e Ogre su Vercel; API e database su Railway.

## Aggiornamento

Leggi prima **AGGIORNAMENTO-2.0.md**. Carica il contenuto dello ZIP nella radice del repository backend, poi attendi il deploy Railway. Le modifiche al database sono additive: nessun reset delle prenotazioni. Le variabili esistenti restano valide.

## Cosa contiene

- Pagamento completo Stripe con verifica lato server, recupero in background, webhook facoltativo e conferme Resend.
- Ogre con login, calendario partenze, rubrica autisti e mezzi, assegnazioni senza sovrapposizioni.
- Prenotazioni manuali da telefono, WhatsApp, hotel, email, partner o di persona; più golf cart per gruppo.
- Modifica data, orario, pickup, ospiti, lingua e note con controllo della disponibilità e dei posti reali.
- Incassi esterni registrati manualmente; importi Stripe pagati protetti. Nessun addebito o rimborso automatico durante una modifica.
- Report per data del tour, provenienza e itinerario, CSV e storico modifiche delle prenotazioni.
- Coda email con stato del fornitore; statistiche interne di visite e conversioni solo con consenso.
- Integrazione facoltativa in lettura con GA4 e Search Console. Proprietà GA4: **565751125**.

I rimborsi Stripe richiedono sempre conferma esplicita nel gestionale. La richiesta di cancellazione non avvia un rimborso.

Il checkout pubblico continua a prenotare un golf cart, da 1 a 7 ospiti. Gruppi più grandi si organizzano dal gestionale. I prezzi di listino per ciascun mezzo sono 320 € (1–3), 390 € (4), 470 € (5–7); 19,50 € per tappa extra Dolce Vita per mezzo. Un prezzo concordato diverso richiede un motivo.

## Documenti e avvio

- **GUIDA-OGRE.md**: uso quotidiano e impostazione della flotta.
- **GOOGLE-REPORTS.md**: accesso in sola lettura ai report Google.
- **ATTIVAZIONE.md**, **VARIABILI.md**: impostazioni già esistenti Stripe, Resend e Railway.
- **VERIFICHE.md**: prove eseguite e limiti.

Esegui `npm ci`, `npm test`, `npm start`. Richiesti DATABASE_URL e, in produzione, ADMIN_PASSWORD di almeno 32 caratteri. Node 24 è dichiarato nei file di deploy. Nessuna chiave è inclusa nello ZIP.

I test usano PostgreSQL/PGlite e Stripe simulato: non addebitano carte e non inviano email. Il pacchetto esclude le vecchie route Aura e i dati dell'ambiente locale.
