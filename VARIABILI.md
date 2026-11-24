# Variabili Railway

La tabella aggiornata, inclusi Stripe e Resend, è in [ATTIVAZIONE.md](ATTIVAZIONE.md).

Inizia con PAYMENTS_ENABLED=false. Le chiavi vanno inserite solo in Railway. Il frontend su Vercel usa il proxy /api/maximo e non richiede chiavi Stripe pubbliche o segrete.

Versione 1.2.0: per abilitare i pagamenti bastano STRIPE_SECRET_KEY e PAYMENTS_ENABLED=true. STRIPE_WEBHOOK_SECRET è facoltativa e può restare vuota. Per incassi veri la chiave deve essere live. Mantieni Railway attivo anche senza visite, perché il server controlla Stripe in background.


## Ogre 2.0: report Google facoltativi

GA4_PROPERTY_ID=565751125 (predefinito). GOOGLE_SERVICE_ACCOUNT_JSON contiene le credenziali private di un account di servizio in sola lettura; lascia assente finché non configurato. Vedi GOOGLE-REPORTS.md. Non serve per calendario, prenotazioni, pagamenti o report interni.
