-- 0056 : index des historiques lus par la lecture des changements d'un snapshot
-- (mission hors-ligne-snapshots-lots, WP21 partie I ; NFR-005, blocage visible en 5 s au plus).
--
-- Constat : `offline_snapshot_source_rows` (DELTA) repart de 5 s avant le début de lecture du FULL précédent ; les
-- historiques de statut posés juste avant par un chargement massif tombent dans cette fenêtre, donc les candidats
-- sont tous les bracelets (50 000) et non quelques centaines. Le filtre final rejoue alors, pour chaque ligne, des
-- EXISTS corrélés sur media_status_history (media_id), media_batch_status_history (batch_id) et media_assignment
-- (media_id, wallet_id). Aucun index ne porte ces colonnes (seuls existent les index de clé primaire (id) et
-- media_assignment_one_open (media_id, currency) WHERE released_at IS NULL, inutilisable ici : il exclut les
-- rattachements libérés) : chaque EXISTS est un parcours complet par ligne, 50 000 x 100 000, et la lecture est
-- coupée à 30 s par le statement_timeout du rôle.
-- Correction : trois index ordinaires (les migrations tournent en une transaction : pas de CONCURRENTLY).
-- Aucun droit, aucune colonne, aucune fonction ne change ; coût d'écriture : un index de plus par insertion
-- d'historique ou de rattachement.

CREATE INDEX IF NOT EXISTS media_status_history_media_at_idx ON media_status_history (media_id, at);
CREATE INDEX IF NOT EXISTS media_batch_status_history_batch_at_idx ON media_batch_status_history (batch_id, at);
CREATE INDEX IF NOT EXISTS media_assignment_media_wallet_idx ON media_assignment (media_id, wallet_id);
