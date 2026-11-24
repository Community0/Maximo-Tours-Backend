# Ogre 2.0 — guida operativa

## Prima configurazione

Entra su https://maximotours.it/ogre con la password già configurata. In Autisti e mezzi, registra nomi dei mezzi, posti ospiti reali, autisti e contatti. Gli otto mezzi iniziali hanno il limite precedente di 7 posti: controllalo prima di usarli per assegnazioni. Per togliere un mezzo dal servizio, disattivalo; se serve a prenotazioni future, il gestionale richiede prima una riassegnazione. Il limite complessivo resta GOLF_CART_COUNT su Railway.

## Prenotazioni manuali e gruppi

Apri Prenotazioni → Nuova prenotazione. Inserisci cliente, telefono, hotel con indirizzo pickup, tour, data e ora di Roma. L'email è facoltativa. Indica la provenienza (telefono, WhatsApp, hotel, ecc.) e l'eventuale partner.

Aggiungi un golf cart per ogni sottogruppo e distribuisci gli ospiti. Calcola il prezzo: il listino è applicato a ciascun mezzo. Puoi assegnare subito autista e mezzo, oppure farlo dal calendario. Il salvataggio controlla sovrapposizioni, posti, blocchi giornata e flotta disponibile. Anche una prenotazione manuale non pagata, essendo confermata, riserva i mezzi.

Puoi registrare un pagamento già ricevuto in contanti, bonifico o POS esterno. Questa operazione aggiorna il registro e non incassa denaro. Non genera automaticamente un link Stripe o un documento fiscale.

## Modifiche e calendario

Apri una prenotazione → Modifica dati. Puoi cambiare data, ora, tour, pickup, ospiti e note. Gli importi Stripe già pagati restano invariati; se il nuovo listino differisce, devi confermare espressamente il prezzo concordato e motivarlo. Non parte alcun addebito o rimborso automatico.

Il calendario mostra partenze, pickup, ospiti, orario di fine e assegnazioni. Filtra per periodo, autista o mezzo. Per un gruppo con più macchine trovi una riga di assegnazione per ogni mezzo. La modifica simultanea da due finestre è protetta: in caso di conflitto, riapri la prenotazione.

Le modifiche manuali e le nuove prenotazioni inserite dall'admin non inviano email: comunica al cliente i dettagli concordati. Le conferme dei pagamenti online mantengono il flusso email esistente.

## Pagamenti, rimborsi e storico

Il pagamento online viene verificato dal server con Stripe. Non si può segnare come pagato un pagamento Stripe usando un semplice menu. Per gli incassi esterni usa Registra incasso e inserisci un riferimento.

Le richieste di cancellazione e i rimborsi restano nella scheda prenotazione. Nessun rimborso parte automaticamente. L'azione di rimborso richiede importo e conferma esplicita; riguarda i pagamenti Stripe. Lo storico mostra modifiche e registrazioni effettuate nel gestionale. L'accesso è unico per il team: non attribuisce ogni modifica a un operatore nominativo diverso.

## Report, CSV, email e traffico

I report economici filtrano per **data del tour**, non per data del bonifico Stripe. Mostrano situazione attuale, incassi, rimborsi, importi da incassare, provenienza e itinerario. Non includono commissioni, costi o contabilità fiscale. Esporta CSV per lavorare sui dettagli in Excel.

Notifiche email mostra gli ultimi 200 invii in coda e lo stato del fornitore. “Inviata al fornitore” non significa consegnata o letta dal destinatario.

Traffico e Google separa statistiche interne e report Google. Le statistiche interne iniziano con questa versione, riguardano solo visitatori consenzienti e possono sottostimare visite e vendite. Le conversioni interne si basano sui pagamenti verificati, non su un evento inventato nel browser. Il tasso di conversione riguarda le sessioni del periodo selezionato che hanno poi acquistato; gli incassi della tabella vendite usano invece la data del pagamento. I report GA4 e Search Console richiedono il collegamento descritto in GOOGLE-REPORTS.md e possono avere ritardi propri.
