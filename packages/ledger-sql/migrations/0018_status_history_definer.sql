-- Migration 0018 : les historiques de statut ne s'écrivent que par leurs déclencheurs (mission bracelets-nfc, lot 20,
-- cycle 5 ; relecture du 15/10/2026, option A retenue ; ADR-94, OP-N56).
--
-- Avant : `log_media_status` et `log_batch_status` (schéma de référence) s'exécutaient avec les droits de l'appelant.
-- Le rôle de l'API gardait donc INSERT sur `media_status_history` et `media_batch_status_history`, et pouvait y
-- écrire n'importe quelle ligne, avec l'identifiant de son choix. Or `media_reinstatement_approved` (migration 0017)
-- prend pour épisode de liste noire en cours le `max(id)` des lignes `BLACKLISTED` : une ligne plantée avec un très
-- grand identifiant figeait « l'épisode en cours », et une demande REINSTATE_MEDIA approuvée restait réutilisable
-- après une nouvelle mise en liste noire, sans nouvelle demande ni nouvelle décision.
--
-- Même défaut sur `media_assignment` : écrite par le même déclencheur (rattachement à la création d'un bracelet) et,
-- sinon, par des fonctions SECURITY DEFINER seulement ; le nombre de ses lignes forme les clés d'idempotence du
-- préchargement et des cautions, et sa ligne ouverte désigne le portefeuille débité (`media_wallet`).
--
-- Après : les deux fonctions de déclencheur s'exécutent avec les droits du propriétaire, `search_path` fixé.
-- `post-roles.sql` retire ensuite INSERT au rôle de l'API (et au rôle de la personnalisation) sur les deux
-- historiques, et INSERT, UPDATE sur `media_assignment`. Le contenu écrit ne change pas : les réglages de session
-- (`app.user_id`, `app.reason`, `app.approved_by`) sont ceux de la transaction appelante ; l'identifiant vient de la
-- séquence et `at` de `clock_timestamp()`.
--
-- RLS : les deux historiques ont FORCE ROW LEVEL SECURITY. Un propriétaire non superutilisateur reste soumis à
-- `tenant_isolation` (même `app.operator_id` que l'appelant) ; un propriétaire superutilisateur (poste local) l'ignore,
-- mais la ligne écrite reprend le prestataire de la ligne `media` / `media_batch` que l'appelant vient de modifier
-- sous sa propre RLS.

ALTER FUNCTION log_media_status() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION log_batch_status() SECURITY DEFINER SET search_path = public;
-- Fonctions de déclencheur : jamais appelées directement (le droit EXECUTE n'est pas vérifié au déclenchement).
REVOKE ALL ON FUNCTION log_media_status(), log_batch_status() FROM PUBLIC;
