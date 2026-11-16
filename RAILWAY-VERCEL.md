# Pubblicazione: GitHub → Railway → Vercel

1. **GitHub:** carica i file estratti dallo ZIP alla radice del repository backend. `package.json` deve essere visibile direttamente nella pagina iniziale del repository.
2. **Railway:** crea un servizio dal repository; aggiungi un servizio PostgreSQL separato nello stesso progetto. Non collegare il database di Aura.
3. **Variabili del backend:** applica `VARIABILI.md`. Per `DATABASE_URL`, scegli il riferimento al database Railway. Se il servizio si chiama `Postgres`, usa `${{Postgres.DATABASE_URL}}`.
4. **Deploy:** `npm start`; healthcheck `/health`. Il backend ascolta la porta assegnata da Railway e inizializza schema e catalogo. Se il database non è raggiungibile, l'avvio fallisce invece di accettare richieste che non può salvare.
5. **Indirizzo pubblico:** genera il dominio HTTPS Railway per il backend. Verifica `/health`: deve rispondere `status: ok`. Visita `/ogre/` e accedi con la password impostata nelle variabili.
6. **Vercel:** il frontend resta un progetto separato. Crea i due rewrite indicati sotto, sostituendo `BACKEND-REALE.up.railway.app` con il dominio ottenuto al punto 5. Se c'è già un `vercel.json`, unisci le regole senza cancellare quelle esistenti. Il file deve stare nella root del progetto frontend selezionata in Vercel.

```json
{
  "rewrites": [
    { "source": "/ogre", "destination": "https://BACKEND-REALE.up.railway.app/ogre/" },
    { "source": "/ogre/:path*", "destination": "https://BACKEND-REALE.up.railway.app/ogre/:path*" }
  ]
}
```

Questa è una configurazione **da completare con l'indirizzo reale**, non da pubblicare con il segnaposto. Copre pagina, risorse e API del pannello. Dopo il redeploy, `https://maximotours.it/ogre` mostrerà il pannello sul tuo dominio. Le risposte admin hanno `Cache-Control: no-store`; non aggiungere cache CDN alle API o alle risposte con cookie.

7. **Collaudo finale:** login, refresh pagina, modifica di una richiesta di prova, logout, login negato dopo logout; verifica cookie Secure/HttpOnly dal dominio Maximo. Blocca una data di prova e verifica che `/requests` la rifiuti. I test locali non provano il passaggio reale attraverso Vercel/Railway.
8. **Modulo del sito:** dopo il deploy collegheremo il checkout a `POST /requests`, adeguando informativa, hotel/pickup e conferma di invio. Fino ad allora continua il flusso WhatsApp attuale. Non mostrare “prenotazione confermata” per una risposta `pending`.
9. **Email e pagamenti:** configura l'email del gestore e il dominio verificato Resend, poi prova una notifica. Stripe/Apple Pay richiedono una successiva integrazione testata: al momento non sono attivi.

Non creare record DNS separati per `/ogre`: il DNS gestisce nomi di dominio, mentre il percorso viene gestito da Vercel. Per collegare `maximotours.it` a Vercel, usa esattamente i record mostrati da Vercel nel progetto frontend.

Riferimenti: [rewrite esterni Vercel](https://vercel.com/docs/routing/rewrites), [PostgreSQL Railway](https://docs.railway.com/databases/postgresql).
