# Backup e ripristino

Usare backup PostgreSQL del progetto Maximo e verificare il ripristino su un database separato prima di sostituire quello operativo. Il backend crea lo schema ma non elimina dati.

Le istruzioni storiche del backend originale sono conservate in legacy/RESTORE.md e non vanno applicate automaticamente a Maximo. Il vecchio scheduler di backup via email non viene avviato.
