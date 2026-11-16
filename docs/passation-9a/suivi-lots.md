# Suivi des lots, mission 9a (remboursements-01M7AG5V)

Notes entre lots : retouches hors carte, écarts au plan (renforce / affaiblit), fichiers à faire relire par une personne.

| Lot | État | Notes |
|---|---|---|

## WP01 : base des demandes (migration 0081)

- Index unique partiel nommé `refund_request_one_open` (à lire par WP04 pour répondre `409 REFUND_ALREADY_OPEN` sur `23505`).
- Retouche hors carte : `tests/tests_definer_trigger_writers.sql` (liste figée des fonctions de déclencheur SECURITY
  DEFINER : ajout de `refund_request:refund_request_scope_guard`, qui ne fait que lire ; sans cela la suite échoue). Absente de
  la liste « Retouches hors carte permises » d'`interfaces.md` : à y ajouter.
- Renforcements (consignés) : garde d'insertion `refund_request_scope_guard` (CL001 pour portefeuille, grand livre,
  événement, festivalier d'un autre prestataire) ; CHECK jumelé `otp_challenge_purpose_subject` ; CHECK resserrés
  (`AWAITING_HOLDER` ⇒ `hold_until`, `BLOCKED` ⇒ `holder_decision = 'BLOCK'`, décision et date nulles ensemble, montants
  >= 0, contrôle renforcé ⇒ autre numéro, msisdn E.164 pour WAVE/ORANGE_MONEY, demandeur <> valideur).
  Choix : `estimated_amount` et `fee` NOT NULL (data-model silencieux, « calculés à la création ») ; `msisdn` nul permis
  pour `BANK_TRANSFER`. Corrigé en cours de route : un CHECK `holder_decision = 'BLOCK'` laissait passer un NULL
  (`IS NOT DISTINCT FROM`).
- Aucun écart qui affaiblit la sécurité.
- Hypothèse existante non élargie : `refund_request_operator`, `promote_due_refund_requests` et la garde lisent des tables à RLS forcée
  sans prestataire de session ; elles supposent un propriétaire qui ignore la RLS (0022, OP-N87), comme
  `otp_challenge_operator` (0080). Signalée, non « corrigée ».
- Limite constatée : aucune transition d'état n'est gardée par la base (colonnes de transition modifiables par
  `cashless_app`) ; seule l'API ordonne les états.
- À faire relire par une personne : `migrations/0081_refund_requests.sql` (RLS, garde d'insertion, trois fonctions
  SECURITY DEFINER) ; `post-roles.sql` section 11 (droits par colonne, EXECUTE de `cashless_app` et `cashless_maint`).
- Preuves (base `cashless_wp01`, après `reset-db`) :
  - FR-001, FR-003, NFR-002, invariants, isolation, droits par colonne, fonctions, `otp_challenge` : `pg_prove -d cashless_wp01
    tests/tests_refund_requests.sql` → 88 tests, tous verts (`23505` sur seconde demande ouverte du même portefeuille ;
    A ne voit ni ne modifie la demande de B, `42501` sur insertion au nom de B, `CL001` sur garde ; UPDATE method /
    msisdn / wallet_id / operator_id / hold_until, DELETE, TRUNCATE : `42501`).
  - Connexion intacte et listes figées : `pg_prove -d cashless_wp01 tests/tests_customer_auth.sql
    tests/tests_execute_grants.sql tests/tests_offline_rights.sql tests/tests_default_acl.sql
    tests/tests_definer_search_path.sql tests/tests_definer_trigger_writers.sql` → tous verts
    (`tests_customer_auth.sql` non modifié).
  - Suites générées intactes : `git diff --stat` n'affiche aucun `.sql` généré ;
    `pg_prove -d cashless_wp01 tests_grand_livre_cashless.sql scenario_reference_test.sql` → 464 tests, verts.
  - Batterie `npm run test:pgtap -w @cashless/ledger-sql` : voir le compte rendu.

## WP03 — Codes du titulaire et destination (lane-c)

