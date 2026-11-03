# Constats de relecture WP20 (commit 1b824251) — avis : planned (tests seulement), move-task NON lancé

Code conforme sur (a), (b), (d), (f), (g) ; 24/24 (lot) et 49/49 (WP19 processing*) ; maxWorkers=3 x2 vert.
Quatre mutants survivent : les gardes existent dans le code mais aucun test ne les prouve.

1. [majeur, test] `journal-import.worker.ts` : `state.status !== 'COMPLETED'` remplacé par `false` -> 4/4 verts.
   Correction : test d'un import dont un lot a déjà été reçu par la voie ordinaire dans un état non COMPLETED
   (PROCESSING abandonné ou REJECTED) : l'import finit FAILED `BATCH_NOT_COMPLETED`, jamais APPLIED.
2. [majeur, test] `journal-import.service.ts` : contrôle du rôle SUPERVISOR sur l'ÉVÉNEMENT du terminal (`exercisedRole`)
   remplacé par `if (false)` -> 10/10 verts. Correction : SUPERVISOR du même prestataire mais d'un AUTRE événement
   (ou d'un autre organisateur) demande l'import : 403, rien créé (priorité du prompt : rôle avant `create_`).
3. [mineur, test] `journal-verify.ts` : raccord `prevChainHash` entre deux lots contigus remplacé par `false` -> verts.
   Correction : export de 2 lots contigus dont le second a un `prev_chain_hash` altéré (re-signé) : 409 CHAIN_BROKEN.
4. [mineur, test] `assertApprover` sans `u.status = 'ACTIVE'` -> verts (défense en profondeur ; la garde d'identité
   rend 401 à un compte DISABLED, vérifié par sonde). Ajouter le cas désactivé à `assertApprover`.
Hors WP20 : trou (e) — voir compte rendu (décision du porteur).

## Décisions du porteur (03/11/2026) — à appliquer au cycle 2
1. Tests des mutants survivants (constats 1 à 4) : `finish(APPLIED)` exige tous les lots COMPLETED (lot non
   COMPLETED → import FAILED `BATCH_NOT_COMPLETED`) ; SUPERVISOR d'un autre événement → 403 sans rien créer ;
   raccord `prevChainHash` entre deux lots contigus ; approbateur non ACTIVE (défense en profondeur).
2. Import bloqué en PENDING : CORRIGER DANS WP20. Nouvelle migration `0050_device_journal_import_cancel.sql` :
   `cancel_device_journal_import(p_import uuid, p_actor uuid, p_reason text)` (forme à préciser, SQLSTATE du
   catalogue) qui passe un import PENDING en FAILED (motif rejet/expiration), libère l'index d'unicité, idempotente,
   contrôle de portée (prestataire) ; `REVOKE ALL … FROM PUBLIC` ; EXECUTE à `cashless_app` seulement dans
   `post-roles.sql` (retouche hors carte de WP08) ; `tests_execute_grants.sql` et `tests_offline_rights.sql` mis à jour ;
   suite pgTAP de la fonction. Appel par l'API au rejet ET à l'expiration de la demande d'approbation ; test de bout
   en bout : rejet → nouvelle demande acceptée. Ne jamais modifier les `.sql` générés.
3. Corps volumineux : CORRIGER IMPORT ET LOTS. Vérifier le jeton (et, pour l'import, le rôle) AVANT de lire le corps,
   sur la route d'import ET sur `POST /offline-batches` de WP18 (`batch-body.ts`, retouche hors carte). Tests : corps
   volumineux avec jeton invalide → 401 sans lecture du corps (prouver la non-lecture), pour les deux routes ; tests
   de WP18 verts.
