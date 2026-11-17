# Verifiche del 17 novembre 2026

10 test Node superati: validazione, prezzi per gruppi e tappe extra, transazioni PostgreSQL/PGlite, idempotenza, login/CSRF, importi manipolati, firma webhook, 8 golf cart e sovrapposizioni, sessione scaduta, ordine eventi, richiesta cancellazione senza rimborso automatico, rimborso autorizzato dall’admin, limite delle 24 ore.

La versione 1.2.0 aggiunge nello stesso gruppo di test: pagamenti abilitati senza webhook, conferma da API Stripe al ritorno, mancata conferma con semplice parametro `paid`, indisponibilità temporanea Stripe e recupero, limite ai controlli ripetuti, pagamento con browser chiuso, 26 sessioni con più lotti senza bloccare i pagamenti recenti, rimborso dalla dashboard rilevato senza webhook, scadenze e rimborsi sempre manuali. Stripe resta simulato.

Prova browser locale completa: scelta data/orario, prezzo per 4 ospiti, contatti e hotel, riepilogo, conferma da pagamento simulato, richiesta di cancellazione, login admin, approvazione esplicita del rimborso simulato. Nessun errore JavaScript rilevato durante il percorso verificato.

Front: 40 pagine nelle 5 lingue validate per lingua, titoli, H1, canonical, hreflang reciproci, collegamenti e asset, JSON-LD e sitemap. Layout verificato a 320, 390, 768 e 1440 pixel; il controllo browser a larghezza mobile non equivale a una prova su iPhone fisico.

Online verificati il 17 novembre: database operativo, login e logout admin, riepilogo protetto, configurazione email presente, flotta di 8 golf cart. Da completare con l’account del titolare: deploy della versione 1.2.0, prova Stripe end-to-end, recapito email Resend/casella Aruba, Search Console. Le chiavi Stripe/Resend non sono incluse nello ZIP. Nessun incasso reale è stato effettuato nei test.
