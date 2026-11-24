# Verifiche — 24 novembre 2026, versione 2.0.0

## Esito locale

**12 test backend superati**, compresa un'integrazione dell'interfaccia contro Express e PostgreSQL/PGlite isolato. Copertura: autenticazione, CSRF, CORS, prezzi, richieste e pagamenti idempotenti, firma webhook opzionale, conferma verificata lato server, recupero pagamenti, disponibilità con sovrapposizioni, rimborsi solo dopo conferma admin.

Nuovi controlli: creazione di prenotazioni con più mezzi, prezzi per sottogruppo, modifiche concorrenti, assegnazioni duplicate o sovrapposte, capacità effettiva dei mezzi (anche per gruppi ancora non assegnati), registrazione incasso esterno, protezione dell'importo già pagato, calendario, esportazione CSV con protezione formule, storico e migrazione ripetuta senza duplicare flotta o prenotazioni.

Un ulteriore test del frontend verifica consenso negato iniziale, attivazione, revoca, sessione anonima, pulizia dei parametri privati negli URL e deduplicazione dell'evento acquisto. Nessun dato di contatto viene aggiunto agli eventi di analytics.

Controllo visivo in browser locale con dati fittizi: calendario, modulo modifica, menu mobile e report a 320, 768, 1024 e 1440 pixel; nessuno scorrimento orizzontale dell'intera pagina nelle viste verificate. Le tabelle lunghe hanno scorrimento interno. Non equivale a una prova su iPhone fisico.

## Limiti e attivazione

Stripe è simulato nei test: nessuna carta reale addebitata e nessun rimborso reale inviato. Nessuna email reale inviata. La consegna Resend e il funzionamento delle chiavi private richiedono verifiche nell'account del titolare.

Le credenziali dei report Google non sono state create o autorizzate; il pannello mostra correttamente “Collegamento Google da completare”. Non sono stati simulati dati come se provenissero da Google.

Il backend di produzione va aggiornato dal titolare con lo ZIP 2.0.0. Il frontend è un rilascio separato. Fino all'aggiornamento backend, le nuove funzioni segnalano l'incompatibilità senza alterare i dati esistenti. Le statistiche interne non ricostruiscono le visite precedenti all'attivazione.
