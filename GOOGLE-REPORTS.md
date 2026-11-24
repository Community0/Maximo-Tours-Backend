# Collegare Analytics e Search Console a Ogre

La proprietà verificata nel pannello Maximo Tours è **565751125**. L'ID del tag pubblico è **G-KW2LQ6P9NE**: sono due cose diverse. La proprietà Search Console è **sc-domain:maximotours.it**.

Il codice è pronto; per leggere i report privati serve un account di servizio autorizzato in sola lettura. Questo passaggio non è stato eseguito automaticamente. Non condividere chiavi in chat o nel repository.

1. Con l'account Google Maximo, apri Google Cloud Console e usa un progetto dedicato a Maximo. Non usare progetti o proprietà Aura.
2. In API e servizi → Libreria, abilita **Google Analytics Data API** e **Google Search Console API**.
3. In IAM e amministrazione → Account di servizio, crea un account dedicato, ad esempio `ogre-report-reader`. Non assegnare ruoli amministrativi al progetto e non abilitare delega a livello di dominio.
4. Copia l'indirizzo dell'account di servizio, che termina con `iam.gserviceaccount.com`.
5. In Analytics → Amministrazione → Proprietà Maximo Tours → Gestione accessi alla proprietà, aggiungi quell'indirizzo con ruolo **Visualizzatore**. Mantieni visibili i dati economici necessari ai report. Non aggiungerlo alle altre proprietà.
6. In Search Console → proprietà maximotours.it → Impostazioni → Utenti e autorizzazioni, aggiungi lo stesso indirizzo con accesso **Limitato**, per leggere i dati di rendimento. Non concedere proprietà o accesso alle altre attività.
7. Nell'account di servizio Google Cloud → Chiavi, crea una chiave JSON e conserva il file privatamente. Se la tua organizzazione blocca questa operazione, non disabilitare la policy: serve un'alternativa di autenticazione da concordare.
8. Railway → servizio backend web → Variables: aggiungi **GOOGLE_SERVICE_ACCOUNT_JSON** con l'intero contenuto JSON del file, preservando virgolette ed escape. Non inserirlo su Vercel, GitHub, nel frontend o in chat.
9. Facoltativo: aggiungi **GA4_PROPERTY_ID=565751125** (è già il valore predefinito). Applica e ridistribuisci il backend.
10. In Ogre → Traffico e Google → scegli il periodo e aggiorna. Se compare un errore, verifica API abilitate, indirizzo autorizzato e ID della proprietà. Una proprietà recente può non avere ancora dati.

L'integrazione chiede solo gli scope `analytics.readonly` e `webmasters.readonly`. Non modifica tag, pagine, indicizzazione o impostazioni Google. I report vengono conservati in memoria per cinque minuti, non scritti nel database. La chiave può essere revocata da Google Cloud in qualsiasi momento.

Fonti ufficiali:
- https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart
- https://developers.google.com/webmaster-tools/v1/how-tos/authorizing
- https://support.google.com/webmasters/answer/7687615
