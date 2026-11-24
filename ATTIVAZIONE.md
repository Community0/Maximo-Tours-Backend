# Maximo Tours — attivazione 1.2.1, 17 novembre 2026

## 1. GitHub e Railway

Estrai lo ZIP e carica il suo contenuto nella radice del repository del backend. `package.json`, `server.js` e `Dockerfile` devono trovarsi direttamente nella radice, non dentro una sottocartella. Sostituisci i file della versione precedente. Non caricare `node_modules` o un file `.env` con valori reali.

Railway deve usare quel repository e il database PostgreSQL del progetto Maximo. Le migrazioni aggiungono colonne e tabelle senza cancellare prenotazioni. Prima di aggiornare un database con dati reali, esegui un backup Railway.

Nel servizio **backend → Variables**, inserisci:

| Variabile | Valore |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — cambia `Postgres` se il servizio ha un nome diverso |
| `PG_SSL` | `false` per il collegamento privato Railway |
| `ADMIN_PASSWORD` | password casuale unica di almeno 32 caratteri, da conservare nel gestore password |
| `SITE_URL` | `https://maximotours.it` |
| `ALLOWED_ORIGINS` | `https://maximotours.it,https://www.maximotours.it` |
| `PUBLIC_PHONE` | `+39 320 689 1014` |
| `PUBLIC_WHATSAPP` | `+39 320 689 1014` |
| `PUBLIC_WHATSAPP_HREF` | `https://wa.me/393206891014` |
| `GOLF_CART_COUNT` | `8` |
| `BOOKING_TIME_SLOTS` | `09:00,10:30,12:00,14:30,16:00,17:30,19:00,20:30` |
| `PAYMENTS_ENABLED` | inizialmente `false`; `true` dopo la configurazione e il collaudo |
| `STRIPE_SECRET_KEY` | chiave segreta del tuo account Stripe (`sk_test_…` nel collaudo, `sk_live_…` per incassi reali) |
| `STRIPE_WEBHOOK_SECRET` | **facoltativa: lascia vuota o ometti**. Il server verifica Stripe direttamente con la chiave segreta |
| `RESEND_API_KEY` | chiave Resend con permesso di invio limitato a `notify.maximotours.it` |
| `RESEND_FROM_EMAIL` | `Maximo Tours <booking@notify.maximotours.it>` |
| `ADMIN_EMAIL` | `info@maximotours.it` |
| `REPLY_TO_EMAIL` | `info@maximotours.it` |

`PORT` viene assegnata da Railway. Non inserire chiavi segrete su Vercel o nel frontend. Non occorre una chiave pubblica Stripe: il pagamento usa la pagina ospitata da Stripe.

Controlla che `https://web-production-1a25fad7.up.railway.app/health` restituisca `status: ok`. Un avvio fallito richiede di controllare `DATABASE_URL`, la lunghezza di `ADMIN_PASSWORD` e i log del deploy. Il dominio pubblico Railway deve rimanere quello indicato; se cambia, aggiornare anche i collegamenti del front.

## 2. Stripe

1. Questa versione funziona con **STRIPE_SECRET_KEY** e **PAYMENTS_ENABLED=true**, senza richiedere un webhook. Non serve creare altre chiavi.
2. Durante il collaudo usa una chiave `sk_test_…` e un database/backend separato da quello operativo. Per gli incassi reali occorre una chiave `sk_live_…` di un account Stripe abilitato ai pagamenti.
3. In Branding imposta nome Maximo Tours, logo del sito e pulsante nero. Carte e Apple Pay vengono mostrati da Stripe quando disponibili per account, browser e dispositivo.
4. Verifica una sessione Checkout con il tuo account: pagamento, conferma sul sito, email e prenotazione nel gestionale. Ripeti chiudendo la pagina dopo il pagamento: il processo in background deve comunque confermare la prenotazione.
5. Per attivare gli incassi reali, carica questa versione su GitHub, lascia la chiave live in Railway e imposta `PAYMENTS_ENABLED=true`. Attendi il deploy prima di verificare `/api/maximo/booking/config`.

Il ritorno dal checkout non è una prova di pagamento: il server recupera sessione e pagamento direttamente da Stripe e controlla importo, valuta e riferimento della prenotazione. Al ritorno del cliente effettua una verifica; inoltre un processo ogni 10 secondi cerca pagamenti e sessioni scadute, anche se il browser è chiuso. Con carico o problemi di rete la conferma può richiedere più tempo. Railway deve mantenere il servizio attivo: disabilita l’opzione di sospensione/serverless del servizio web. I controlli ripartono dopo un riavvio senza perdere le prenotazioni.

I rimborsi effettuati dal gestionale sono verificati subito; quelli effettuati direttamente dalla dashboard Stripe sono rilevati dai controlli periodici sulle prenotazioni pagate, normalmente entro circa 15 minuti. Il processo **non avvia mai rimborsi**.