- Noms et signatures pour WP04 (`CustomerAuthService` exporté par `CustomerAuthModule`, seul export) :
  - `verifyChallenge({ otpRequestId, code, expectedPhone, purpose, subjectId?, operatorId? }): Promise<void>` : transaction
    PROPRE (essai faux compté et blocage survivent à l'erreur), consomme, aucun jeton ni compte ; `422 OTP_INVALID` /
    `429 OTP_RATE_LIMITED`. `operatorId?` est un renforcement ajouté à `interfaces.md` (sans lui, un défi d'un autre
    prestataire pour le même numéro passerait) ; `resolveDestination` le passe.
  - `issueChallenge({ operatorId, phone, purpose: 'REFUND_HOLDER', subjectId }): Promise<{ otpRequestId, expiresIn, code }>`.
  - `resolveDestination(client, { operatorId, walletId, customerId, destination }, verify)` (`refunds/destination.ts`) :
    consomme le code du nouveau numéro dans la transaction PROPRE de `verify` ; l'appeler APRÈS les refus peu coûteux
    (fenêtre, éligibilité) et AVANT l'insertion. Passer `(input) => auth.verifyChallenge(input)`.
  - `HolderChallengeService.startHolderChallenge(client, refundRequestId, holderPhone)` : à appeler après l'insertion de
    la demande, dans la même transaction ; un `429` lève et annule la création. WP04 importe `RefundsHolderModule`
    (contrôleur de décision + service exporté) dans `RefundsModule`.
- Retouches hors carte : (a) `customer-auth.module.ts` `exports: [CustomerAuthService]` ; (b) `refunds-holder.module.ts` ;
  (c) `AuditAction` `'REFUND_HOLDER_DECIDED'` ; (d) ce fichier ; (e) `test/integration/maintenance/purge.spec.ts` : la liste
  figée des travailleurs reçoit `refund-promotion` (4 lignes au lieu de 3) ; (f) `test/integration/refunds/holder-fixtures.ts`
  (aides communes aux tests du lot, utiles à WP04) ; (g) `processes/maintenance.module.ts` : une ligne d'import.
- Renforcements : liaison d'usage/sujet/numéro/prestataire vérifiée avant la comparaison, sans essai compté ; `exchangeIn`
  impose `LOGIN` ; un code vivant par (numéro, usage) et par sujet ; quota par numéro commun, sans limite par adresse pour
  le titulaire (`client_ref` = HMAC de `refund-holder:<demande>`).
- Limites : l'alerte de `BLOCK` est la ligne d'audit `REFUND_HOLDER_DECIDED` (aucune autre infrastructure d'alerte) ; l'envoi
  du code reste le port `OtpSender` (faux interdit en production, garde existante).
- Aucun écart qui affaiblit la sécurité. À faire relire par une personne : `customer-auth.service.ts` (`checkCode`,
  `verifyChallenge`, `issueChallenge`, `exchangeIn`), `holder-decision.controller.ts`, `holder-challenge.service.ts`.
- Preuves (base `cashless_wp03`, après `reset-db`, depuis `apps/api`, `SKIP_LATENCY=1 npx jest … --runInBand --forceExit`) :
  - FR-011 (destination), FR-012 (code du titulaire, décision) : `test/integration/refunds/holder-challenge.spec.ts`,
    `holder-decision.spec.ts` → verts (matrice de destination, réponses 422 identiques, 409 seulement après code valide,
    429 au 5e essai, concurrence : une seule décision).
  - FR-013 : `holder-promotion.spec.ts` → vert (deux prestataires, second passage 0, cadence 60 s, `holder_decision` nul).
  - NFR-005 / codes isolés : `test/integration/customer-auth/verify-challenge.spec.ts` → vert (9 tests : usage, sujet,
    numéro, prestataire, un code vivant, quota commun, aucun jeton ni compte).
  - Connexion inchangée : `test/integration/customer-auth` (`otp`, `attempts`, `tokens` non modifiés), `maintenance`,
    `test/unit/architecture.spec.ts` → 10 suites, 101 tests verts ; `tsc --noEmit` et Prettier propres.

## Constats mineurs des lots WP03 à WP06 : suite donnée par WP07

Limites réelles (point ouvert) : WP06 (a) et (b) = OP-N128 ; WP03 12a/12b = OP-N124, OP-N125 ; WP05 valideur nominal = OP-N126 ; WP04 contradiction C-001 = OP-N127, clos le 16/11 (décision 15, ADR-194).
Notes sans limite de sécurité (pas de point ouvert) :
- WP04 : `interfaces.md` l. 111 dit « même transaction » pour la consommation du code ; en pratique c'est la transaction de WP03 (essais faux comptés). À corriger à la prochaine révision de `interfaces.md` (hors carte de WP07).
- WP04 : pas de pré-contrôle « demande déjà ouverte » avant la vérification du code : un code et un essai du quota d'OTP sont consommés pour rien en cas de `409`. Confort, pas de sécurité.
- WP04 : tri `date_trunc` sans index (NFR-004) ; `/me/wallets` en N+1 ; `ProblemException` convertie en `eligible: false`. Mesures de WP07 : p95 de création 423 ms (limite 500) sous 20 requêtes simultanées : peu de marge, à surveiller si l'éligibilité devient plus coûteuse.
- WP05 : rôle d'audit lu par `LIMIT 1` sans filtre de portée (audit seulement) ; charge utile altérée non testée (contrôles présents) ; `requested_by` jamais écrit en 9a, à rouvrir en 9b (reporté dans `PROMPTS-A-ENVOYER.md`).
- WP06 : `release.service.ts:90` cité par `debit-paths.ts` (`releaseMedia`) est périmé : la garde est aux lignes 123 et 143. La ligne `releaseMedia` est cohérente avec le reste (suites `debit-authority` vertes, 19 suites / 166 tests), seule la référence de ligne est à corriger (fichier hors carte).
- Constat de WP07 : l'`otp_request_id` du titulaire n'était rendu par aucune route (OP-N129) ; levé par la 9a (décision 14, `holder-link.spec.ts`, `journey.spec.ts`).
- La consigne de WP07 cite `tests_refund_reversal_guard.sql` : ce fichier n'existe pas (`post_transaction` est inchangée). Le négatif d'ADR-189 est porté par `journey.spec.ts`, `refund-reversal-matrix.spec.ts` et `status-matrix-refund-reversal.spec.ts`.

## Matrice proposée (contenu de `kitty-specs/remboursements-01M7AG5V/acceptance-matrix.json`, à enregistrer par l'orchestrateur)

Note du cycle 1, périmée au cycle 2 : FR-012 passe `pass` (spec amendée, décision 15) ; l'orchestrateur tient `acceptance-matrix.json`.

```json
{
  "mission_slug": "remboursements-01M7AG5V",
  "mission_number": "",
  "mission_type": "software-dev",
  "overall_verdict": "fail",
  "criteria": [
    {
      "criterion_id": "FR-001",
      "description": "Demande de remboursement persistante (S16)",
      "proof_type": "automated_test",
      "evidence": "packages/ledger-sql/tests/tests_refund_requests.sql ::  ; pgTAP 127 assertions avec tests_replace_cash_due.sql",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": "pgTAP tests_refund_requests.sql 88/88 rejoué le 16/11/2026 (WP07) ; migration 0081."
    },
    {
      "criterion_id": "FR-002",
      "description": "Création par le festivalier (Wave, Orange Money), idempotente",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/create-refund-request.spec.ts :: FR-002, FR-005; apps/api/test/integration/refunds/journey.spec.ts :: SC-001",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-003",
      "description": "Une seule demande ouverte par portefeuille, garantie par la base",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/create-refund-request.spec.ts :: NFR-002 : deuxième création 409; apps/api/test/integration/refunds/concurrency.spec.ts :: NFR-002 : 50 créations ; index refund_request_one_open (tests_refund_requests.sql)",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-004",
      "description": "Fenêtre et éligibilité",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/create-refund-request.spec.ts :: FR-004 : fenêtre close; apps/api/test/integration/refunds/create-refund-request.spec.ts :: FR-004 : solde payé nul; apps/api/test/integration/refunds/create-refund-request.spec.ts :: FR-004 : bracelet SUSPENDED; apps/api/test/integration/refunds/create-refund-request.spec.ts :: FR-004 : règle de frais absente; apps/api/test/integration/customer-app/me-refund.spec.ts :: faux hors fenêtre",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-005",
      "description": "Montant estimé = solde payé moins frais, sans crédits offerts",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/create-refund-request.spec.ts :: FR-002, FR-005; apps/api/test/integration/refunds/create-refund-request.spec.ts :: un crédit offert n’entre pas dans le montant estimé",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-006",
      "description": "Liste du festivalier, paginée",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/list-refund-requests.spec.ts :: FR-006 : pagination",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-007",
      "description": "Liste du back-office filtrée",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/list-refund-requests.spec.ts :: FR-007 : le back-office; apps/api/test/integration/refunds/list-refund-requests.spec.ts :: FR-007 : isolation",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-008",
      "description": "Approbation à deux, valideur distinct",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/approve-refund.spec.ts :: FR-008 / SC-003; apps/api/test/integration/refunds/approve-refund.spec.ts :: la même personne ne valide pas sa propre proposition",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-009",
      "description": "PAID (référence) ou FAILED (REVERSAL, solde recrédité)",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/confirm-refund.spec.ts :: FR-009 : PAID sans référence; apps/api/test/integration/refunds/confirm-refund.spec.ts :: FR-009 : FAILED sans motif; apps/api/test/integration/refunds/confirm-refund.spec.ts :: décision 13",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": "Décision 13 du 16/11/2026 : FAILED refusé au proposant et à l’exécutant (OP-N126)."
    },
    {
      "criterion_id": "FR-010",
      "description": "Refus d’une demande REQUESTED sans écriture",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/reject-refund-request.spec.ts :: FR-010, FR-020",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-011",
      "description": "Autre numéro avec code du nouveau numéro, sinon refus",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/create-refund-request.spec.ts :: FR-004 : BANK_TRANSFER et autre numéro sans code; apps/api/test/integration/refunds/create-refund-request.spec.ts :: FR-014 : autre numéro avec code",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-012",
      "description": "Décision du titulaire (CONFIRM, BLOCK) jusqu’à hold_until ; sans titulaire vérifié : REQUESTED",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/holder-decision.spec.ts :: CONFIRM : REQUESTED; apps/api/test/integration/refunds/holder-decision.spec.ts :: BLOCK : BLOCKED; apps/api/test/integration/refunds/journey-limits.spec.ts :: OP-N127",
      "pass_fail": "fail",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": "FAIL PARTIEL : la partie « sans titulaire vérifié → REQUESTED » est inatteignable par /me (contradiction C-001, OP-N127, ADR-194), à trancher par le porteur ; le reste est prouvé."
    },
    {
      "criterion_id": "FR-013",
      "description": "Échéance : AWAITING_HOLDER devient REQUESTED à hold_until, sans décision inventée",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/holder-promotion.spec.ts :: échue promue; apps/api/test/integration/refunds/refund-latency.spec.ts :: échue depuis 4 min",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-014",
      "description": "Vérification d’identité au-delà de refund_new_number_max",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/create-refund-request.spec.ts :: FR-014 : au-delà de refund_new_number_max; apps/api/test/integration/refunds/approve-refund.spec.ts :: FR-014 : extra_check_required sans note",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-015",
      "description": "Guichet de retour enchaîné dans l’ordre de §7.9",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/media/release-chaining.spec.ts :: SC-004 : caution, crédits offerts; apps/api/test/integration/refunds/journey.spec.ts :: caution, crédits offerts, solde payé et espèces dues rendus par UN appel",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-016",
      "description": "Seconde personne au guichet au-delà de cash_refund_single_max (sur le cumul)",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/media/release-chaining.spec.ts :: FR-016 : seconde personne; apps/api/test/integration/media/release-chaining.spec.ts :: fractionnement (décision du porteur du 16/11)",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": "Décision 11 : seuil sur le cumul (ADR-190)."
    },
    {
      "criterion_id": "FR-017",
      "description": "Enchaînement atomique et rejouable",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/media/release-chaining.spec.ts :: FR-017 : un refus à chaque étape annule tout",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "FR-018",
      "description": "Espèces dues d’un bracelet remplacé rendues une fois",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/media/cash-due-after-replace.spec.ts :: le neuf rend les espèces dues de l’ancien une fois et une seule",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": "pgTAP tests_replace_cash_due.sql 39/39 (rejoué le 16/11/2026)."
    },
    {
      "criterion_id": "FR-019",
      "description": "Autorité de débit : 409 DEBIT_AUTHORITY_EDGE avant toute écriture",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/approve-refund.spec.ts :: FR-019 : sous EDGE, proposition et exécution; apps/api/test/integration/refunds/confirm-refund.spec.ts :: FR-019 : FAILED sous EDGE; apps/api/test/integration/debit-authority/debit-paths-refused.spec.ts :: ",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": "Constat : la référence `release.service.ts:90` de debit-paths.ts (releaseMedia) est périmée (garde aux lignes 123 et 143) ; fichier hors carte de WP07."
    },
    {
      "criterion_id": "FR-020",
      "description": "Journal d’audit de chaque étape",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/create-refund-request.spec.ts :: FR-020 : une ligne d’audit par création; apps/api/test/integration/refunds/approve-refund.spec.ts :: FR-020 : l’audit de l’exécution porte le rôle; apps/api/test/integration/refunds/reject-refund-request.spec.ts :: FR-010, FR-020",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "NFR-001",
      "description": "Aucun double remboursement (100 exécutions, 100 rejeux, 100 FAILED)",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/concurrency.spec.ts :: NFR-001 : 100 exécutions simultanées; apps/api/test/integration/refunds/concurrency.spec.ts :: NFR-001 : 100 rejeux; apps/api/test/integration/refunds/concurrency.spec.ts :: NFR-001 : 100 confirmations FAILED",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "NFR-002",
      "description": "Une seule demande ouverte sous 50 créations simultanées",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/concurrency.spec.ts :: NFR-002 : 50 créations simultanées",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": "Aussi 20 créations en WP04."
    },
    {
      "criterion_id": "NFR-003",
      "description": "Grand livre équilibré après chaque parcours",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/journey.spec.ts :: SC-002 (a) parcours payé; apps/api/test/integration/refunds/journey.spec.ts :: SC-002 (b) parcours échoué; apps/api/test/integration/refunds/concurrency.spec.ts :: NFR-003 : après les parcours",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": "Fonction d’invariant unique : refunds/refund-invariants.ts."
    },
    {
      "criterion_id": "NFR-004",
      "description": "p95 sous 500 ms à 20 requêtes simultanées",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/refund-latency.spec.ts :: création, lecture du festivalier et liste du back-office",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": "Mesuré seul le 16/11/2026 : création min 265 / médiane 360 / p95 423 / max 429 ms ; GET /me/refund-requests 50/77/89/91 ms ; GET /refund-requests 64/88/109/110 ms. La création a peu de marge sous la VM Docker."
    },
    {
      "criterion_id": "NFR-005",
      "description": "Échéance tenue : traitable au plus 5 min après hold_until",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/refund-latency.spec.ts :: test statique : l’intervalle de la tâche; apps/api/test/integration/refunds/refund-latency.spec.ts :: échue depuis 4 min; apps/api/test/integration/refunds/refund-latency.spec.ts :: la décision du titulaire après l’échéance est refusée",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": "Intervalle 60 s ; écart calculé par la base."
    },
    {
      "criterion_id": "SC-001",
      "description": "Créer, lister, décider : aucune réponse 404",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/journey.spec.ts :: SC-001 : connexion par code",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "SC-002",
      "description": "Parcours payé, échoué, refusé, bloqué",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/journey.spec.ts :: SC-002 (a); apps/api/test/integration/refunds/journey.spec.ts :: SC-002 (b); apps/api/test/integration/refunds/journey.spec.ts :: SC-002 (c)",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "SC-003",
      "description": "100 % des validations par l’auteur refusées",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/journey.spec.ts :: SC-003 : 20 tentatives",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "SC-004",
      "description": "Bracelet restitué en une opération, dans l’ordre",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/journey.spec.ts :: caution, crédits offerts, solde payé et espèces dues rendus par UN appel; apps/api/test/integration/media/release-chaining.spec.ts :: SC-004 : caution",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    },
    {
      "criterion_id": "SC-005",
      "description": "Aucune demande vers un autre numéro traitable avant décision ou échéance",
      "proof_type": "automated_test",
      "evidence": "apps/api/test/integration/refunds/journey.spec.ts :: SC-005 : autre numéro avec titulaire vérifié",
      "pass_fail": "pass",
      "verified_by": "claude (implémenteur WP07)",
      "verified_at": "2026-11-16",
      "notes": ""
    }
  ],
  "negative_invariants": [
    {
      "invariant_id": "NI-001",
      "description": "Aucun double remboursement (NFR-001)",
      "verification_method": "custom_command",
      "verification_command": "cd apps/api && SKIP_LATENCY=1 npx jest test/integration/refunds/concurrency.spec.ts --runInBand --forceExit (PGDATABASE=cashless_wp07 + source tools/dev-db/env.sh)",
      "result": "confirmed_absent",
      "evidence": "concurrency.spec.ts : 100 exécutions, 100 rejeux, 100 FAILED concurrents ; une seule écriture ; jamais 500"
    },
    {
      "invariant_id": "NI-002",
      "description": "Aucun autre REVERSAL admis que celui d’un WALLET_REFUND de source BACKOFFICE (ADR-189)",
      "verification_method": "custom_command",
      "verification_command": "cd apps/api && npx jest test/integration/refunds/journey.spec.ts test/integration/ledger/refund-reversal-matrix.spec.ts test/unit/ledger/status-matrix-refund-reversal.spec.ts --runInBand --forceExit -t \"ADR-189|REVERSAL\"",
      "result": "confirmed_absent",
      "evidence": "journey.spec.ts « négatif d’ADR-189 » (matrice complète) ; refund-reversal-matrix.spec.ts ; CL003 en grand livre LOCKED"
    },
    {
      "invariant_id": "NI-003",
      "description": "Aucune fuite entre prestataires (listes, refus, décision du titulaire, RLS de refund_request)",
      "verification_method": "custom_command",
      "verification_command": "cd apps/api && npx jest test/integration/refunds --runInBand --forceExit ; pg_prove tests_refund_requests.sql",
      "result": "confirmed_absent",
      "evidence": "list-refund-requests.spec.ts « FR-007 : isolation », reject-refund-request.spec.ts « isolation », approve-refund.spec.ts (404 autre prestataire), holder-decision.spec.ts « défi d’un autre prestataire », tests_refund_requests.sql (RLS)"
    },
    {
      "invariant_id": "NI-004",
      "description": "Aucun faux en production (envoyeur de code, OP-N120)",
      "verification_method": "custom_command",
      "verification_command": "cd apps/api && npx jest test/unit/production-guard.spec.ts --runInBand",
      "result": "confirmed_absent",
      "evidence": "production-guard.spec.ts ; l’envoyeur d’enregistrement des tests de la mission n’est pas un faux (isFake absent) et n’est jamais câblé hors des tests"
    }
  ]
}
```
### WP03, cycle 2 (décision 14, OP-N129) : lien du titulaire
- `OtpSender.send(phone, code, channel, link?: { refundRequestId, otpRequestId })` : `link` fourni seulement pour l'usage
  titulaire (`issueChallenge`), la connexion garde trois arguments. Retouche hors carte : `customer-auth/otp-sender.ts`.
- Le faux garde le dernier envoi en mémoire (`lastSent()`), lisible par injection de `OTP_SENDER` ; le code du titulaire
  ne sort dans aucune réponse ni en-tête. `startHolderChallenge` garde sa signature : WP04 ne change rien.
- Preuve : `test/integration/refunds/holder-link.spec.ts` (BLOCK -> BLOCKED, CONFIRM -> REQUESTED, sans lecture en base) ;
  suites `customer-auth`, `refunds/holder`, `maintenance`, `architecture` : 11 suites, 104 tests verts. Le test « réponse de
  `createMyRefundRequest` sans le code » revient à WP04/WP07 (la route n'existe pas dans cette lane) : `startHolderChallenge`
  ne renvoie rien et aucune route n'écrit le code.
