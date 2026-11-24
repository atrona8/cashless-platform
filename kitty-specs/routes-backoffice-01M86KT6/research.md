# Recherche — Routes serveur du back-office (mission 11b)

Faits relevés dans le code le 24/11/2026 (chemins : `L` = `packages/ledger-sql`, `A` = `apps/api/src`,
`C` = `packages/contracts/openapi.yaml`). Décisions : D1 à D3 prises par le porteur au plan (moments de décision du
24/11/2026) ; D5, D6 et D8 acceptées par le porteur avec l'alignement technique du 24/11/2026 ; D4, D7 (audit sans
numéro, au lieu d'une empreinte), D9 et D10, décidées après l'alignement, **validées explicitement par le porteur le
24/11/2026**, avec la forme (a) de `x-roles` et les ajouts aux réponses des terminaux.

## Faits établis

- **Écart de caisse déjà écrit.** La transaction `CASH_CLOSE` porte l'écart sur `OPE_PERTES` ou `ORG_PERTES`
  (`A/ledger/builders/closing/cash.ts:38-45`) ; `finish_cash_close` crée ensuite l'anomalie `CASH_DIFF` avec
  `transaction_id` et `abs(compté − théorique)` (`L/migrations/0036_cash_sessions.sql:463-479`). Classer un
  `CASH_DIFF` n'oublie donc aucun argent.
- **Anomalies.** Table `anomaly` (schéma 842-865, plus `loss_bearer`, `detail`, `batch_id` en 0047), statut
  `OPEN`/`RESOLVED`, RLS `tenant_isolation`. Liste fermée étendue en 0038 avec `PSP_TOPUP_NOT_CREDITED` : la base
  connaît **23 types**, dont deux absents du tableau de SPECIFICATION §12.2 (`CASH_TOPUP_OVER_LIMIT`,
  `PSP_TOPUP_NOT_CREDITED`) — contradiction à signaler (§0.3 : le schéma prime). Aucune route ne liste les anomalies.
- **Droit existant à surveiller.** `cashless_app` a `UPDATE (status, resolution_tx_id)` sur `anomaly`
  (`L/roles.sql:38-39`) ; seul `CASH_TOPUP_OVER_LIMIT` est gardé (déclencheur `anomaly_cash_due_guard`).
  `waive_seq_gap` (SQL) clôt un `SEQ_GAP` sans écriture.
- **Ventes.** `journal_transaction` (`type = 'PURCHASE'`, `source` ∈ ONLINE, OFFLINE_SYNC, EDGE_SYNC, …,
  annulation = ligne `REVERSAL` avec `reverses_id`, unique), `sale_attribution` (vendeur, session, terminal, canal),
  `sale_line` (lignes, `pos_id`). Commerçant : par le compte `MERCHANT` du posting et la participation
  (`A/payments/payment-read.service.ts:63-80`). Index : `(ledger_id, occurred_at)`, `(event_id, type)`. Toutes ces
  tables : RLS, lecture seule pour `cashless_app`.
- **Rôles.** `Role` (9 valeurs, `A/identity/principal.ts:6-16`), portées PLATFORM ⊃ OPERATOR ⊃ ORGANIZER ⊃ EVENT,
  MERCHANT sous OPERATOR et EVENT (`scope-resolver.ts`). Attributions relues en base à chaque requête. Seules 11
  routes portent `@Roles` ; les autres contrôlent dans leurs services.
- **Recherche.** `media.nfc_uid` (7 octets, en clair), `media.claim_code_hash` (HMAC, `ClaimHasher.claimCodeHash`),
  `media.wallet_id`. `customer_identity.phone` en clair (E.164), unique par prestataire ; `wallet.customer_id`. Aucune
  empreinte de numéro dans le projet.
- **Terminaux.** Aucune colonne fabricant ou modèle. Schémas : `DeviceEnrollmentRequest`, `HeartbeatRequest`,
  `DevicePage`, `DeviceAdminDetail`.
- **Débit.** Pas de `@nestjs/throttler` : limites maison adossées à la base, `429 RATE_LIMITED` avec `Retry-After`.
- **Audit.** `audit_log.action` libre en SQL, liste fermée en TypeScript (`AuditAction`, `A/audit/audit.service.ts`).
- **Contrat.** Extensions `x-` déjà utilisées (`x-process`, `x-edge-available`, …). `check.mjs` n'admet un ajout que
  s'il figure dans `contract-baseline.json` avec son empreinte, et toute modification de la référence exige une ligne
  « Décision du porteur ».
- **Dernière migration** : `0100` → la mission prend `0101` (écritures) et `0102` (vues de lecture).

## Décisions

### D1 — Types d'anomalie classables (porteur, 24/11/2026)
- **Decision** : 10 types classables, tenus dans la base : `CASH_DIFF`, `CLOCK_SKEW`, `CARD_VELOCITY`,
  `IDEMPOTENCY_CONFLICT`, `CHAIN_BROKEN`, `COUNTER_DUPLICATE`, `COUNTER_TIME_INVERSION`, `UID_MISMATCH`,
  `RETIRED_IDENTITY`, `SIGNATURE_MISMATCH`. Les 13 autres (dont `PSP_TOPUP_NOT_CREDITED`) sont refusés.
