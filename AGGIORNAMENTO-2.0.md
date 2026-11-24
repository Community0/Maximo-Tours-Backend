# Aggiornare Maximo Tours a Ogre 2.0

1. Conserva un backup del database Railway e la versione precedente del repository.
2. Estrai **Maximo-Tours-backend-2.0.0.zip**. Carica nel repository GitHub del backend il suo contenuto, con `package.json`, `package-lock.json`, `server.js`, `src` e `public` nella radice. Non caricare una cartella esterna che contenga tutto.
3. Fai il commit. Railway deve installare dal nuovo lockfile e avviare il deploy. Non cambiare DATABASE_URL, password, Stripe, Resend o i record DNS già funzionanti.
4. Attendi lo stato Online e apri https://maximotours.it/ogre . Aggiorna la pagina e accedi con la password esistente. Le nuove sezioni devono funzionare senza l'avviso di aggiornamento backend.
5. Apri **Autisti e mezzi**: rinomina gli otto golf cart iniziali e imposta i posti effettivamente disponibili per gli ospiti di ciascuno. Aggiungi gli autisti reali. I nomi iniziali sono segnaposto operativi; nessun autista viene inventato.

Le tabelle e le colonne nuove vengono create automaticamente all'avvio. La procedura non svuota il database. Le prenotazioni precedenti mantengono un golf cart ciascuna; non è possibile ricostruire retroattivamente le fonti di traffico mancanti.

Il frontend Vercel è distribuito separatamente. Se il nuovo frontend incontra il vecchio backend, mantiene le funzioni precedenti e segnala che serve aggiornare il backend; non mostra risultati operativi inventati.

## Variabili nuove facoltative

`GA4_PROPERTY_ID=565751125` è già il valore predefinito nel codice.

`GOOGLE_SERVICE_ACCOUNT_JSON` serve solo per mostrare in Ogre i report privati di Analytics e Search Console. Segui GOOGLE-REPORTS.md; lascia la variabile assente finché non hai preparato il collegamento. Tutte le altre funzioni restano utilizzabili.

## Controlli dopo il deploy

Verifica calendario, risorse e report. Per una prova senza denaro usa una prenotazione manuale non pagata e annullala dopo il controllo; la prenotazione riserva realmente un mezzo finché attiva. Non usare carte vere per un collaudo casuale. Il pagamento Stripe e la consegna email dipendono anche dall'account e dalle chiavi configurate in Railway.
