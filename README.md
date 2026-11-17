# Maximo Tours backend 1.2.0 — 17 novembre 2026

Backend Node 24 / Express / PostgreSQL per il frontend su Vercel. Stripe Checkout per il pagamento completo, conferma verificata lato server, email tramite Resend e gestionale protetto su `/ogre`.

**Leggere ATTIVAZIONE.md** per caricamento GitHub, variabili Railway, Stripe, email e collaudo reale.

## Funzioni

- Quattro tour privati; totale per gruppo: 320 EUR (1–3), 390 EUR (4), 470 EUR (5–7). Tappe extra per La Dolce Vita: 19,50 EUR.
- Disponibilità di 8 golf cart con controllo delle sovrapposizioni in Europe/Rome. Partenze come nel backend Aura fornito, prenotazione almeno 2 ore prima.
- Pagamenti idempotenti con la sola chiave segreta Stripe; controllo diretto di importo, valuta e prenotazione, verifica al ritorno e in background anche a browser chiuso. Webhook firmati facoltativi. Nessuna conferma basata soltanto sul ritorno del browser.
- Richieste di cancellazione almeno 24 ore prima. **Nessun rimborso automatico.** Il gestionale richiede conferma esplicita dell’importo prima di inviarlo a Stripe.
- Login admin, sessioni HttpOnly, CSRF, ricerca, note, calendario, stato pagamenti, rimborsi e coda email.
- Email transazionali con link privato di gestione; dati carta gestiti da Stripe.

## Comandi

`npm ci`, `npm test`, `npm start`.

La variabile DATABASE_URL è obbligatoria per l’avvio. In produzione ADMIN_PASSWORD deve avere almeno 32 caratteri. Il contenuto di `.env.example` è solo una traccia: non contiene credenziali.

I test PostgreSQL usano PGlite. Stripe è simulato nei test e non viene contattato. Nessun test avvia pagamenti reali o invia email. Il test reale dell’account Stripe e della consegna email va eseguito prima dell’apertura degli incassi.

Le vecchie route Aura non sono montate dall’applicazione. Il pacchetto di distribuzione include solo i moduli usati dalla nuova applicazione Maximo.