- **Rationale** : aucun ne laisse d'argent en attente ; les autres exigent une écriture ou ont leur propre voie.
- **Alternatives** : sans les signaux de sécurité du bracelet ; signaux de sécurité à deux personnes.

### D2 — Source du modèle du terminal (porteur, 24/11/2026)
- **Decision** : déclaré par l'app terminal (fabricant, modèle) dans un champ facultatif de `DeviceEnrollmentRequest`
  et de `HeartbeatRequest` ; valeur informative. **Exception à C-001 accordée** pour ces deux ajouts facultatifs.
- **Alternatives** : saisie par un administrateur ; les deux.

### D3 — Fidélité de `x-roles` (porteur, 24/11/2026)
- **Decision** : matrice d'appels échantillon : pour chaque opération, un appel avec un rôle déclaré (pas de refus pour
  droit) et un avec un rôle non déclaré (refus attendu).
- **Alternatives** : matrice complète (> 2 000 appels) ; registre unique (refonte de toutes les missions).

### D4 — Classement par fonction de la base, droit direct retiré (renforcement)
- **Decision** : `classify_anomaly(p_anomaly, p_reason, p_actor)` en `SECURITY DEFINER` : refuse un type hors D1, une
  anomalie non `OPEN`, un motif vide ; enregistre le classement ; ne touche jamais `resolution_tx_id`. Ensuite, si
  aucun code de l'API ne fait `UPDATE anomaly` en direct (à vérifier en WP01), **retirer** `UPDATE (status,
  resolution_tx_id)` à `cashless_app` ; sinon, ajouter un déclencheur qui refuse `OPEN → RESOLVED` sans
  `resolution_tx_id` hors des fonctions habilitées. Renforcement, consigné (règle 1 de `CLAUDE.md`).
- **Rationale** : la liste D1 doit être tenue par la base ; le droit direct actuel permettrait de clore n'importe quelle
  anomalie d'argent depuis l'application.

### D5 — Lectures sous RLS, sans droit nouveau
- **Decision** : ventes et anomalies lues par des vues `security_invoker` (ou des requêtes du dépôt `db/`) sous la RLS
  du prestataire ; filtre de portée (organisateur, événement, commerçant) appliqué dans la requête à partir des
  attributions ; pagination par curseur opaque `(occurred_at, id)`, `limit` ≤ 200 (défaut 50).
- **Rationale** : NFR-003, NFR-005 ; même patron que `payment-read.service.ts`.

### D6 — Portée du commerçant appliquée en requête
- **Decision** : un `MERCHANT_ADMIN` ne voit que les ventes dont le compte `MERCHANT` crédité appartient à une
  participation de son commerçant ; le filtre est dans la requête SQL, pas après lecture.

### D7 — Recherche par numéro : POST, exact, audit sans numéro
- **Decision** : `POST /search/customers` (numéro dans le corps, jamais dans l'URL ni les journaux d'accès), format
  E.164 strict, égalité exacte sur `customer_identity.phone` (portée du prestataire, puis restriction aux portefeuilles
  des événements de la portée de l'appelant). Réponse : portefeuilles et bracelets, numéro masqué (`+221 77 *** ** 12`).
  Audit `STAFF_CUSTOMER_SEARCH` : auteur, rôle, portée, nombre de résultats, identifiants des clients trouvés ;
  **jamais le numéro** (ni en clair ni en empreinte, d'où aucun secret nouveau). Refus pour débit audités aussi.
- **Rationale** : FR-013, FR-014, NFR-006 ; pas de secret supplémentaire à gérer en production.

### D8 — Limite de débit de la recherche par numéro
- **Decision** : 20 par minute et par personne (réglable), compté dans la base sur les lignes d'audit
  `STAFF_CUSTOMER_SEARCH` de l'auteur des 60 dernières secondes (index à ajouter si besoin) ; `429 RATE_LIMITED` avec
  `Retry-After`.
- **Rationale** : même mécanique que les autres limites du projet, valable en multi-instance.

### D9 — Modèles de téléphone : table de plateforme
- **Decision** : table `phone_model` sans `operator_id`, écrite par l'administrateur plateforme via la connexion de
  plateforme (`PlatformTx`) et une fonction de la base, lisible par tous les administrateurs. Colonnes du terminal
  `device.manufacturer`, `device.model` écrites par les fonctions existantes d'enrôlement et de signal de vie (nouvelles
  versions), **sans droit de colonne nouveau** pour `cashless_app`. Niveau calculé à la lecture : `RECOMMENDED`,
  `TOLERATED` ou `UNTESTED`.

### D10 — Codes d'erreur existants seulement
- **Decision** : aucun code nouveau. Anomalie non classable : `422 VALIDATION_FAILED` avec `reason =
  ANOMALY_KIND_NOT_CLASSIFIABLE` ; déjà traitée : `409 CONFLICT_STATE` ; débit : `429 RATE_LIMITED` ; hors portée :
  `404 NOT_FOUND`.
- **Rationale** : précédent de la 9c (`reason` porte le motif distinct) ; contrat stable.

## Contradiction à signaler (§0.3)

SPECIFICATION §12.2 liste 21 types d'anomalie ; le schéma en a 23 (`CASH_TOPUP_OVER_LIMIT`,
`PSP_TOPUP_NOT_CREDITED`). Le schéma prime ; amender §12.2 en WP de consignation, avec ADR.
