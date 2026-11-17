# Variabili Railway

La tabella aggiornata, inclusi Stripe e Resend, è in [ATTIVAZIONE.md](ATTIVAZIONE.md).

Inizia con PAYMENTS_ENABLED=false. Le chiavi vanno inserite solo in Railway. Il frontend su Vercel usa il proxy /api/maximo e non richiede chiavi Stripe pubbliche o segrete.

Versione 1.2.0: per abilitare i pagamenti bastano STRIPE_SECRET_KEY e PAYMENTS_ENABLED=true. STRIPE_WEBHOOK_SECRET è facoltativa e può restare vuota. Per incassi veri la chiave deve essere live. Mantieni Railway attivo anche senza visite, perché il server controlla Stripe in background.
