# Variabili Railway

Inseriscile nel servizio **backend**, non nei file pubblici del frontend.

| Variabile | Valore / origine | Necessaria |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — usa il nome esatto del tuo servizio PostgreSQL | Sì |
| `NODE_ENV` | `production` | Sì |
| `ADMIN_PASSWORD` | Password casuale e unica di 32–128 caratteri, scelta nel gestore password | Sì |
| `SITE_URL` | `https://maximotours.it` | Impostala |
| `ALLOWED_ORIGINS` | `https://maximotours.it,https://www.maximotours.it` | Impostala |
| `PG_SSL` | `false` con la connessione privata Railway; `true` solo per endpoint TLS con certificato attendibile | Impostala |
| `PORT` | Railway lo assegna; non copiarlo da PostgreSQL | Automatico |
| `PUBLIC_PHONE` | `+39 320 689 1014` | Predefinita |
| `PUBLIC_WHATSAPP` | `+39 320 689 1014` | Predefinita |
| `PUBLIC_WHATSAPP_HREF` | `https://wa.me/393206891014` | Predefinita |
| `RESEND_API_KEY` | Chiave del tuo account Resend | Per notifiche email |
| `RESEND_FROM_EMAIL` | Mittente verificato in Resend, es. `Maximo Tours <prenotazioni@maximotours.it>` **solo dopo verifica del dominio** | Per notifiche email |
| `ADMIN_EMAIL` | La tua email reale che riceverà le richieste; ancora da fornire | Per notifiche email |
| `REPLY_TO_EMAIL` | Email a cui rispondere; predefinita `ADMIN_EMAIL` | Facoltativa |

La password non è salvata nel frontend o nel browser. La sessione usa un cookie HttpOnly, Secure in produzione, SameSite Strict. Cambiare `ADMIN_PASSWORD` invalida le sessioni esistenti. Non inviare la password o le chiavi in chat: inseriscile direttamente nelle variabili Railway.

Se vuoi testare il frontend locale contro il servizio, aggiungi solo l'origine esatta necessaria in `ALLOWED_ORIGINS`. Non usare wildcard per tutti i siti Vercel o Railway.

## Variabili ereditate, non utilizzate dal server attuale

Le seguenti compaiono nel codice di riferimento Aura ma **non vanno aggiunte per questo deploy**. Le configureremo solo quando attiveremo e testeremo le relative funzioni:

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APPLE_PAY_DOMAIN_FILE`.
- AI: `ANTHROPIC_API_KEY`, `ANTHROPIC_CHAT_MODEL`, `ANTHROPIC_PRO_MODEL`.
- Recensioni Google: `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACE_ID`.
- Email storiche: `EMAIL_NOTIFY`, `SUPPORT_EMAIL`, `RESEND_FROM_EMAIL_ADMIN`, `RESEND_FROM_EMAIL_BOOKING`, `RESEND_FROM_EMAIL_EXPERIENCE`, `RESEND_FROM_EMAIL_REVIEW`, `RESEND_FROM_EMAIL_WELCOME`.
- Driver/compatibilità: `DRIVER_LINK_SECRET`, `DISABLE_LEGACY_CHECKOUT`.

Non esistono interruttori per riattivare automaticamente i vecchi endpoint. Il server monta solo le API nuove.

## Google: configurazione frontend, non Railway

- **Google Analytics 4:** identificativo `G-…`, da inserire nel frontend con gestione delle preferenze di tracciamento. Nessuna chiave privata nel sito. Non inviare nome, telefono, email o note agli eventi analytics.
- **Google Tag Manager:** eventuale `GTM-…` se decidi di gestire i tag da GTM; evita di installare GA4 due volte.
- **Search Console:** proprietà Dominio `maximotours.it`, verifica tramite record DNS fornito da Google. Con questo metodo non occorre un tag HTML. Dopo la pubblicazione, invia `https://maximotours.it/sitemap-index.xml`.
- Il frontend locale rimane `noindex`. Prima del lancio pubblico va rigenerato con `production: true`. Escludere sempre `/ogre` e il checkout dall'indicizzazione.

Fonti: [Railway PostgreSQL](https://docs.railway.com/databases/postgresql), [variabili di riferimento Railway](https://docs.railway.com/variables), [Google tag](https://support.google.com/analytics/answer/15756615), [verifica Search Console](https://support.google.com/webmasters/answer/9008080).
