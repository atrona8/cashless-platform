# Cas d'usage — mission hors-ligne-snapshots-lots-01M645RN

> État : **implémentée, relue et approuvée le 04/11/2026** (21 lots sur 21 approuvés, WP21 au cycle 2) ; en attente
> d'acceptation et de fusion. Recalé sur le code de la lane `u` à la review. Plan : `e38c1ce0`, `8fd1e037` (30/10/2026).
> `research.md` R-30 fait foi sur le reste ; en cas d'écart, le code et `contracts/interfaces.md` font foi.

## Cas d'usage propres à cette mission

### Back-office : politiques, plafonds, risque, reprises

![Cas d'usage du back-office](diagrams/usecase-backoffice.png)

Sources : [`usecase-backoffice.excalidraw`](diagrams/usecase-backoffice.excalidraw), [`usecase-backoffice.svg`](diagrams/usecase-backoffice.svg).

### Terminal : configuration, snapshot, lot, résultat

![Cas d'usage du terminal](diagrams/usecase-terminal.png)

Sources : [`usecase-terminal.excalidraw`](diagrams/usecase-terminal.excalidraw), [`usecase-terminal.svg`](diagrams/usecase-terminal.svg).

| Cas d'usage | Acteur | Règle principale (livrée) | Route |
|---|---|---|---|
| Régler le plafond du prestataire | `OPERATOR_ADMIN` | Plafonne tous les niveaux ; écriture par fonction de base, historique tenu par la base (lève OP-N58) | `GET`/`PUT /operators/{operator_id}/offline-ceiling` (`contracts/openapi-additions.md`) |
| Régler la politique hors ligne | `ORGANIZER_ADMIN` (écriture), `OPERATOR_ADMIN` (lecture) | Trois portées : organisateur, événement, terminal ; version attendue (`409` sinon) ; niveau vide = hérite ; `cash_topup_offline` à vrai refusé (`422`) | `GET`/`PUT /organizers/{id}/offline-policy`, `/events/{id}/offline-policy`, `/devices/{id}/offline-policy` |
| Couper un terminal hors ligne | `OPERATOR_ADMIN` | Désactive le hors ligne d'un terminal ; effet à la prochaine configuration servie | `PUT /devices/{device_id}/offline-policy` |
| Voir le risque maximal | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` | Somme des plafonds des terminaux hors ligne de l'événement, calculée par la base | `GET /events/{event_id}/offline-risk` |
| Lire sa configuration | Terminal | Politique effective et clés de signature des snapshots (au plus deux, ECDSA P-256) | configuration du terminal (`DeviceConfig`, `contracts/snapshots.md`) |
| Récupérer le snapshot | Terminal | `FULL` ou `DELTA` de la version précédente ; mots de passe chiffrés pour ce seul terminal ; `403` si hors ligne interdit, `409` + `Retry-After` si pas prêt | `GET /offline-snapshots/current` (`contracts/snapshots.md`) |
| Accuser réception | Terminal | Version servie à ce terminal et empreinte égale, sinon `409 SNAPSHOT_VERSION_UNKNOWN` ; idempotent, ne recule jamais (lève OP-N69) | `POST /offline-snapshots/ack` |
| Vendre hors ligne | Vendeur sur terminal | Session ouverte **en ligne**, valable 12 h ; aucune connexion hors ligne ; le terminal contrôle sur sa configuration détenue | (côté terminal, mission 11a) |
| Envoyer un lot | Terminal | Jusqu'à 500 opérations et 1 Mio ; signé et chaîné ; contrôles d'entrée complets ; une transaction par opération ; un lot en vol | `POST /offline-batches` (`contracts/batches.md`) |
| Lire le résultat | Terminal | `200` terminé, `202` + `Retry-After` en cours ; résultats mémorisés rendus à l'identique | `GET /offline-batches/{batch_id}` |
| Recharge espèces hors ligne | Terminal | **Retirée** (porteur, 30/10/2026) : `TOPUP_CASH` d'un lot rejeté par opération (`OFFLINE_NOT_ALLOWED`) avec anomalie `NON_COMPLIANT_OPERATION` portant le montant ; les autres opérations passent ; garde de caisse inchangée | `POST /offline-batches` |
| Consulter ses numéros | Terminal | Plus petit numéro à envoyer, trous connus ; servi aussi à un terminal `SUSPENDED` (comme les lots) | `GET /device/seq-status` (servie dans la mission, décision du porteur du 04/11/2026) |
| Lever un trou de numéros | `SUPERVISOR` (demande), autre `SUPERVISOR` (approbation) | Motif d'au moins 10 caractères ; demande `WAIVE_SEQ_GAP` ; contrôles rejoués à l'approbation ; aucune écriture comptable ; trou de plus de 24 h : alerte seule | `POST /devices/{device_id}/seq-gaps/{seq}/waive`, puis `POST /approval-requests/{id}/approve` |
| Importer le journal d'un terminal révoqué | `SUPERVISOR` (demande), autre `SUPERVISOR` (approbation) | Terminal `REVOKED` seulement ; jusqu'à 20 lots ; signatures, empreintes et chaîne vérifiées à la demande et à l'approbation ; opération datée après la révocation rejetée ; une demande rejetée ou expirée est annulée (`REJECTED`, migration 0050) et libère le terminal | `POST /devices/{device_id}/journal-imports`, `GET /devices/{device_id}/journal-imports/{import_id}` (`contracts/batches.md`) |
| Voir la remontée des terminaux | `ORGANIZER_ADMIN`, `OPERATOR_ADMIN` (rôles du risque maximal) | Date limite de synchronisation et, par terminal, « à jour » ou la raison ; lecture seule par une enveloppe étroite de la base (migration 0051, ADR-148) ; hors rôle ou autre prestataire : `404` neutre | `GET /events/{event_id}/device-sync-status` (servie dans la mission, décision du porteur du 04/11/2026) |

**Écarts au plan constatés à la review** (voir `architecture-notes.md` pour le détail technique) :
- Deux routes de plus servies : `GET /device/seq-status` et `GET /events/{event_id}/device-sync-status`, qui étaient au
  contrat sans code (décision du porteur du 04/11/2026). Le contrat compte aussi `getDeviceJournalImport`, ajouté le 30/10.
- `404` neutre au lieu de `403` pour la levée de trou et l'import quand la personne n'a pas le rôle voulu ou vise un
  autre prestataire : l'existence d'un terminal ne fuit plus (ADR-149, renforcement). Le contrat garde `403` pour la
  personne qui n'a le rôle nulle part.
- Un import resté `PENDING` après un rejet ou une expiration bloquait le terminal : annulation ajoutée (0050, ADR-146).
- Annulation hors ligne sans nouvelle lecture du bracelet, cible limitée au même terminal ; `vendor_session_id` ajouté au
  contrat des opérations (`PURCHASE`, `REVERSAL`) ; une vente hors catalogue est écrite sans lignes (`CATALOG_MISMATCH`).
- Un `DATABASE_URL_MAINT` qui vise le propriétaire ou un superutilisateur est refusé au démarrage en production.

Dettes héritées levées, chacune avec son test de borne : OP-N57 (version de snapshot calculée par la base), OP-N58
(politique écrite par fonction), OP-N68, OP-N69, OP-N75. Dettes nommées ouvertes : faux KMS jusqu'à la mission 12b
(aucun snapshot servi en production avant ; OP-N89) ; OP-N90 à OP-N98 (voir `docs/POINTS_OUVERTS.md`).
Réserve : le câblage de `LEDGER_LOCKED` et `SYNC_DEADLINE_PASSED` (FR-024) n'est prouvé qu'en test de fonction pure,
pas en intégration (lot WP19) ; consignée dans la matrice d'acceptation.

## Lien avec la synthèse globale
Contribue à : `docs/02-use-case-diagram.md`, domaine « Hors ligne » (vue terrain : « Vendre hors ligne », « Synchroniser
un lot » ; vue administration : « Régler la politique hors ligne », « Lever un trou de numéros », « Importer un journal »).

## Nécessaire pour cette mission ? Oui — la mission introduit la politique hors ligne, les snapshots, les lots, la levée de trou et l'import de journal, tous visibles par un acteur.
## Complet ? Oui, recalé à la review (05/11/2026) sur les routes et rôles réellement livrés : 18 opérations du tag « Hors ligne », dont 10 ajoutées au contrat. Diagrammes `/illustre` régénérés et relus : back-office (+ remontée des terminaux, note du `404` neutre) et terminal (+ consultation des numéros). Les autres cas d'usage du tableau sont inchangés.
## Validé par : proposition de l'Agent, à confirmer par le porteur, le 05/11/2026
