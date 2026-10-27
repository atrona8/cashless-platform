# Prompts à envoyer — Cashless Platform (V1)

La documentation se met à jour automatiquement après `/spec-kitty.plan` et `/spec-kitty.review` grâce au skill
`spec-kitty-docs-maintain` installé dans ce projet — rien à faire de plus pour ça tant que ces missions sont
pilotées via les slash-commands. Si tu pilotes une mission autrement (boucle CLI bas niveau, autre skill
d'orchestration), invoque `spec-kitty-docs-maintain` toi-même après le plan et après la review — voir `CLAUDE.md`
pour la procédure.

**Avant de commencer.**
- Syntaxe vérifiée le 07/10/2026 sur Spec Kitty 3.2.7 (`~/.claude/commands/spec-kitty.*.md`, `spec-kitty --help`).
- Le slug indiqué pour chaque mission est **proposé** : le slug réel est celui que renvoie `/spec-kitty.specify`
  (`mission create`). Remplace-le dans les commandes suivantes de la mission s'il diffère.
- `/spec-kitty.review` s'applique à un work package (`WP##`) ; la boucle `spec-kitty next` enchaîne implémentation
  et review des WP. Lance `/spec-kitty.review` à la main pour un WP en attente de review si besoin.
- Le dépôt a désormais un remote (`github.com/atrona8/cashless-platform`, constaté le 08/10/2026 ; la contrainte
  C-010 de la mission 1 est caduque) : `spec-kitty merge` reste local, sans `--push`, tant que le porteur n'a pas
  explicitement demandé de pousser (action extérieure).
- Chaque mission lit d'abord `README.md` (kit), `docs/SPECIFICATION.md`, `PRD.md` ; la règle de priorité de
  SPECIFICATION §0.3 s'applique, et les fichiers `.sql` générés ne se modifient jamais à la main.

---

## Mission 1 — Fondations du grand livre et de l'API

- [x] /spec-kitty.specify Fondations du système cashless (SPECIFICATION §2, §5, §10.1-10.2, §13.1, §14.2 S21, §16 critères 1 à 3). Mettre en place le monorepo imposé (§2.1, npm/pnpm workspaces), la CI (`.github/workflows/ledger-tests.yml` : schéma, `roles.sql`, `pg_prove` sur les 400 + 64 assertions sous PostgreSQL 17) et l'outillage local (pgTAP absent du PostgreSQL 17 Windows actuel ; Docker absent). Mettre en place les migrations de `packages/ledger-sql` à partir du schéma de référence. Créer le squelette NestJS de `apps/api` : connexion au rôle `cashless_app`, `set_config('app.operator_id', …, true)` en début de chaque transaction, traduction SQLSTATE → `ProblemCode` en problem+json (RFC 9457) sans message SQL brut, magasin d'idempotence applicatif (S21 : `Idempotency-Key`, `Idempotency-Replayed`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_KEY_IN_PROGRESS`), `X-Request-Id`, `Accept-Language`. Écrire le moteur d'écritures (§5.4) : un constructeur par type de transaction, seul appelant de `post_transaction`, calculs en `bigint` (§5.5) avec les 19 cas normatifs en tests TypeScript (identiques à `moteur_ecritures_reference.py`), refus des types non acceptés selon le statut de l'événement (§12.1). Rejouer `scenario_reference.json` par les constructeurs dans un test d'intégration : soldes exacts après la transaction 23 et en fin de clôture, second rejeu sans aucune nouvelle transaction. Types TypeScript générés depuis `openapi.yaml`, jamais écrits à la main.
- [x] /spec-kitty.plan Stack imposée : NestJS (TypeScript), PostgreSQL 17 minimum (AWS RDS en production), entiers `bigint` sans flottant. Contraintes : point d'écriture unique `post_transaction` (le rôle applicatif n'a aucun INSERT/UPDATE/DELETE sur `journal_transaction`, `posting`, `account_balance`) ; RLS forcée, `set_config` de portée transaction (jamais `SET` de session, pool de connexions) ; rôle applicatif avec `transaction_timeout = 60s`, `statement_timeout = 30s`, `idle_in_transaction_session_timeout = 10s` ; fonctions internes jamais rendues au rôle applicatif (§13.1) ; schéma de référence = point de départ des migrations, tests pgTAP toujours verts ; générateurs `gen_tests.py`/`gen_golden.py` modifiés, jamais les `.sql` générés. Environnement local : Windows 10, Node 22, PostgreSQL 17 sans pgTAP, pas de Docker. Latence cible serveur seul p95 ≤ 200 ms (§15).
- [x] /spec-kitty.tasks
- [x] spec-kitty next --agent claude --mission fondations-grand-livre-01M4AY8M
- [x] /spec-kitty.review --mission fondations-grand-livre-01M4AY8M
- [x] /spec-kitty.accept --mission fondations-grand-livre-01M4AY8M
- [x] spec-kitty merge --mission fondations-grand-livre-01M4AY8M
- [x] Revue post-merge (`mission-review-report.md` : PASS WITH NOTES) ; branche poussée, CI GitHub verte (08/10/2026)

## Mission 2 — Identité, rôles et double validation

- [x] /spec-kitty.specify Identité des personnes, rôles et double validation (SPECIFICATION §3.2, §10.3, §13.3, §14.2 S1 et S3, ADR-74). Tables `app_user` et `role_assignment` (rôles `PLATFORM_ADMIN`, `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER`, `MERCHANT_ADMIN`, `VENDOR`, `CUSTOMER`, avec portée plateforme, prestataire, organisateur, événement, commerçant) ; journal d'audit en ajout seul (`audit_log` : acteur, rôle, action, objet, avant, après, valideur, date, origine) pour toute action d'administration et toute action à deux. Authentification par JWT court et jeton de rafraîchissement ; le prestataire est toujours déduit de l'identité. Jeton d'approbation sur place au guichet (`X-Approval-Token` : 5 min, usage unique par `jti`, `act` = operationId, `act_hash` = SHA-256 de la requête canonique JCS, `sub` ≠ appelant, rôle vérifié ; `403 APPROVAL_REQUIRED` / `APPROVAL_INVALID`). Demande puis approbation au back-office (`approval_request` déjà au schéma, `decide_approval_request`, `202 Accepted`, `/approval-requests` liste, consultation, approbation avec exécution unique, refus avec note ; `409 APPROVAL_INVALID` sur `CL023`) ; un `approved_by` reçu dans un corps est ignoré. Le mécanisme d'exécution des actions est générique : chaque mission suivante y branche ses actions (`PAYOUT`, `WAIVE_SEQ_GAP`, etc.).
- [x] /spec-kitty.plan Serveur d'identité OIDC derrière une interface (authentification renforcée pour le jeton d'approbation), faux fournisseur pour les tests. Migrations avec RLS forcée, `operator_id` et tests pgTAP par contrainte (§14.2). Rôles et valideur ≠ auteur déjà imposés par la base pour plusieurs actions : ne pas affaiblir ces contraintes. Test de cloisonnement entre prestataires dès cette mission.
- [x] /spec-kitty.tasks
- [x] spec-kitty next --agent claude --mission identite-roles-double-validation-01M4DNDN
- [x] /spec-kitty.review --mission identite-roles-double-validation-01M4DNDN
- [x] /spec-kitty.accept --mission identite-roles-double-validation-01M4DNDN
- [x] spec-kitty merge --mission identite-roles-double-validation-01M4DNDN
- [x] Revue post-merge (`mission-review-report.md` : PASS WITH NOTES) ; PR #1 mergée sur `main` (09/10/2026)

## Mission 3 — Configuration, parties et événements

- [x] /spec-kitty.specify Configuration et organisation des parties (SPECIFICATION §3.1, §4, §5.6, §12.1, §10.4). Gestion des prestataires (plateforme), organisateurs, commerçants et participations (`INTERNAL`/`EXTERNAL`, commission, droit de place et `pitch_fee_mode`), points de vente, événements (devise, `funds_holder` obligatoire, `issuer`, `identity_mode`, `activation_modes`, réglages des terminaux bornés §9.8, `cash_refund_single_max`, `refund_deadline`, `sync_deadline_hours`, plafonds carte, remboursement vers un autre numéro). Cascade de configuration versionnée plateforme → prestataire → organisateur → événement → participation, bornée par le profil de législation (refus à l'enregistrement avec un message qui cite la règle). Contrats versionnés `PLATFORM_OPERATOR` et `OPERATOR_ORGANIZER`. Règles de frais `fee_rule` pour les quatre flux. Création des grands livres et des comptes à la demande (§5.2). Passage des statuts d'événement par `set_event_status` uniquement, avec affichage des conditions et de leur état. Ajouter au contrat `openapi.yaml` les endpoints back-office correspondants (§10.4), puis régénérer les types.
- [x] /spec-kitty.plan Les tâches de niveau plateforme (prestataires, profils de législation) utilisent un rôle de base distinct (§2.2). Valeurs par défaut provisoires (§17.2) codées et paramétrables, jamais présentées comme validées (plafonds Sénégal, TVA 18 %). Chaque transaction enregistre `config_version_id`, chaque ligne de frais `fee_rule_id`. Un contrat ne se modifie pas : nouvelle version.
- [x] /spec-kitty.tasks
- [x] spec-kitty next --agent claude --mission configuration-parties-evenements-01M4GCJ9
- [x] /spec-kitty.review --mission configuration-parties-evenements-01M4GCJ9
- [x] /spec-kitty.accept --mission configuration-parties-evenements-01M4GCJ9
- [x] spec-kitty merge --mission configuration-parties-evenements-01M4GCJ9

## Mission 4 — Bracelets NFC (format, clés, lots, cycle de vie)

Cadrage arrêté avec le porteur le 13/10/2026 (slug réel `bracelets-nfc-01M4TD3W`, branche `feat/bracelets-nfc`) : routes de
terminal et de festivalier servies derrière un port d'identité avec un faux pour les tests (l'enrôlement réel vient en
mission 5, les comptes festivaliers avec leur mission) ; bibliothèque Dart livrée et prouvée dès cette mission (SDK Dart
3.8 installé sur le poste) ; KMS : ports et faux seulement, adaptateur AWS réel plus tard ; caution payée à part en
espèces seulement.

Décisions de plan du 13/10/2026 : un seul code et quatre processus à droits séparés sur les clés ; rôles de base
distincts ; rôle `PERSONALIZER` ; mot de passe jamais transmis en clair, y compris au poste ; clé de données en mémoire
5 minutes au plus ; création et désactivation d'une clé du KMS par une commande d'administration séparée. Dettes de
sécurité à reprendre : mission 5 (identité réelle du terminal, requêtes signées), mission 10 (identité réelle du
festivalier), adaptateur AWS KMS (après OP-N11).

- [x] /spec-kitty.specify Bracelets NFC côté serveur et bibliothèques de format (SPECIFICATION §7, §6.1, §6.4, §14.2 S19, ADR-36, ADR-56, ADR-57, ADR-59). `packages/tag-format` en TypeScript et en Dart : format B 1.0 (28 octets, CRC-32/ISO-HDLC, majeur inconnu refusé), message de dérivation SP 800-108, AAD et chiffrement AES-256-GCM de PWD‖PACK, code de rattachement (10 caractères, alphabet de 32) ; les deux implémentations reproduisent `vecteurs_test_bracelet.py`. Ports KMS (GenerateMac, GenerateDataKey, Decrypt) avec faux pour les tests. Service des clés de bracelet (`POST /media/auth-keys`, un seul Decrypt de DEK, effacement en mémoire), service de personnalisation (enregistrement `token_hash`, UID, signature d'originalité et son empreinte, chiffré, lot), contrôle quotidien sur 100 bracelets, rotation de DEK, `tag_key` et `retire_dedicated_key` puis désactivation KMS. Lots (`media_batch` : kind, clé partagée ou dédiée, préchargement, caution, réutilisation, cycle de vie, inventaire). Codes de rattachement générés à la commande, empreinte seule conservée, association à la personnalisation, limites d'essais, demandes en attente pour un bracelet approvisionné (`media_claim`, confirmation au guichet). `POST /taps` (`register_tap`, effets de sécurité validés dans une transaction séparée), activation, consultation, caution et rendu, restitution, remplacement (la caution suit le bracelet), espèces dues (`refund_cash_due`), liste noire et `reinstate_media` à deux.
- [x] /spec-kitty.plan Rôles IAM séparés (§3.2, §13.2) : l'API publique n'a ni `kms:Decrypt` ni `kms:GenerateMac`. Les fonctions SQL des bracelets, lots et cautions font les règles ; NestJS les appelle sans les réimplémenter (§2.2). Mots de passe déchiffrés en mémoire seulement, puis effacés. Types Dart générés depuis `openapi.yaml`. Le code de lecture NFC du terminal n'est PAS dans cette mission.
- [x] /spec-kitty.tasks
- [x] spec-kitty next --agent claude --mission bracelets-nfc-01M4TD3W
- [x] /spec-kitty.review --mission bracelets-nfc-01M4TD3W
- [x] /spec-kitty.accept --mission bracelets-nfc-01M4TD3W
- [x] spec-kitty merge --mission bracelets-nfc-01M4TD3W

## Mission 5a — Identité et enrôlement des terminaux

Découpage du 16/10/2026 (décision du porteur au premier point de cadrage de la mission 5) : la mission 5 devient 5a
puis 5b. Les héritages de la mission 4 notés « mission 5 » dans `docs/POINTS_OUVERTS.md` et `docs/DECISIONS_ADR.md`
reviennent à la mission 5a. Slug réel : `identite-enrolement-terminaux-01M52R6H`, branche `feat/identite-enrolement-terminaux`.

> **Hérité de la mission 4 (bracelets-nfc)** : remplacer le faux d'identité du terminal par la vérification du jeton
> d'appareil, du mTLS et de la signature de chaque requête (OP-N42, ADR-88) ; le faux ne doit plus être câblé hors des
> tests. Le port `DeviceIdentityPort` est prêt : aucun contrôleur à modifier (`media-port-swap.spec.ts`).
>
> **Hérité aussi de la mission 4, OP-N59 (ADR-96, bloque la production)** : 77 fonctions SECURITY DEFINER fixent
> `search_path = public` sans `pg_temp` ; une table temporaire d'une session compromise y masque une table de la base.
> Les `tenant_of_*` qui alimentent `assert_tenant` (`post_transaction`, etc.) en font partie : contournement probable
> du cloisonnement entre prestataires (non démontré de bout en bout). Retirer `TEMPORARY` aux rôles applicatifs
> (`post-roles.sql`), ou passer toutes ces fonctions à `search_path = public, pg_temp` par migration, ou les deux ;
> test : table temporaire sans effet sur un `tenant_of_*`, ou création refusée à chaque rôle `cashless_*`. Mettre à
> jour la section 4 de `tests/tests_definer_trigger_writers.sql` (aujourd'hui : au plus 77).
>
> **Hérités aussi de la mission 4 (missions proposées par l'agent et confirmées par le porteur le 15/10/2026, ADR-101
> et ADR-99)** : **OP-N44** — les rôles `cashless_tagkeys`, `cashless_perso`, `cashless_tagcheck`, `cashless_keyadmin`
> héritent de `PUBLIC` l'`EXECUTE` des fonctions d'API du schéma de référence ; à traiter avec OP-N59 : faire que le
> générateur `gen_tests.py` n'exige plus `EXECUTE` pour `PUBLIC` et accorder les droits rôle par rôle
> (`post-roles.sql`) ; test : chaque rôle de processus des clés n'exécute que ses fonctions. **OP-N50** — `consume_tap`
> accepte encore une lecture qui a confirmé une demande de rattachement (`consume_tap_for_claim`, migration 0016) ;
> ce lot touche `consume_tap` pour le paiement : la faire refuser (migration ou générateur), test pgTAP à la place de
> la borne de `tests/tests_media_claim_tap.sql`. **OP-N54** — `api_idempotency.request_hash` est un SHA-256 sans clé
> qui contient le code imprimé ; le passer à une empreinte à clé (HMAC, secret hors de la base) ou en exclure les
> champs secrets ; test : l'empreinte ne se recalcule pas à partir du code seul.
>
> **Hérités aussi du correctif post-fusion n° 1 de la mission 4 (16/10/2026 ; confirmé par le
> porteur le 16/10/2026)** : **OP-N62** (ADR-102) — la personnalisation peut encore appeler
> `retire_dedicated_key` sans travail `RETIRE_KEY` en cours ; avec OP-N44, ne la rendre appelable
> que par une fonction qui exige un travail `RETIRE_KEY` `RUNNING` issu d'une demande exécutée ;
> test : appel sans travail refusé (mettre à jour `tests/tests_tag_key_job_approval.sql`). **Aussi
> OP-N62 (complément d'ADR-102)** — `enqueue_tag_key_job` accepte encore, une fois, une demande
> `APPROVED` dont `expires_at` est dépassé ; la faire refuser (`CL023`) ; test : inverser la
> section 6 de `tests/tests_tag_key_job_approval.sql`. **OP-N63** (ADR-105, bloque la production)
> — `cashless_app` peut réécrire `device.agreement_public_key`, clé sous laquelle le processus des
> clés chiffre le mot de passe d'un bracelet ; avec l'enrôlement réel, écrire cette clé à
> l'enrôlement seulement, par une fonction, et retirer `UPDATE (agreement_public_key)` à
> `cashless_app` ; test : réécriture directe refusée (mettre à jour la section 7 du même fichier).
> Ne pas rouvrir `INSERT` sur `tag_key_job`
> (travaux par `enqueue_tag_key_job` et `enqueue_tag_key_child_job` seulement, migration 0020).

- [x] /spec-kitty.specify Identité et enrôlement des terminaux (SPECIFICATION §8.1, §8.2, §10.3, §13.2, §13.4, §14.2 S5, `docs/sync_protocol.md` §3.1, ADR-69, ADR-88). Codes d'enrôlement à usage unique (portée événement, point de vente, mode ; empreinte, expiration ; `PAIRED_TPE` refusé `422 DEVICE_MODE_NOT_ALLOWED`), enrôlement avec clés ECDSA et ECDH P-256 (clé d'accord écrite à l'enrôlement seulement, OP-N63), unicité du `serial` parmi les terminaux non révoqués, jeton d'appareil et rafraîchissement (`device_refresh_token`), requêtes signées par la clé du terminal et mTLS (OP-N42 : faux d'identité retiré hors des tests), suspension et révocation, configuration servie (`DeviceConfig`, `config_id`, `terminal_settings`), battement de cœur. Dettes de sécurité héritées de la mission 4 : OP-N59, OP-N44, OP-N50, OP-N54, OP-N62, OP-N63 (voir ci-dessus).
> **Décisions du porteur au specify (19/10/2026)** : chaque requête de terminal porte ensemble le jeton lié, le
> mTLS et la signature de la requête (`DM-01M52R88ZPZEA0NXVSDY9PBXW5` ; SPEC §10.3 et `openapi.yaml` disent « l'un ou
> l'autre » : contradiction signalée, contrat à mettre à jour dans le sens le plus sûr) ; attestation vérifiée sur
> Android (Key Attestation) et iOS (App Attest) (`DM-01M59RR2KCM2NMTGNR62HXJD76`) ; OP-N50 levée en 5a
> (`DM-01M59RSS09TMMZ9Y7VKGAQGQQ0`) ; routes back-office des terminaux ajoutées au contrat ; suspension, réactivation
> et révocation à une personne ; attestation à l'enrôlement seulement ; autorité des terminaux derrière un port avec
> faux refusé en production.
>
> **Décisions du porteur au plan (19/10/2026)** : mTLS vérifié dans les processus Node (pas d'en-tête de répartiteur) ;
> limite iOS consignée (OP-N64, ADR-106) ; Android 12 minimum (clé d'accord matérielle et attestée) ; grâce de 60 s au
> rafraîchissement (OP-N65, ADR-108, réexaminée en mission 13) ; `serial` unique par prestataire (ADR-109).
> **Décision du porteur à l'analyse (19/10/2026)** : tout code d'enrôlement vise un événement (terminal toujours
> affecté ; réaffectation par révocation puis ré-enrôlement).
>
> **Bilan de WP18 (21/10/2026)** : OP-N42, OP-N44, OP-N50, OP-N54, OP-N59, OP-N62, OP-N63, OP-N70 et OP-N71 levés,
> chacun avec son test (`docs/POINTS_OUVERTS.md` §5) ; restent ouverts et hérités : OP-N64 (mission 12), OP-N65,
> OP-N67, OP-N72 (mission 13), OP-N68, OP-N69 (mission 7). Consigne de déploiement : purge des lignes
> `api_idempotency` antérieures à T + 720 h (OP-N54, OP-N71).

- [x] /spec-kitty.plan Requêtes des terminaux signées par la clé du Keystore ; aucune clé maître sur le terminal. Terminal `SUSPENDED` : envoie ses lots mais n'autorise plus ; `REVOKED` : refusé (`DEVICE_REVOKED`). Téléphone personnel : en ligne seulement. Les deux dettes qui bloquent la production (OP-N59, OP-N63) sont levées avec leur test.
- [x] /spec-kitty.tasks (18 lots, 87 sous-tâches, 19/10/2026)
- [ ] spec-kitty next --agent claude --mission identite-enrolement-terminaux-01M52R6H
- [ ] /spec-kitty.review --mission identite-enrolement-terminaux-01M52R6H
- [ ] /spec-kitty.accept --mission identite-enrolement-terminaux-01M52R6H
- [ ] spec-kitty merge --mission identite-enrolement-terminaux-01M52R6H

## Mission 5b — Terminaux et paiement en ligne

Après la fusion de la mission 5a. Mission déjà créée avant le découpage : slug réel `terminaux-paiement-en-ligne-01M52QB9`,
branche `feat/terminaux-paiement-en-ligne` (à remettre sur `main` après la fusion de 5a) ; décision de découpage
consignée dans son dossier `decisions/`. Le schéma de référence n'a ni tables (S2, S18) ni routes de contrat pour les
vendeurs et le catalogue : la mission les ajoute.

> **Hérité de la mission 5a, OP-N74 (ADR-120 ; décision du porteur du 21/10/2026)** : l'enrôlement d'un terminal ne
> relit pas l'état de l'événement ni du point de vente du code. Faire refuser par `create_device_enrollment_code` et
> `enroll_device` un événement `CLOSED` (et les états de clôture jugés bloquants) et un point de vente supprimé ; test
> pgTAP par refus, aucune ligne écrite ; puis lever OP-N74.

> **Cadrage du 22/10/2026** (7 décisions du porteur, `decisions/`) : branche remise sur `main` après la fusion de 5a
> (PR #4) et du correctif SC-007 (PR #5). PIN vérifié par le serveur, session de vendeur liée au terminal, attribution
> par le serveur ; PIN de 6 chiffres, blocage dur après 5 échecs ; annulation par le seul vendeur de la vente dans la
> fenêtre ; prix des lignes contre la configuration servie ; OP-N74 : dès `CLOSING` sauf `TOPUP_DESK`. Le PIN hors
> ligne revient à la mission 7.

- [x] /spec-kitty.specify Encaissement en ligne (SPECIFICATION §8.1 à §8.3, §6.3, §7.6, §9.8, §14.2 S2, S18, S24). Vendeurs avec code PIN (argon2id), vente attribuée au vendeur. Paiement en un seul aller-retour (`POST /payments` : `register_tap`, `post_transaction`, `consume_tap` dans la même transaction SQL), parcours en deux temps avec `tap_id`, refus `WALLET_BLOCKED`, annulation dans la fenêtre du terminal, numérotation `<serial>:<seq>`. Catalogue par point de vente (catégories, articles TTC, taux par article, libellés FR/EN) et `sale_line` copiée dans la transaction de la vente. Paiement par QR commerçant et QR client (60 s, nonce haché, toujours en ligne). Identification au guichet (`kyc_verification`, révocation à deux).
- [ ] /spec-kitty.plan Latence serveur seul p95 ≤ 200 ms, p99 ≤ 500 ms ; un seul aller-retour pour le paiement. Téléphone personnel : en ligne seulement. iOS : QR uniquement.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission terminaux-paiement-en-ligne-01M52QB9
- [ ] /spec-kitty.review --mission terminaux-paiement-en-ligne-01M52QB9
- [ ] /spec-kitty.accept --mission terminaux-paiement-en-ligne-01M52QB9
- [ ] spec-kitty merge --mission terminaux-paiement-en-ligne-01M52QB9

> **Décision du porteur du 26/10/2026 (ADR-126, relecture WP09)** : un PIN de vendeur n'entre dans l'empreinte
> d'idempotence (`request_hash`) que sous un dérivé argon2 ; corrigé au cycle 2 de WP09, aucune dette héritée.

> **Livré par la mission 5b (état au 26/10/2026, lot WP14 de preuves et de consignation)** : vendeurs et sessions
> (PIN argon2id, 5 échecs bloquent sur tous les terminaux), catalogue versionné et lignes de vente, paiement par
> bracelet (un aller-retour, `tap_id`) et par QR client, QR commerçant et QR client côté festivalier, annulation
> (vendeur dans la fenêtre, `SUPERVISOR` sur place, demande à deux au back-office), enrôlement refusé sur un
> événement clos (**OP-N74 levé**, migration 0035). Preuves de bout en bout : `payment-journey`, `payment-isolation`,
> `payment-secrets`, `payment-latency` (p95 ≤ 200 ms, p99 ≤ 500 ms, étape CI propre) et `payment-concurrency`
> (`apps/api/test/integration/end-to-end/`). Dettes ouvertes héritées : OP-N76 (mission 11), OP-N77 et OP-N78 et
> OP-N80 (mission 13), OP-N79 (mission 11), OP-N43 complété (mission 10).

## Mission 6 — Recharges, caisses et PSP

> **Hérité de la mission 4 (bracelets-nfc)** : créer le compte de caisse `A-CAISSE-<n° de série>` à l'ouverture d'une
> session (ou adapter `counter-access.ts`) : sans lui, caution en espèces et rendu des espèces dues répondent `409`
> (décision n° 10, ADR-89, OP-N49) ; servir `cash_session_id` dans `refundCashDue` et `releaseMedia` ; appeler
> `DepositService.takeDueDeposit` après chaque crédit payé, dans une transaction distincte.

- [ ] /spec-kitty.specify Encaissement de l'argent réel (SPECIFICATION §8.5, §11.1, §11.2, §5.3, §14.2 S14, S20, S26, S26b, ADR-63, ADR-70, ADR-72, ADR-77). Sessions de caisse (`cash_session` : ouverture, comptage, fermeture `CASH_CLOSE` avec écart au payeur du contrat, anomalie `CASH_DIFF`, dépôt `CASH_DEPOSIT`). Recharge en espèces (`TOPUP_CASH`, marge de recharge `wallet_topup_headroom`, découpage vers `L-ESP-A-RENDRE` hors ligne). Prise de caution due après chaque crédit (`take_deposit`, transaction distincte). Configurations PSP par organisateur et par moyen (S26, activation à deux, au plus une par défaut) et choix par événement (S26b, titulaire = détenteur des fonds, sinon `PSP_NOT_CONFIGURED`). Interface commune d'adaptateur PSP (initier, vérifier un webhook, interroger un statut, lire un relevé) ; adaptateurs Wave, Orange Money, PayDunya, Stripe, avec faux PSP tant que les accès de test manquent. Demande de recharge (`POST /topups/psp`), webhook signé stocké brut puis traité de façon idempotente (`TOPUP` et frais PSP au payeur `psp_fee_bearer`), interrogation planifiée puis `EXPIRED`, anomalies `PSP_MISMATCH` et `PSP_TOPUP_OVER_LIMIT`. Carte : 3-D Secure obligatoire, plafond par carte et par jour (`422 CARD_DAILY_LIMIT`), anomalie `CARD_VELOCITY`, contestations (`CHARGEBACK`, portefeuille bloqué, payeur selon `chargeback_bearer`).
- [ ] /spec-kitty.plan Secrets PSP dans AWS Secrets Manager, rattachés au détenteur des fonds, jamais partagés. Webhook inconnu ou invalide conservé et signalé, jamais ignoré. Clé d'idempotence des webhooks `<psp>:<id>`. Les taux PSP sont des `fee_rule` par configuration. Adaptateurs réels codés derrière l'interface, activés seulement après vérification des accès de test (action 11 de POINTS_OUVERTS).
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission recharges-caisses-psp
- [ ] /spec-kitty.review --mission recharges-caisses-psp
- [ ] /spec-kitty.accept --mission recharges-caisses-psp
- [ ] spec-kitty merge --mission recharges-caisses-psp

## Mission 7 — Hors ligne (snapshots et lots)

> **Hérité de la mission 4 (bracelets-nfc)** : deux faiblesses du kit, antérieures à la mission 4, consignées sans
> changement de comportement (relecture du lot 20, ADR-94). **OP-N57** : `cashless_app` choisit la version d'un
> snapshot et `check_offline_snapshot` n'exige qu'une version croissante ; une version très grande plantée bloque les
> snapshots suivants du grand livre (déni de service hors ligne). Faire inscrire les snapshots par une fonction qui
> calcule elle-même la version (dernière + 1) et retirer l'`INSERT` direct (ou le borner par une politique
> restrictive) ; test : version choisie par l'appelant refusée, snapshot suivant toujours possible. **OP-N58** :
> `log_offline_policy` écrit `offline_policy_history` aux droits de l'appelant ; passer cette fonction en SECURITY
> DEFINER (`search_path` fixé, comme `log_media_status` en migration 0018) et retirer `INSERT` à `cashless_app` ;
> test : ligne insérée directement refusée, historique toujours écrit par une modification de politique. Le test
> `tests/tests_definer_trigger_writers.sql` fige les droits actuels : le mettre à jour en levant ces deux points.
> **Les deux bloquent la production** (OP-N58 classé « Oui » par le porteur le 15/10/2026, comme OP-N57 : une version
> plantée en avance est un déni de service) : à lever avant toute mise en production.
>
> **Hérité aussi de la mission 4, OP-N41 (ADR-88 ; mission proposée par l'agent le 15/10/2026,
> confirmée par le porteur le même jour, ADR-101 ; bloque la production)** : le service de clés des
> bracelets n'existe qu'en faux
> (`apps/api/src/kms/fake-kms.ts`). Avec l'adaptateur KMS de la signature des snapshots, écrire l'adaptateur AWS des
> ports `MacPort`, `DataKeyPort`, `DecryptPort`, `KeyAdminPort`, un rôle IAM par processus (SPEC §3.2), après la
> région (OP-N11) ; le faux reste refusé en production (`production-guard.spec.ts`).

> **Hérité de la mission 5a, OP-N68 (ADR-111 ; décision du porteur du 20/10/2026)** : une fonction créée à la main,
> hors de `migrate.ts`, reste exécutable par `PUBLIC` jusqu'au rejeu de `post-roles.sql` (la mission 5a rejoue les
> droits dans la transaction des migrations). Poser le droit par défaut global `ALTER DEFAULT PRIVILEGES FOR ROLE
> <propriétaire> REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` et adapter les suites pgTAP qui en dépendent (pgTAP installé
> avec des droits explicites, ou droit rendu dans chaque suite) ; inverser la première assertion de la §4 de
> `tests_execute_grants.sql` ; test : fonction créée à la main non exécutable par `PUBLIC`.

> **Hérité de la mission 5a, OP-N69 (ADR-112 ; décision du porteur du 20/10/2026)** : `cashless_app` modifie encore
> directement `device.next_seq_floor`, `last_seen_at`, `last_snapshot_version`, l'affectation (`event_id`, `pos_id`) et
> les réglages (`app_mode`, `nfc_enabled`, `station_name`, `personal_phone`). Faire passer ces écritures par des
> fonctions de la base (plancher qui ne descend jamais, affectation dans le périmètre, présence à l'heure de la base) et
> retirer les `UPDATE` directs ; mettre à jour la liste exacte de `tests_device_rights.sql` §1 ; test : écriture
> directe refusée depuis `cashless_app`. Inclure `personal_phone` et `app_mode` (contournement de la règle du
> téléphone personnel, revue post-fusion de la 5a). La mission 5b retire déjà l'`UPDATE` direct de `event_id` et
> `pos_id` (aucun usage dans l'API ; contournement d'OP-N74) : l'affectation par fonction de la base reste à faire si
> une réaffectation sans ré-enrôlement est voulue.
>
> **Hérité de la mission 5b (décision du porteur du 22/10/2026)** : le PIN des vendeurs est vérifié par le serveur
> (session de vendeur liée au terminal, empreinte argon2id avec secret hors base, jamais servie au terminal). Le hors
> ligne doit trancher comment un vendeur se connecte sans réseau sans envoyer d'empreinte de PIN au terminal (ou en
> nommer la dette).

> **Hérité de la mission 5a, OP-N75 (ADR-114 ; décision du porteur du 21/10/2026)** : les purges des nonces et des
> essais d'enrôlement sont exécutées par `cashless_app`. Créer un rôle et une connexion de maintenance dédiés, retirer
> `EXECUTE` à `cashless_app` (`post-roles.sql`, `tests_execute_grants.sql`), garder `tests_device_purge_window.sql`.

> **Hérité de la mission 5a, OP-N73 (ADR-119 ; décision du porteur du 21/10/2026 ; bloque la production)** :
> l'autorité des terminaux (`DeviceCaPort`) et le signataire des jetons d'appareil (`TokenSignerPort`) n'ont que des
> faux (`fake-device-ca.ts`, `fake-token-signer.ts`). Avec l'adaptateur KMS d'OP-N41, écrire leurs adaptateurs réels
> (clés hors du code et de l'environnement, SPEC §13.2) et lever la garde de production pour ces deux ports seulement
> (`device-latency.spec.ts`, `production-guard.spec.ts`).
>
> **Hérité de la mission 5b (ADR-128 ; décision du porteur du 26/10/2026)** : le registre des numéros des terminaux
> est alimenté en ligne depuis la mission 5b. Reprendre telle quelle la forme de `content_sha256` (RFC 8785 de
> `{seq, type, occurred_at, amount, currency, tap, lines}`, champs absents omis ; vecteurs de
> `device-seq-registry.spec.ts`) ; traiter un `seq` au-delà de 2^53 ; un corps en ligne qui n'était pas un objet JSON
> a laissé un trou de numéro sans ligne au registre (refus `400`), à lever par la procédure des trous.
>
> **Sonde héritée de la mission 5b (relecture WP11 cycle 2, 26/10/2026)** : écrire une sonde qui pose un numéro hors
> idempotence puis présente un paiement falsifié (consigné comme anomalie), avant d'alimenter le registre par les
> lots hors ligne ; non écrite par la mission 5b (aucune dette de sécurité : le chemin en ligne refuse déjà `CL002`).

- [ ] /spec-kitty.specify Fonctionnement hors ligne côté serveur (SPECIFICATION §9.1 à §9.6, `docs/sync_protocol.md` normatif, §14.1 S4 à S11). Politique hors ligne (`offline_policy` par organisateur, événement, terminal ; plafonds du prestataire ; `effective_offline_policy` ; affichage du risque maximal). Snapshots signés (en-tête JCS, ECDSA P-256 par KMS, `FULL`/`DELTA`, version croissante, nouvelle version en 60 s si changement et en 5 s après un blocage, mots de passe chiffrés par une clé de contenu enveloppée ECDH-ES P-256 par terminal, aucun envoi à un terminal révoqué). Lots (`POST /offline-batches` : numéros continus, 500 opérations et 1 Mio maximum, un lot en vol, signé et chaîné, traitement opération par opération dans l'ordre des seq, statuts `ACCEPTED`, `DUPLICATE`, `ACCEPTED_WITH_SHORTFALL`, `REJECTED`), registre des numéros, trous `SEQ_GAP` et levée à deux (`waiveSeqGap`), borne `CL021`, lot abandonné après 15 min. Conflits (§9.6 : part non couverte en `S-ATTENTE`, anomalies `OFFLINE_SHORTFALL`, `NON_COMPLIANT_OPERATION` avec porteur de la perte selon `provided_by`, `CLOCK_SKEW`, `SIGNATURE_MISMATCH`), contrôles de conformité sur la configuration détenue (`policy_in_force`), synchronisations tardives (`SYNC_DEADLINE_PASSED`, `LATE_OFFLINE_SYNC`). Import du journal d'un terminal révoqué (à deux).
- [ ] /spec-kitty.plan Les fonctions S6 à S13 du schéma de référence existent avec leurs tests : les appeler, ne pas les réécrire, les compléter par migration sans affaiblir les contrôles. Algorithme de signature dans l'en-tête (OP-N13 : vérifier Ed25519 dans KMS, défaut ECDSA P-256). Tests minimaux de `sync_protocol.md` §13 côté serveur (rejeu de lots, panne au milieu d'un lot, horloges faussées, bracelet bloqué pendant un isolement).
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission hors-ligne-snapshots-lots
- [ ] /spec-kitty.review --mission hors-ligne-snapshots-lots
- [ ] /spec-kitty.accept --mission hors-ligne-snapshots-lots
- [ ] spec-kitty merge --mission hors-ligne-snapshots-lots

## Mission 8 — Passerelle locale

- [ ] /spec-kitty.specify Passerelle locale de site (SPECIFICATION §9.7, `docs/sync_protocol.md` §8 et §9, §14.1 S12 et S13, ADR-52). `apps/gateway` réutilise les modules de l'API, avec sa base PostgreSQL locale. Flux de réplication des soldes et des mots de passe de l'événement ; bascule d'autorité de débit par les seules fonctions du schéma (`grant_edge_authority`, `ack_edge_handover`, `fail_edge_grant`, `request_edge_release`, `complete_edge_release`, `force_central_authority` à deux) ; `X-Authority-Epoch` et arrêt des débits sur époque supérieure (`STALE_AUTHORITY_EPOCH`) ; refus des débits centraux pendant `EDGE` (`DEBIT_AUTHORITY_EDGE`). Opérations servies par la passerelle (`x-edge-available` : ventes, annulations, recharges espèces, activation sans frais sur solde, caution en espèces) et refusées (prélèvements sur solde, remboursements, restitutions, QR). Retour : vidage de la file `POST /edge/sync-batches` (`EDGE_SYNC`, `origin_key`, `origin_occurred_at`, `origin_mode`), chaîne calculée par le central, anomalie `EDGE_REPLAY_FAILED`. Snapshots signés par la clé propre de la passerelle. Seconde passerelle `STANDBY` qui ne débite pas sans promotion.
- [ ] /spec-kitty.plan NestJS empaqueté en Docker (à prévoir pour le site ; Docker absent de la machine de développement actuelle). mTLS avec certificat propre, disque chiffré, révocation à distance, pas de clé maître. L'application n'appelle jamais `set_debit_authority`. Ordre de verrouillage : verrous consultatifs puis lignes. Tests de bascule sous charge (`sync_protocol.md` §13).
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission passerelle-locale
- [ ] /spec-kitty.review --mission passerelle-locale
- [ ] /spec-kitty.accept --mission passerelle-locale
- [ ] spec-kitty merge --mission passerelle-locale

## Mission 9 — Remboursements, versements et clôture

> **Hérité de la mission 4 (bracelets-nfc)** : enchaînement du guichet de retour (`releaseMedia` avec `settle_balance`,
> `refund_deposit_by`) — **servi par cette mission**, décision du porteur du 15/10/2026 (OP-N51, ADR-91 acceptée) ; le
> contrat `openapi.yaml` reste tel quel ; le refus provisoire `422` (`release.no_chaining`) disparaît avec cette mission.
>
> **Hérité aussi de la mission 4, OP-N55 (ADR-100)** : `replace_media` ne fait pas suivre au bracelet neuf les espèces
> dues (anomalies `CASH_TOPUP_OVER_LIMIT`) de l'ancien, et le rendu est refusé sur un bracelet `REPLACED` ; la dette
> reste au grand livre (`L-ESP-A-RENDRE`). Faire suivre les anomalies au remplacement (migration) ou servir un rendu au
> back-office sur décision de deux personnes ; test : espèces dues d'un bracelet remplacé rendues une fois, et une seule.

- [ ] /spec-kitty.specify Remboursements, versements, rapprochements et clôture d'un événement (SPECIFICATION §8.5, §11.3, §11.4, §12, §13.7, §14.2 S16 et S22, ADR-49, ADR-53, ADR-67, ADR-73, ADR-75, ADR-76). Demandes de remboursement (`refund_request` : Wave, Orange Money, virement ; approbation à deux qui écrit `WALLET_REFUND` ; confirmation ou échec avec `REVERSAL` ; autre numéro avec code au nouveau numéro, accord ou attente du numéro vérifié, vérification d'identité au-delà du seuil) ; remboursement en espèces au guichet avec jeton d'approbation au-delà du seuil ; guichet de retour dans l'ordre imposé (§7.9). Versements manuels (droit net `party_position`, lot préparé et validé à deux, `PAYOUT_INITIATED`, export CSV, `PAYOUT_CONFIRMED`/`FAILED`, alerte à 48 h). Rapprochement des relevés (`external_statement_line`). Clôture : droits de place selon `pitch_fee_mode`, transfert de dette, frais du prestataire et redevance (régularisation `NET_OF_REFUNDS`), casse partagée, cautions acquises, expiration des crédits offerts, `set_event_status` jusqu'à `CLOSED`, clôture avec soldes restants, `lock_settled_ledger`. Réclamations tardives (`BREAKAGE_REVERSAL`, `ADJUSTMENT`, `WALLET_REFUND`, `LATE_CHARGEBACK`) à deux, bornées par `check_late_claim`. Scellement toutes les 5 min avec copie S3 Object Lock et vérification quotidienne, surveillance des transactions de plus de 60 s, contrôles permanents §12.2 avec alertes. Relevés (commerçant, festivalier, organisateur, prestataire, plateforme) et export comptable par `account_mapping` configurable.
- [ ] /spec-kitty.plan Ordre de clôture de référence du scénario (§12.1). Les tâches d'exploitation (scellement, exports) utilisent un rôle distinct qui n'écrit pas au grand livre. Correspondance SYSCOHADA indicative, à faire valider (OP-N3) : configurable, jamais codée en dur. Copie des scellements sous un compte AWS distinct. Scellement : la tâche planifiée et la copie hors de la base (S3 Object Lock, compte distinct) couvrent aussi les scellements du journal d'audit (`audit_seal`, fonctions de scellement et de vérification livrées par la mission 2), avec vérification quotidienne de leur chaîne.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission remboursements-versements-cloture
- [ ] /spec-kitty.review --mission remboursements-versements-cloture
- [ ] /spec-kitty.accept --mission remboursements-versements-cloture
- [ ] spec-kitty merge --mission remboursements-versements-cloture

## Mission 10 — App festivalier

> **Hérité de la mission 4 (bracelets-nfc)** : remplacer le faux d'identité du festivalier par un vrai jeton de compte
> (OP-N43, ADR-88) ; servir `listMyMedia` et `reportMyMediaLost` (non servies par la mission 4) ; le rattachement par
> code, la demande en attente, l'activation depuis l'app (`SELF_APP`) et la consultation anonyme réduite sont déjà
> servis côté serveur (ADR-90).
>
> **Hérité aussi de la mission 4, OP-N47 (ADR-87, ADR-104 ; mission proposée par l'agent le
> 16/10/2026, à confirmer par le porteur)** : aucune procédure de rotation de `CLAIM_CODE_HMAC_KEY`
> ; changer le secret invalide toutes les empreintes des codes imprimés et des codes de
> confirmation. Écrire et tester une rotation : nouveau secret actif, ancien accepté en lecture
> pendant une période bornée (double empreinte avec version du secret), extinction des anciennes
> empreintes, retrait de l'ancien secret ; test : un code émis sous l'ancien secret se rattache
> pendant la période et plus après, aucun code conservé en clair.
>
> **Hérité de la mission 5b (décisions du porteur au plan, 22/10/2026)** : (1) **identification au guichet**
> (SPECIFICATION §6.3, S24, `createKycVerification`, `revokeKycVerification`), reportée de la 5b : la base n'avait ni
> numéro vérifié du festivalier ni lien agent-festivalier. L'écrire par une fonction de la base qui exige un compte au
> numéro vérifié et refuse un agent titulaire du portefeuille (lien personne ↔ compte festivalier à créer) ; révocation
> par la demande d'approbation `KYC_REVOCATION` à deux personnes (contrat ; §6.3 dit « un administrateur » :
> contradiction à garder signalée) ; le registre des actions n'accepte qu'un rôle par action, le contrat en demande
> deux (`OPERATOR_ADMIN` ou `ORGANIZER_ADMIN`). La 5b a retiré à `cashless_app` les écritures directes dans
> `kyc_verification`. (2) **côté festivalier du QR** (`payPaymentRequest`, `createCustomerQrToken`) servi par la 5b
> derrière le port d'identité du festivalier : il devient utilisable en production quand l'identité réelle remplace le
> faux (OP-N43 complété).

- [ ] /spec-kitty.specify App festivalier Flutter, Android et iOS (SPECIFICATION §8.5 « App festivalier », §7.8, §8.3, §14.2 S17, ADR-42, ADR-57, ADR-64, ADR-66). Côté serveur : comptes par numéro E.164 vérifié par code à usage unique (`customer_identity`, `otp_challenge`), port `OtpSender` avec chaîne WhatsApp puis SMS principal puis SMS de repli (bascules à 10 s et 20 s, faux fournisseurs), limites (`429 OTP_RATE_LIMITED`), `/me` et ses portefeuilles et historiques. Côté app : connexion, solde et historique, recharge en ligne, paiement par QR commerçant (confirmation par PIN ou biométrie) et QR client à usage unique (60 s, jamais préchargé), rattachement par QR ou code imprimé (demande en attente avec code de confirmation si le bracelet contient de l'argent), déclaration de perte (suspension immédiate, proposition de payer par QR), demande de remboursement, consultation anonyme du solde par code (`POST /public/balance-lookups`, lecture seule). L'app ne lit jamais la puce. Interfaces en français et en anglais.
- [ ] /spec-kitty.plan Flutter, types Dart générés depuis `openapi.yaml`. Pas de connexion Google ou Apple. Pas de portail web. Fournisseurs OTP réels à choisir sur devis (action 10 de POINTS_OUVERTS) : adaptateurs derrière le port seulement.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission app-festivalier
- [ ] /spec-kitty.review --mission app-festivalier
- [ ] /spec-kitty.accept --mission app-festivalier
- [ ] spec-kitty merge --mission app-festivalier

## Mission 11 — Back-office web

> **Hérité de la mission 4 (bracelets-nfc)** : la décision d'une demande d'approbation (`decide_approval_request`)
> croit le valideur que lui passe l'API ; une session de l'API compromise peut décider au nom d'un vrai superviseur
> (OP-N56, ADR-94). Avec le serveur d'identité réel, n'enregistrer une décision qu'avec une preuve que l'API ne peut
> pas fabriquer seule (jeton d'approbation signé d'ADR-74, ou signature de la décision par le valideur), vérifiée et
> conservée avec la décision ; test : décision sans preuve, ou avec la preuve d'une autre personne ou d'une autre
> demande → refusée. Ne pas rouvrir les droits de `cashless_app` sur les historiques, les règles de passage,
> `media_assignment` et `device_config_served`, et garder `log_media_status` / `log_batch_status` en SECURITY DEFINER
> (migration 0018).
>
> **Hérité de la mission 5b, OP-N76 (ADR-121 ; décision du porteur du 22/10/2026)** : le PIN des vendeurs est vérifié
> dans l'API ; la base rend l'empreinte (`begin_vendor_pin_check`) et ouvre la session sur la transaction de l'API
> (`open_vendor_session`). À lever avec OP-N56 : processus séparé, seul détenteur de `VENDOR_PIN_SECRET` et d'un rôle
> de base qui seul exécute ces deux fonctions (ou preuve infalsifiable par l'API) ; test : `cashless_app` n'exécute
> plus ces fonctions, une session sans vérification du processus dédié est refusée.
>
> **Hérité de la mission 5b, OP-N79 (ADR-127 ; durcissement reporté par le porteur le 26/10/2026)** : faire entrer
> `vendor_id` dans la clé composite référencée par `sale_attribution` (`(vendor_session_id, vendor_id)`), pour que le
> schéma refuse une vente attribuée à un autre vendeur que celui de sa session ; test pgTAP d'une attribution
> incohérente refusée, puis lever le point.
>
> **Hérité aussi de la mission 4, OP-N60 (ADR-97, bloque la production)** : `cashless_app` a `INSERT` et `UPDATE` sur
> toutes les colonnes de `media_batch` (lot inséré directement en `ACTIVE` ou `CLOSED`, clôture sans `close_batch`,
> quantité, index de clé) et `UPDATE (status)` de `media` sans motif. La création passe aujourd'hui par un `INSERT`
> direct (`batches.service.ts:68`). Créer les lots par une fonction qui impose `ORDERED` (ou politique restrictive),
> borner `UPDATE` de `media_batch`, faire de `media_set_status` le seul chemin du statut d'un bracelet ; test depuis
> `cashless_app` : ces écritures directes refusées. Mettre à jour la section 4 de `tests/tests_definer_trigger_writers.sql`.

- [ ] /spec-kitty.specify Back-office Next.js (SPECIFICATION §1.2, §3.2, §7.7, §9.3, §11, §12, §15 « Lecture NFC »). Interfaces plateforme (prestataires, contrats, redevance, supervision), prestataire (organisateurs, contrats, index de clés, plafonds maximaux, profils de législation, configurations PSP), organisateur (événements, commerçants, catalogues, terminaux et codes d'enrôlement, politique hors ligne avec affichage du risque maximal, clôture avec liste des conditions et leur état, versements, relevés, exports, relevé des soldes restants), commerçant (ventes par article et par taux, relevés, vendeurs, catalogue si autorisé). Demandes d'approbation : liste, consultation, approbation, refus. Inventaire des lots, anomalies, remboursements. Liste des modèles de téléphone avec leur niveau NFC et signalement des terminaux « tolérés » ou non testés. Interfaces en français et en anglais.
- [ ] /spec-kitty.plan React / Next.js, types TypeScript générés depuis `openapi.yaml`. Les contrôles de clôture non calculables par la base (caisses comptées, PSP rapprochés, terminaux remontés) sont faits avant l'appel. Cloisonnement : un utilisateur d'un prestataire ne voit rien d'un autre.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission back-office
- [ ] /spec-kitty.review --mission back-office
- [ ] /spec-kitty.accept --mission back-office
- [ ] spec-kitty merge --mission back-office

## Mission 12 — App terminal

> **Condition préalable** : validation de la puce sur de vrais bracelets et campagne de mesure NFC faites
> (actions 1 et 2 de `POINTS_OUVERTS.md` §7, ADR-39). Ne pas lancer cette mission avant.
>
> **Hérité de la mission 4, OP-N46 (ADR-85 ; mission confirmée par le porteur le 15/10/2026,
> ADR-101)** : à la personnalisation, la signature d'originalité NXP n'est vérifiée que par le poste ; le serveur n'en
> garde que l'empreinte. Avec la clé publique NXP et les signatures réelles issues de la validation de la puce, faire
> vérifier aussi la signature par le serveur (vecteurs dans le kit), décision avec l'auditeur sécurité (ADR-44).
>
> **Hérité aussi de la mission 4, contrat de `activateMedia` et `replaceMedia` (ADR-103)** : la
> lecture du bracelet est embarquée dans la requête (`tap` pour l'activation, `new_media_tap` pour
> le bracelet neuf d'un remplacement, schéma `TapInput`) ; `tap_id` et `new_media_tap_id` sont
> dépréciés et refusés seuls (`422`). Raison : un bracelet jamais activé n'a pas de `tap_id`
> (`register_tap` répond `NOT_ACTIVATED` sans enregistrer de lecture), le contrat de départ
> contredisait le schéma. L'app envoie donc la lecture complète au guichet, pas un identifiant de
> lecture.
>
> **Hérité de la mission 5a, OP-N64 (ADR-106 ; décision du porteur du 19/10/2026)** : sur iOS, App Attest atteste sa
> propre clé, pas la clé de signature ECDSA du terminal ; la mission 5a lie les clés publiques à l'instance attestée
> par le défi d'enrôlement et borne iOS au QR (`POST /media/auth-keys` refusé à un terminal iOS). Réexaminer : signer
> les requêtes iOS par assertion App Attest (ou preuve équivalente), puis lever la limite.
> L'app implémente aussi le profil de signature des requêtes (RFC 9421 restreint), le défi d'enrôlement et le mTLS de
> la mission 5a (`kitty-specs/identite-enrolement-terminaux-01M52R6H/contracts/`).
> Pour lever OP-N64 (relecture de WP11 de la mission 5a) : le port d'attestation iOS doit renvoyer le `keyId` App
> Attest (credentialId) et le serveur le stocker (vérification des assertions) ; l'app passe `iosClientDataHash` tel
> quel à `attestKey`.
> Android 12 minimum (décision du porteur du 19/10/2026) : à confronter au parc visé et au banc NFC. Faisabilité à
> vérifier : mTLS en Flutter avec une clé Keystore ou Secure Enclave non exportable (canal natif).

- [ ] /spec-kitty.specify App terminal Flutter (SPECIFICATION §7.6, §8.1, §8.2, §9.3 à §9.5, `docs/sync_protocol.md`, résultats du banc `tools/nfc-bench`). Modes `CATALOG_POS`, `KEYPAD_TPE`, `TOPUP_DESK` ; enrôlement par QR, clés ECDSA et ECDH dans l'Android Keystore (StrongBox si disponible) ou la Secure Enclave ; connexion des vendeurs par PIN ; épinglage d'écran. Lecture NFC Android en mode lecteur (`NfcA.transceive`) : page 4, `READ_SIG` à chaque passage, PWD/PACK depuis le snapshot ou `/media/auth-keys`, `PWD_AUTH`, `FAST_READ`, CRC, `INCR_CNT`/`READ_CNT` sur le compteur 2, effacement des mots de passe. Paiement en ligne en un aller-retour avec repli hors ligne après 3 s ; règle d'autorisation hors ligne dans l'ordre imposé (§9.3), journal SQLCipher (WAL, `synchronous = FULL`, fsync avant succès), compteur `seq` commun, snapshots vérifiés et deltas, lots signés et chaînés, exposition par bracelet et par terminal, bascule vers la passerelle. QR (iOS : QR uniquement). Guichet : recharges, cautions, restitutions, remplacements, remboursements, jeton d'approbation de la seconde personne. Vecteurs du format B produits et vérifiés par l'app.
- [ ] /spec-kitty.plan Flutter, Android et iOS ; `packages/tag-format` en Dart ; réglages de lecture par modèle de téléphone issus du banc. Aucune clé maître sur le terminal. Hors ligne jamais pour : QR, recharge PSP, remboursement, activation, caution, restitution, remplacement. Un refus en ligne est définitif. Latence NFC p95 ≤ 300 ms.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission app-terminal
- [ ] /spec-kitty.review --mission app-terminal
- [ ] /spec-kitty.accept --mission app-terminal
- [ ] spec-kitty merge --mission app-terminal

## Mission 13 — Recette V1

> **Hérité de la mission 5a, OP-N65 (ADR-108 ; décision du porteur du 19/10/2026)** : au rafraîchissement d'un jeton
> d'appareil, une représentation du jeton consommé est tolérée 60 s pour le même terminal. Mesurer en recette les
> pertes de réponse réelles ; si la grâce ne sert pas, revenir au mode strict et lever la limite.
>
> **Hérité de la mission 5a, OP-N67 (ADR-110 ; décision du porteur du 19/10/2026)** : l'attestation Android lit
> `attestationApplicationId` dans `softwareEnforced` (seul champ). Relever sur les appareils cibles où ce champ est
> placé ; s'il est matériel, revenir à la lecture stricte, sinon décider d'une preuve d'intégrité de l'app
> complémentaire (Play Integrity) ou garder la limite. Essayer aussi `@peculiar/asn1-android` 2.10.0 sur de vrais
> appareils (balise KeyDescription inconnue : refus fermé probable, non vérifié), et App Attest avec un objet réel
> enregistré et la vraie racine Apple.
>
> **Hérité de la mission 5a, OP-N72 (ADR-117 ; confirmé par le porteur le 21/10/2026)** :
> `POST /v1/device-enrollments` (sans compte) n'a pas de limite en amont ; chaque refus d'un code inconnu écrit dans
> la chaîne d'audit de la plateforme, et un attaquant aux nombreuses adresses n'est borné que par /64. Poser une
> limite de débit au répartiteur (ou à la passerelle) sur cette route, la vérifier sur l'environnement de recette,
> puis lever la limite (bornes : `tests_enrollment_limits.sql` §3 et §5).
>
> **Hérité de la mission 5b, OP-N77 (ADR-125 ; décision du porteur du 23/10/2026)** : `loadConfig` est commun à tous
> les processus ; en production, `IDEMPOTENCY_HMAC_KEY`, `ENROLLMENT_CODE_HMAC_KEY`, `VENDOR_PIN_SECRET` et
> `VENDOR_PIN_IDEMPOTENCY_SECRET` (ADR-126, 26/10/2026) sont exigés
> aussi par les processus des clés et de personnalisation, qui ne s'en servent pas. Faire lire à chaque processus ses
> seuls secrets, le prouver par un test par processus, puis lever le point (borne : `config.spec.ts`).
>
> **Hérité de la mission 5b, OP-N78 (ADR-127 ; décision du porteur du 26/10/2026)** : `vendor_pin_check` n'a pas de
> purge. Ajouter une fonction de purge bornée à la fenêtre de comptage des essais, exécutée par un rôle dédié (comme
> OP-N75), avec un test pgTAP, puis lever le point.
>
> **Hérité de la mission 5b, OP-N80 (consigné par WP14, 26/10/2026 ; proposée par l'agent)** : le verrou d'essai de PIN
> (`SessionLock`) tient une connexion de son pool dédié pendant toute l'ouverture de session. Mesurer en charge
> (tous les terminaux d'un événement qui ouvrent ensemble), ajuster la taille du pool ou rendre `429` à la saturation
> (aujourd'hui `500` après 10 s d'attente), avec un test, puis lever le point. Consigne d'exploitation : exiger
> `VENDOR_PIN_SECRET` et `VENDOR_PIN_IDEMPOTENCY_SECRET` dans les manifestes de déploiement (aucun manifeste dans le
> dépôt à ce jour) ; la rotation du second invalide seulement les empreintes d'idempotence des routes à PIN.
>
> **Mise en production, consigne de la mission 5a (OP-N54, OP-N71 ; décision du porteur du 21/10/2026)** : purger
> par le propriétaire de la base les lignes `api_idempotency` antérieures au déploiement, à T + 720 h, et vérifier que
> leur compte est nul. Fixer aussi `DEVICE_REQUEST_AUTHORITIES` (autorités `host[:port]` de l'API, sans joker ;
> obligatoire en production, ADR-113).
>
> **Hérité de la mission 4 (bracelets-nfc)**, à lever avant la production :
>
> **OP-N61 (ADR-98, décision du porteur du 15/10/2026)** — NFR-008 non prouvé à l'échelle : prouver que la clôture d'un
> lot, le rattrapage du préchargement (au-delà d'une tranche de 500) et le rechiffrement vont au bout sur un lot de
> 5 000 bracelets, avec au moins une relance sans double effet ; durées dans le rapport de recette (prouvé aujourd'hui :
> 600 cautions, 1 200 bracelets en 3 tranches, préchargement sur 3 bracelets).
>
> **OP-N45 (ADR-83 ; mission confirmée par le porteur le 15/10/2026, ADR-101)** — décrire et
> vérifier l'aiguillage par chemin vers les trois processus (`x-process` du contrat) : `POST /media/auth-keys` et
> `/media-personalizations` n'atteignent que leur processus.

- [ ] /spec-kitty.specify Recette de la V1 selon les critères d'acceptation (SPECIFICATION §15, §16). Test de charge à deux fois la cible (400 terminaux, 100 ventes par seconde sur le site, 40 sur un stand, 30 minutes) sans interblocage, sans écart dans `balance_drift`, latence serveur seul p95 ≤ 200 ms et p99 ≤ 500 ms. Test de coupure : 10 terminaux hors ligne pendant 30 minutes puis synchronisation, zéro doublon, anomalies ouvertes, `S-ATTENTE` = somme des dépassements. Tests minimaux de `sync_protocol.md` §13 de bout en bout. Test automatisé de cloisonnement entre prestataires sur toutes les routes de l'API. Vérification que les deux suites pgTAP, les 19 cas du moteur, le scénario de référence et les vecteurs du format B passent partout. Rapport de recette.
- [ ] /spec-kitty.plan Environnement de charge proche de la production (PostgreSQL 17 RDS, région provisoire `eu-west-3`). Outils de charge au choix de la mission, justifiés. Le test d'intrusion externe (ADR-44) reste à mener par l'auditeur avant le pilote : hors de cette mission.
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission recette-v1
- [ ] /spec-kitty.review --mission recette-v1
- [ ] /spec-kitty.accept --mission recette-v1
- [ ] spec-kitty merge --mission recette-v1

---

## Modèle — mission non prévue dans le découpage initial

> Quand un nouveau besoin fonctionnel est décidé en cours de route plutôt que planifié ici dès l'origine, ajoute
> une entrée ici **et** enrichis la section correspondante de `PRD.md` dans le même geste, avant ou au moment du
> `/spec-kitty.specify` — pas après coup. Le skill `spec-kitty-docs-maintain` doit normalement te le rappeler le
> moment venu, mais ne compte pas uniquement là-dessus.

## Mission N — [nom de la mission]

- [ ] /spec-kitty.specify [besoin concret, sections de SPECIFICATION et ADR concernées]
- [ ] /spec-kitty.plan [contraintes techniques concrètes tirées de PRD.md et SPECIFICATION]
- [ ] /spec-kitty.tasks
- [ ] spec-kitty next --agent claude --mission [slug réel]
- [ ] /spec-kitty.review --mission [slug réel]
- [ ] /spec-kitty.accept --mission [slug réel]
- [ ] spec-kitty merge --mission [slug réel]
