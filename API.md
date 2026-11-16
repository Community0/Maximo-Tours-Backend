# API del modulo pubblico

## Catalogo e prezzi

`GET /catalog/tours`, `GET /blocked-dates`, `POST /quote`.

```json
{"tourId":"la-dolce-vita","people":5,"extraStops":2,"lang":"en"}
```

Il preventivo dell'esempio è **509 €**: 470 € per 5 persone più 39 € per due tappe. Non inviare un importo calcolato dal browser come fonte del prezzo.

ID stabili: `roma-iconica`, `roma-completa`, `la-dolce-vita`, `roma-by-night`. Lingue: `en`, `it`, `fr`, `es`, `de`. Prezzi per gruppo, non per persona. Extra e coupon non confermati non sono supportati.

## Richiesta

`POST /requests`, JSON:

```json
{
  "requestId":"c6c34e91-8875-4d07-b301-c55cf5411c1c",
  "privacyAccepted":true,
  "customer":{"name":"Nome Cognome","email":"guest@example.com","phone":"+393200000000"},
  "booking":{"tourId":"roma-iconica","people":4,"extraStops":0,"date":"2027-06-20","hotel":"Hotel o indirizzo pickup, Roma","lang":"en","notes":""}
}
```

Generare `requestId` con `crypto.randomUUID()` per ogni nuova richiesta. Riutilizzare lo stesso ID e gli stessi dati dopo un timeout o un errore di rete. Cambiare ID solo per una nuova richiesta deliberata. Accetta date da domani a due anni, rispetto al fuso Europe/Rome; per partenze in giornata contattare Maximo.

Risposta `201`: `{requestId, bookingId, status:"pending", total:390, currency:"eur", paymentCollected:false}`. Invio identico ripetuto: `200`, `duplicate:true`. Stesso ID con dati diversi o data bloccata: `409`. Dati non validi: `422`. Limite richieste: `429`. Errore database: `503`, senza falso messaggio di successo. Non è una prenotazione confermata e non è un pagamento.

La notifica al gestore viene accodata nella stessa transazione del salvataggio. `201` prova il salvataggio della richiesta, non la consegna dell'email. Il pannello mostra quante notifiche restano in attesa; l'invio configurato può essere ritentato e, in casi estremi oltre la finestra del provider, duplicato.

## Pannello

`/ogre/` serve l'interfaccia. `/ogre/api/login` usa la password e imposta il cookie; `/ogre/api/session` restituisce il token CSRF; `/ogre/api/logout` revoca la sessione. Tutte le API amministrative successive al login sono protette da sessione; le modifiche richiedono `X-CSRF-Token`. Nessuna credenziale deve entrare nel codice del frontend.

Il pannello non contiene utenti clienti o un'interfaccia per driver: sono moduli futuri. Una singola password identifica il team; lo storico registra le modifiche ma non distingue i singoli membri. Il riepilogo “incassi registrati” somma gli importi marcati manualmente `paid`, non un saldo bancario o un rendiconto fiscale.
