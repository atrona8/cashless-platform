---
affected_files: []
cycle_number: 3
mission_slug: hors-ligne-snapshots-lots-01M645RN
reproduction_command:
reviewed_at: '2026-11-02T10:51:15Z'
reviewer_agent: claude
wp_id: WP03
---

# WP03 — réouverture, cycle 3 (décision du porteur du 02/11/2026)

Origine : relecture de WP11 (snapshot-content), trois trous de 0044 reproduits. Aucun n'affaiblit la sécurité
(échec fermé), mais 1 et 2 cassent le fonctionnement. Le porteur a choisi de corriger 0044 dans WP03.
Fichiers : `packages/ledger-sql/migrations/0044_offline_snapshots.sql` et
`packages/ledger-sql/tests/tests_offline_snapshots.sql` seulement. Règles du lot inchangées : `REVOKE ALL … FROM
PUBLIC` sur toute fonction nouvelle, **aucun GRANT** (le GRANT à `cashless_snapcontent` sera posé par WP11 cycle 2
dans `post-roles.sql`), tests pgTAP sous le propriétaire seulement.

## B1 (bloquant) — brouillon orphelin
Aucune fonction ne permet au processus de contenu de retrouver ou de jeter un brouillon `OPEN` (ou `READY` jamais
signé) laissé par un passage planté : l'id est perdu, `discard_offline_snapshot_draft` exige l'id, et `save_` refuse
ensuite par `DRAFT_ALREADY_OPEN` (CL048) : le grand livre est bloqué pour toujours.
Attendu : une fonction SECURITY DEFINER, `search_path` figé, contrôle de tenant comme les autres fonctions de 0044,
par exemple `discard_open_offline_snapshot_drafts(p_ledger_id uuid) RETURNS integer` (nombre de brouillons jetés), qui
passe à `DISCARDED` les brouillons `OPEN` et `READY` du grand livre (jamais un `PUBLISHED`), avec la même trace que
`discard_offline_snapshot_draft`. Si tu choisis un autre nom ou une autre signature, justifie-le. Tests : brouillon
OPEN puis READY jetés, PUBLISHED intact, autre grand livre et autre prestataire intacts, `save_` réussit ensuite.

## B2 (bloquant) — empreinte d'état dépendante du chiffré du mot de passe
`offline_snapshot_source_rows` rend `pwd_pack_sha256` à NULL, mais `publish_` enregistre dans
`offline_snapshot_state.entry_sha256` l'empreinte de l'entrée publiée, `pwd_pack_sha256` rempli : toute ligne avec
mot de passe paraît modifiée à chaque passage (même avec un chiffrement déterministe), et un portefeuille BLOCKED avec
mot de passe, bloquant, déclenche un DELTA par seconde.
Attendu : l'empreinte de détection de changement ne dépend plus du chiffré (`pwd_pack_enc`, `pwd_pack_sha256`) ; un
changement réel du mot de passe à la source produit quand même une entrée dans le DELTA suivant (trouve dans le schéma
ce qui, côté source, change quand le mot de passe change : version, date, empreinte du secret, etc. ; si rien
n'existe, signale-le au lieu d'inventer). Adapte `offline_snapshot_entry_sha256` / `offline_snapshot_state_hashes`
et `publish_` en conséquence ; garde `content_sha256` inchangé (couvre les entrées sans `pwd_pack_enc`).
Tests : même source deux fois avec deux chiffrés différents = aucun changement ; mot de passe changé à la source =
entrée changée ; ligne sans mot de passe inchangée.

## B3 — plafond `max_snapshot_age` illisible
Le contrat veut `valid_until = generated_at + max_snapshot_age` du prestataire (politique effective, 0043), mais
`offline_snapshot_targets` ne le rend pas : WP11 code 15 min en dur.
Attendu : `offline_snapshot_targets` rend aussi le plafond effectif (en secondes ou `interval`, au choix, documenté),
lu par la politique effective de 0043 (fonction existante, pas de recopie de la règle d'héritage). Test : plafond
hérité et plafond surchargé.

## Contrat
Ces ajouts ne sont pas dans `contracts/interfaces.md` : ne le modifie pas, liste précisément les signatures
nouvelles ou changées dans ton compte rendu (l'orchestrateur et WP21 les reportent). Relance `tests_offline_snapshots.sql`
et les suites de WP04 à WP07 qui lisent 0044 (`tests_offline_snapshot_keys.sql`, `tests_offline_device_vendor.sql`).