Un webhook firmato rimane supportato come integrazione facoltativa per aggiornamenti più rapidi. Solo se lo aggiungi in futuro, configura la destinazione `/webhooks/stripe` sul dominio Railway, versione API `2024-12-18.acacia`, eventi `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `refund.updated`, `refund.failed`, e il relativo `STRIPE_WEBHOOK_SECRET`. Senza segreto la route rifiuta le notifiche: non accetta richieste non verificate.

## 3. Email, passo per passo

### Casella Aruba

La casella operativa scelta è `info@maximotours.it`, già creata dall’utente su Aruba. Accedi alla webmail e verifica di poter ricevere e rispondere. La password della casella resta su Aruba: **non va inserita in Resend o nel backend**.

### Dominio di invio Resend

1. Domains → Add domain → `notify.maximotours.it`.
2. Copia su Aruba i record TXT e CNAME mostrati da Resend, usando i valori completi del tuo account. Non usare le parti abbreviate con `[…]`.
3. Nei campi Nome host di Aruba usa il nome relativo: ad esempio `rsend.notify`, perché `.maximotours.it` è già aggiunto dal pannello. Non modificare i record MX della posta Aruba.
4. Mantieni **Enable sending** attivo e **Enable receiving** disattivato. La posta in arrivo continua su Aruba.
5. Premi Verify DNS Records e attendi **Verified**.
6. API Keys → Create API key → nome `Maximo Tours Railway` → permesso **Sending access** → dominio `notify.maximotours.it`.
7. Copia la chiave direttamente in Railway, variabile `RESEND_API_KEY`. Non inviarla in chat e non salvarla su GitHub.
8. Inserisci le altre tre variabili email della tabella. Disattiva open tracking e click tracking per le email di servizio.

Il cliente riceve conferma, riferimento e link privato per gestire la prenotazione. Il team riceve notifiche nella casella Aruba. Le email restano in coda se Resend non è configurato o non risponde; `/ogre` mostra il numero di notifiche in attesa. Finché il dominio non è verificato e la casella Aruba non esiste, l’invio reale non è collaudato.

## 4. Gestionale e rimborsi

Accedi da `https://maximotours.it/ogre` con `ADMIN_PASSWORD`.

- Ricerca prenotazioni, recapiti, hotel, data e orario, ospiti, importo, lingua e note.
- Stato pagamento aggiornato da Stripe; incassi al netto dei rimborsi registrati, esclusi i costi Stripe.
- Blocco delle giornate dal calendario; le prenotazioni già confermate restano visibili.
- Il cliente può richiedere cancellazione almeno **24 ore prima**. La richiesta compare nel gestionale e **non avvia un rimborso**.
- Apri la prenotazione → **Gestisci rimborso** → controlla importo e ospite → spunta la conferma → **Emetti rimborso**.
- Solo questo comando autenticato avvia il rimborso Stripe. Il processo automatico controlla gli esiti, senza avviare rimborsi.
- Se un’operazione si interrompe, ricontrolla lo stato prima di ripetere. Il comando usa una chiave di idempotenza. Un tentativo incerto più vecchio di 23 ore richiede verifica direttamente in Stripe.
- Non segnare un rimborso come eseguito cambiando una voce: i pagamenti Stripe non sono modificabili manualmente.

## 5. SEO e collegamento del front

Il front è predisposto per Vercel, con richieste al backend tramite `/api/maximo`. Le 5 lingue hanno pagine statiche, canonical, hreflang reciproci e sitemap. Checkout, API e area admin sono esclusi dall’indicizzazione. Nessun tag di Analytics inventato o attivato senza ID.

In Google Search Console aggiungi la proprietà dominio `maximotours.it`, verifica il TXT che Google ti fornisce su Aruba e invia `https://maximotours.it/sitemap-index.xml`. Per Analytics serve il tuo Measurement ID; la configurazione del consenso e del tracciamento va completata prima dell’attivazione. L’indicizzazione e le posizioni su Google non sono garantite dalla sola configurazione tecnica.

## Collaudi ancora necessari nell’ambiente reale

Il 17 novembre sono stati verificati online database, login/logout del gestionale, riepilogo admin e presenza della configurazione email. Restano da completare: deploy di questa versione 1.2.1, prova Stripe con l’account del titolare, recapito Resend, mailbox Aruba, Search Console e dispositivo iPhone reale. I test locali non sono pagamenti bancari e non certificano la consegna delle email o la fluidità su ogni dispositivo.

Fonti operative: https://docs.stripe.com/webhooks · https://docs.stripe.com/checkout/fulfillment · https://resend.com/docs/dashboard/domains/introduction · https://developers.google.com/search/docs/specialty/international/localized-versions
