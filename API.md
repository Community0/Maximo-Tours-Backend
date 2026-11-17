# API Maximo

Tutte le risposte operative sono no-store. Importi calcolati dal catalogo server. Interfaccia pubblica sul dominio frontend: prefisso `/api/maximo`.

- GET `/health`: connessione database.
- GET `/booking/config`: pagamenti disponibili, fuso orario, preavviso e versione condizioni.
- GET `/catalog/tours`: catalogo.
- GET `/availability?tourId=roma-iconica&date=YYYY-MM-DD&extraStops=0`: orari e disponibilità; il controllo viene ripetuto in transazione al checkout.
- POST `/quote`: tourId, people, extraStops, lang. Ritorna totalCents in EUR.
- POST `/checkout/session`: requestId UUID v4, customer {name,email,phone}, booking {tourId,people,extraStops,date,time,hotel,notes,lang}, privacyAccepted:true, termsAccepted:true, termsVersion, expectedTotalCents. Crea un blocco del golf cart e restituisce URL Stripe e token privato.
- POST `/booking/status`: {token}. Restituisce solo dati di riepilogo/stato, senza recapiti personali.
- POST `/booking/cancel`: {token,confirmed:true}. Registra **solo una richiesta** di cancellazione. Non chiama Stripe Refunds.
- POST `/webhooks/stripe`: body originale con Stripe-Signature. Endpoint diretto Railway.
- `/ogre/api/login`, `/ogre/api/session`, `/ogre/api/logout`: login e sessioni admin.
- GET `/ogre/api/requests`, `/ogre/api/overview`, `/ogre/api/blocked-dates`: prenotazioni, riepilogo, calendario.
- POST `/ogre/api/requests/:id`: note e stato operativo; pagamenti Stripe protetti da modifica manuale.
- POST `/ogre/api/requests/:id/refund`: **solo admin autenticato + CSRF**; {confirmed:true,amountCents,version}. Unico percorso applicativo che può avviare un rimborso.
- POST `/ogre/api/blocked-dates`: {date,blocked,reason}.

Compatibilità: `/requests` resta disponibile per richieste senza pagamento; non conferma disponibilità o incasso. Non è usato dal nuovo checkout online.

Idempotenza: non cambiare requestId quando ripeti gli stessi dati dopo un errore di rete. Un requestId riutilizzato con dati diversi viene rifiutato. I token di gestione sono segreti: non inserirli nei log, nell’analytics o nelle query URL; il front li conserva nel frammento #booking.

I blocchi di disponibilità vengono liberati solo dopo aver verificato la scadenza della sessione Stripe. Un errore persistente di Stripe può trattenere un blocco più a lungo per evitare doppie prenotazioni; controllare i log di riconciliazione.
