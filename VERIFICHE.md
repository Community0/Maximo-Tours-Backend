# Verifiche del 17 novembre 2026

10 test Node superati: validazione, prezzi per gruppi e tappe extra, transazioni PostgreSQL/PGlite, idempotenza, login/CSRF, importi manipolati, firma webhook, 8 golf cart e sovrapposizioni, sessione scaduta, ordine eventi, richiesta cancellazione senza rimborso automatico, rimborso autorizzato dall’admin, limite delle 24 ore.

Prova browser locale completa: scelta data/orario, prezzo per 4 ospiti, contatti e hotel, riepilogo, conferma da pagamento simulato, richiesta di cancellazione, login admin, approvazione esplicita del rimborso simulato. Nessun errore JavaScript rilevato durante il percorso verificato.

Front: 40 pagine nelle 5 lingue validate per lingua, titoli, H1, canonical, hreflang reciproci, collegamenti e asset, JSON-LD e sitemap. Layout verificato a 320, 390, 768 e 1440 pixel; il controllo browser a larghezza mobile non equivale a una prova su iPhone fisico.

Da completare con l’account del titolare: nuovo deploy Railway con PostgreSQL, prova Stripe test end-to-end, webhook, email Resend, casella Aruba, successiva abilitazione live, Search Console. Le chiavi Stripe/Resend non sono incluse nello ZIP. Nessun incasso reale è stato effettuato nei test.
