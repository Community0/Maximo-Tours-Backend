# Railway e Vercel

Segui [ATTIVAZIONE.md](ATTIVAZIONE.md).

Frontend: https://maximotours.it — progetto Vercel maximo-tours.
Backend: https://web-production-1a25fad7.up.railway.app
Admin: https://maximotours.it/ogre
Interfaccia admin pubblicata su Vercel; `/ogre/api/*` passa tramite proxy al backend Railway. I file `public/admin` nello ZIP rimangono disponibili anche dal dominio Railway.
Webhook Stripe facoltativo, non necessario: https://web-production-1a25fad7.up.railway.app/webhooks/stripe

Mantieni il servizio Railway attivo, senza sospensione/serverless: esegue verifiche Stripe e invia le email anche quando il cliente ha chiuso il browser. Se cambia il dominio Railway, aggiorna le riscritture in vercel.json e l’eventuale destinazione webhook Stripe.
