# Recherche 11a — points hérités de la 9b (OP-N140, OP-N145, OP-N137, OP-N141)

Lecture seule. Chemins relatifs à /Users/xaamga/Documents/omar_sylla_work/cashless/cashless-platform. Dernière migration : 0089.

---------------------------------------------------------------------------------------------------------------------
## 1. OP-N140 — IBAN : masque dans redact.ts et chiffrement au repos
---------------------------------------------------------------------------------------------------------------------

### 1.1 `apps/api/src/errors/redact.ts` (43 lignes)
- `REDACTED_FIELDS` (l.16-22) = `pin`, `token`, `customer_qr_token`, `qr_payload`, `x-approval-token`. Pas d'`iban`, pas de `msisdn`.
- Trois passes dans `redactSecrets` (l.38-43) : (1) `ARGON2_PHC` (empreintes `$argon2…`), (2) `JSON_FIELD` (`"champ":"valeur"`, nom préfixé
  accepté : `refresh_token`), (3) `TEXT_FIELD` (`champ=valeur`, `champ: valeur`, valeur = `[^\s&,;"]+`, donc s'arrête au premier espace).
- Seul appelant : `apps/api/src/errors/problem.filter.ts:96` (`logProblem`, message d'erreur 5xx/SQL). Aucun journal de corps aujourd'hui
  (règle écrite l.4-6 de redact.ts : tout futur journal DOIT passer par `redactSecrets`).
- Limite de conception à corriger : un IBAN saisi avec espaces (`SN08 SN01 0015…`) ne serait masqué que sur son premier groupe par `TEXT_FIELD` ;
  un IBAN sans nom de champ (message d'erreur libre) ne l'est pas du tout.
- Test à inverser : `apps/api/test/integration/invariants-cloture/limits-9b.spec.ts:12-26` (« l'IBAN n'est pas masqué (limite connue) » :
  `expect(redactSecrets('{"iban":"…"}')).toContain(iban)` et liste exacte de `REDACTED_FIELDS`).

**Conception (masque).**
1. Ajouter `'iban'` à `REDACTED_FIELDS` (couvre `"iban":"…"`, `iban=…`, `destination_iban=…`). Recommandé aussi : `'msisdn'` (donnée personnelle
   de même nature, déjà dans `FORBIDDEN_KEYS` de `processes/ops-alerts.ts:20` et masquée par `maskPaymentData`) ; à confirmer.
2. Ajouter une passe par VALEUR, appliquée AVANT les deux passes par champ : motif d'IBAN nu `\b[A-Z]{2}[0-9]{2}(?:[ ]?[A-Za-z0-9]){11,30}\b`
   (espaces simples tolérés, insensible à la casse), remplacé par `[masqué]`. Faux positifs acceptés dans un journal (mieux vaut masquer trop).
   Ne pas exiger le modulo 97 : une saisie invalide dans un message d'erreur reste sensible.
3. Tests : unit `redact` (JSON, formulaire, texte, IBAN avec espaces, IBAN nu dans un message, nom préfixé, `maskIban` déjà masqué non cassé,
   chaîne ordinaire non touchée) ; inverser `limits-9b.spec.ts:12-26` (liste = ancienne + `iban`). Fichier à faire relire par une personne : `redact.ts`.

### 1.2 Où l'IBAN entre et où il est stocké EN CLAIR (l'OP ne cite que `refund_request.iban` ; il y a TROIS emplacements)
| Emplacement | Écrit par | Lu par | Remarque |
|---|---|---|---|
| `refund_request.iban` (0081 l.30 ; `text`, aucun CHECK ni index) | `apps/api/src/refunds/refund-backoffice-create.service.ts:79-97` (INSERT, `input.iban` normalisé par `refund-requests.dto.ts:105`) ; seul chemin API (le chemin festivalier `refund-requests.service.ts:105` n'écrit pas d'IBAN, virement réservé au back-office) | AUCUN lecteur TypeScript : `REFUND_COLUMNS` ne le sélectionne pas, `toRefundRequest` ne le rend pas, audit = `maskIban` (l.127). Comparé seulement par `refund_request_transition_guard` (0086 l.31, immuabilité) | Écriture seule : aucun export de remboursements n'existe. Le « paiement manuel » se fait hors système (hors code). |
| `payout.iban` (0085 l.35 ; CHECK `payout_destination_bank` l.43-44 : non vide) | SQL : `create_payout_batch` (0085 l.203-218, 291) reçoit l'IBAN dans `p_lines` JSON, appelé par `payouts/payout-action.ts:361-367` via `sqlLines` (l.416-425) | `payouts/payouts.service.ts:140-170` (`exportBatch`, route `exportPayoutBatch`, `x-process: public`) : SEUL endroit où l'IBAN sort, en CSV. Comparé par `payout_transition_guard` (0085 l.97-101) | C'est le seul IBAN avec un lecteur : le CSV. |
| `approval_request.payload` (jsonb) | `ApprovalService.request` (`approval/approval.service.ts:92-105`, `JSON.stringify(payload)`) : lignes `PAYOUT` (`payout-action.ts:291`) et `destination` de `LATE_CLAIM` (`late-claims/late-claim-action.ts:43`, `late-claims.dto.ts:95`) | relu et REVALIDÉ à l'exécution (`validatePayload`, `isValidIban`, `payout-action.ts:474-476`) ; exposé masqué par `approval/approval.mapper.ts:58-72` (`maskPaymentData`, clé `iban` → `maskIban`) | Pour `LATE_CLAIM` BANK_TRANSFER : aucune ligne `payout` ni `refund_request` ; l'IBAN ne vit QUE dans le payload (jamais relu pour payer, seul le moyen compte : `moneyAccountOf`). |
- Aucune recherche par IBAN, aucun index ni unicité sur `iban` (grep sur migrations et TS : rien). Seules comparaisons : `IS DISTINCT FROM` dans deux gardes
  de transition (un chiffrement à IV aléatoire les laisse valides, la colonne ne change pas à l'UPDATE) et le test `payment-data-exposure.spec.ts`
  (`LIKE %IBAN%` sur audit/approbations) qui deviendrait plus fort. Le chiffrement ne casse donc aucune recherche.
- Tests existants concernés : `late-claims/late-claim.spec.ts` (« FR-024 : ni IBAN ni numéro… »), `payouts/payout-export.spec.ts` (CSV en clair l.37, absence ailleurs l.57-66),
  `invariants-cloture/payment-data-exposure.spec.ts`, `refunds/create-backoffice.spec.ts`, `test/unit/payouts/payout-roles.spec.ts` (`maskPaymentData`).

### 1.3 Service de clés existant : qui peut chiffrer / déchiffrer
- Ports par droit (`apps/api/src/kms/kms.ports.ts:12-61`) : `MacPort`, `DataKeyPort` (`generateDataKey` : clair + chiffré), `DecryptPort` (`decrypt`), `KeyAdminPort`, `SignPort`.
  Câblage `kms/kms.module.ts` : `KmsModule.forCapabilities([...])` n'exporte que les ports demandés par le processus.
- Processus : personnalisation (`mac`, `dataKey`), clés de bracelet (`decrypt`), contrôle quotidien (`mac`, `decrypt`), contenu des snapshots (`decrypt`, `dataKey`),
  administration des clés (`keyAdmin`), signature (`sign`) : `processes/*.module.ts`. **L'API publique (`public.module.ts`, rôle `cashless_app`) n'a AUCUN port** ;
  `test/unit/architecture.spec.ts:158-170` échoue si un fichier atteignable depuis la racine publique référence `KmsModule`/`*_PORT` ou importe `kms/kms.ports.ts`.
- Les clés de données chiffrées (`media/keys/session-data-key.ts`, `snapshots-content/crypto/snapshot-entry-encryptor.ts`) sont rouvertes par des processus à part ;
  `cashless_app` n'a pas droit de lire leurs colonnes (`post-roles.sql`).
- **Il n'existe qu'un FAUX service de clés** (`kms/fake-kms.ts`, `isFake`) : `createKms` (kms.module.ts:13-16) refuse de le construire en production (`FakeInProductionError`).
  Donc, aujourd'hui, tout processus qui porte un port KMS ne peut pas démarrer en production. Un chiffrement d'IBAN fondé sur le KMS serait inutilisable en production avant
  l'arrivée d'un vrai KMS (cf. OP-N41, POINTS_OUVERTS.md:183 : « première mission qui a besoin d'un vrai KMS pour autre chose que les bracelets »).
- **Conflit structurel :** la route d'export `exportPayoutBatch` est `x-process: public`. Elle doit rendre l'IBAN en clair, donc le processus public devrait pouvoir déchiffrer.
  Le KMS lui est interdit par construction (architecture.spec) ; la déplacer vers un autre processus changerait `x-process` du contrat (« aucune route du contrat ne change »).

### 1.4 Conception proposée — chiffrement applicatif AES-256-GCM à anneau de clés de configuration (sans KMS, sans faux, sans droit en plus)
1. **Module** `apps/api/src/common/iban-vault.ts` (+ unit test) : `sealIban(iban, aad)` / `openIban(envelope, aad)` / `isSealed(value)`.
   Format colonne : texte `enc:v1:<kid>:<base64url(iv12 || ciphertext || tag16)>`. AES-256-GCM (`node:crypto`), IV aléatoire de 12 octets, AAD =
   `CASHLESS/IBAN/v1|<operator_id>` (lie le chiffré au prestataire ; l'identifiant de ligne n'existe pas encore à l'insertion pour `payout`). `kid` permet la rotation
   (plusieurs clés actives en lecture, une seule en écriture). Type de colonne inchangé (`text`) : aucune migration de type.
2. **Clé** : anneau lu de la configuration (`apps/api/src/config/config.ts`, variable type `IBAN_KEYRING` = `kid:base64(32 octets),…`, + `IBAN_ACTIVE_KID`), jamais journalisé.
   **Production : démarrage refusé si l'anneau est absent ou invalide** (même esprit que `assertNoFakeInProduction`, mais ce n'est pas un faux : une vraie clé exigée). Hors production,
   une clé fixe de test est acceptable si elle est nommée et refusée en production par un test (« aucun faux nouveau » : on ne crée pas un faux fournisseur, on exige une vraie clé).
3. **Droits** : aucun GRANT nouveau à `cashless_app` (le processus public déjà autorisé à lire/écrire ces colonnes les lit/écrit chiffrées). Aucun port KMS ajouté au processus public
   (architecture.spec inchangé). La compromission du processus public expose toujours l'IBAN (déjà le cas pour l'export) ; ce qui est gagné : base, sauvegardes, réplicas, autres rôles SQL,
   injection SQL en lecture seule. À consigner honnêtement dans l'ADR (limite résiduelle : clé dans le processus public ; levée par l'arrivée d'un vrai KMS, OP-N41).
4. **Points d'écriture** : (a) `refund-backoffice-create.service.ts:94` : `iban: sealIban(input.iban, operatorId)` (l'audit garde `maskIban(input.iban)` calculé AVANT chiffrement) ;
   (b) `payout-action.ts` : `validatePayload` (l.474-476) garde la validation sur le clair à la demande, puis la ligne du payload porte `iban` sous forme d'enveloppe ;
   `sqlLines` (l.416-425) transmet l'enveloppe telle quelle à `create_payout_batch` qui l'écrit dans `payout.iban` (la fonction SQL ne contrôle que « non vide »,
   le CHECK `payout_destination_bank` reste satisfait) ; à l'exécution, `validatePayload` doit accepter l'enveloppe (ouvrir pour revalider `isValidIban`, sans réécrire le clair) ;
   (c) `LATE_CLAIM` : `late-claims.dto.ts:95` / `late-claim-action.ts:43` même traitement (`destination.iban` sous enveloppe dans le payload).
5. **Points de lecture** : `payouts.service.ts:164` (`destination: r.iban ?? …`) → `openIban(r.iban, operatorId)` ; une enveloppe illisible = erreur nommée sans valeur (jamais le clair en repli).
   `approval.mapper.ts:70` (`maskIban(item)` sur une enveloppe donnerait des octets de chiffré) : décision à prendre. Recommandé : le payload porte à côté `iban_mask` (valeur déjà exposée
   aujourd'hui, donc aucune fuite nouvelle) et `maskPaymentData` rend `iban_mask` ; alternative : le mapper reçoit le coffre et ouvre puis masque (mapper aujourd'hui pur).
6. **Garde SQL (test qui échoue si la limite s'élargit, règle 3)** : nouvelle migration `0090_iban_sealed_check.sql` : `ALTER TABLE refund_request ADD CONSTRAINT refund_request_iban_sealed
   CHECK (iban IS NULL OR iban LIKE 'enc:v1:%') NOT VALID` et la même sur `payout` (`payout_iban_sealed`), `NOT VALID` comme 0085 (lignes anciennes tolérées, toute écriture à venir doit être chiffrée :
   un code qui écrirait en clair échoue en base). Pas de CHECK sur le jsonb du payload (testé côté TS).
7. **Migration des lignes existantes** : une migration SQL ne peut pas appeler de chiffrement (la clé est hors base) ; `cashless_app` n'a pas UPDATE sur `refund_request.iban`
   (post-roles.sql:1073-1075, liste de colonnes) ni sur `payout` (REVOKE ALL puis SELECT seul, post-roles ~1090) et `payout_transition_guard` (0085) refuse tout changement d'`iban` (et toute écriture
   sur une ligne réglée), `refund_request_transition_guard` (0086 l.31) aussi. La plateforme n'est pas en production (faux refusés, KMS fake-only) : les lignes à reprendre sont celles des bases de
   développement. Proposition : (i) NOUVEAU CHEMIN D'EXPLOITATION, pas API : outil `tools/iban-seal` exécuté avec le rôle propriétaire et l'anneau de clés, qui lit les lignes sans `enc:v1:` et les
   réécrit ; (ii) pour qu'il passe les déclencheurs, la migration 0090 remplace les deux fonctions de garde par une exception étroite : changement d'`iban` autorisé seulement si
   `OLD.iban NOT LIKE 'enc:v1:%' AND NEW.iban LIKE 'enc:v1:%'` et RIEN d'autre ne change (y compris sur une ligne réglée pour `payout`) ; (iii) un contrôle d'exploitation compte les IBAN non chiffrés restants.
   Alternative écartée : travailleur dans le processus `maintenance` (`cashless_maint` n'a volontairement aucun accès aux données métier) ; alternative écartée : donner UPDATE(iban) à `cashless_app`
   (droit ajouté, interdit). Si le porteur confirme qu'aucune ligne réelle n'existe, (i)-(iii) se réduisent à ne rien migrer et à garder le CHECK `NOT VALID`.
8. **Options à soumettre au porteur** : A (recommandée ci-dessus) ; B : KMS (`DataKeyPort`/`DecryptPort`) : impossible tant que le processus public n'a pas de port et qu'aucun vrai KMS n'existe,
   et déplacer l'export changerait le contrat ; C : laisser en clair avec le masque seul (dette consignée, condition de levée = vrai KMS). Le point d'écart de sécurité (règle 1) : la clé d'anneau
   est un secret nouveau dans le processus public : renforcement net par rapport à l'état actuel, à consigner puis relire.
9. Fichiers à faire relire (règle 4) : `errors/redact.ts`, `common/iban-vault.ts`, `0090_*.sql` (gardes), configuration de l'anneau. Reports : POINTS_OUVERTS (OP-N140 levé ou transformé en OP « clé dans le processus public »),
   ADR (suite d'ADR-203), `PROMPTS-A-ENVOYER.md` et `PRD.md`.
10. Tests à mettre à jour : `late-claim.spec.ts`/`payout-export.spec.ts`/`payment-data-exposure.spec.ts` (ajouter : `payout.iban`, `refund_request.iban`, `approval_request.payload` ne contiennent plus l'IBAN en clair ;
   le CSV le rend en clair), `limits-9b.spec.ts` (inversion), nouveaux : unit vault (aller-retour, AAD d'un autre prestataire refusé, enveloppe altérée refusée, rotation de `kid`), production sans anneau refusée,
   pgTAP : INSERT en clair refusé par le CHECK sur les deux tables.

---------------------------------------------------------------------------------------------------------------------
## 2. OP-N145 — `refund_request` : garde d'insertion et anciennes signatures
---------------------------------------------------------------------------------------------------------------------

### 2.1 État actuel (droits et gardes)
- `post-roles.sql:1071-1075` : `REVOKE ALL ON refund_request FROM cashless_app; GRANT SELECT, INSERT ON refund_request TO cashless_app;` — INSERT sur TOUTES les colonnes (la fiche OP dit « pas INSERT
  direct sur les colonnes de transition » : c'est inexact, le droit est de table entière). UPDATE par colonnes (15) : `status, updated_at, holder_decision, holder_decided_at, approval_request_id, approved_by,
  transaction_id, external_reference, failure_reason, reject_reason, reversal_transaction_id, confirmed_by, confirmed_at, estimated_amount, fee`.
- Déclencheurs : `refund_request_scope_guard` BEFORE INSERT (0081 l.~92-106, DEFINER : portefeuille/grand livre/événement/festivalier du même prestataire) ; `refund_request_transition_guard` BEFORE UPDATE
  seulement (0086 l.19-84). En-tête 0086 l.12-13 : « Aucune garde d'insertion nouvelle ».
- Ce qui protège aujourd'hui un INSERT en `PAID` : seulement les CHECK de 0081 : `PAID` exige `external_reference` ; `PROCESSING/PAID/FAILED` exigent `transaction_id` ET `approved_by` ; `FAILED` exige motif + `reversal_transaction_id` ;
  `REJECTED` exige `reject_reason` ; `BLOCKED` exige `holder_decision='BLOCK'`. Une API compromise peut donc fabriquer un `PAID` avec une `external_reference` arbitraire, un `transaction_id` existant et un `approved_by` quelconque
  (`refund_request_two_persons` seulement si `requested_by` ≠ `approved_by`), sans passer par le graphe de transitions. `CANCELLED` s'insère sans aucune colonne de transition.
- Seuls INSERT applicatifs : `refunds/refund-requests.service.ts:105-125` (festivalier : colonnes `operator_id, ledger_id, event_id, wallet_id, customer_id, method, msisdn, new_number, status, estimated_amount, fee, currency, hold_until,
  extra_check_required` ; `status` ∈ `AWAITING_HOLDER`/`REQUESTED`) et `refunds/refund-backoffice-create.service.ts:78-97` (mêmes + `requested_by`, `iban`). Les autres INSERT sont des fixtures exécutées en propriétaire :
  `test/integration/reconciliation/statement-fixtures.ts:185`, `refunds/holder-fixtures.ts:96`, `refunds/refund-flow-fixtures.ts:57`, et pgTAP (`tests_statements.sql`, `tests_refund_requests.sql`, `tests_refund_transitions.sql:70`) ;
  seul `tests_refund_requests.sql:287-334` insère sous `SET LOCAL ROLE cashless_app` (colonnes d'identité + `REQUESTED`, toutes dans la liste ci-dessous).
- Test de borne à faire évoluer : `invariants-cloture/limits-9b.spec.ts:28-90` (INSERT réservé à `cashless_app`, `has_column_privilege` par rôle et colonne, mutation `GRANT INSERT (status) … TO cashless_platform`).

### 2.2 Conception retenue (recommandée) : droits d'INSERT par colonne + déclencheur BEFORE INSERT de défense en profondeur
Migration `0090` (ou `0091` si `0090` porte le chiffrement) + `post-roles.sql` (nouvelle section 12c, sans élargir quoi que ce soit : restreint).
1. `post-roles.sql` : `REVOKE INSERT ON refund_request FROM cashless_app; GRANT INSERT (operator_id, ledger_id, event_id, wallet_id, customer_id, requested_by, method, msisdn, iban, new_number, status,
   estimated_amount, fee, currency, hold_until, extra_check_required) ON refund_request TO cashless_app;` — les 14 autres colonnes (`id`, `holder_decision`, `holder_decided_at`, `approval_request_id`,
   `approved_by`, `transaction_id`, `external_reference`, `failure_reason`, `reject_reason`, `reversal_transaction_id`, `confirmed_by`, `confirmed_at`, `created_at`, `updated_at`) ne sont plus insérables par
   l'API (défauts/NULL). Effet : `PAID`/`PROCESSING`/`FAILED`/`REJECTED`/`BLOCKED` deviennent impossibles à l'INSERT sous les CHECK existants (colonnes exigées non insérables). Le propriétaire (fixtures) n'est pas touché.
2. Déclencheur `refund_request_insert_guard` BEFORE INSERT (fonction non DEFINER, `REVOKE ALL … FROM PUBLIC`, comme les gardes de 0086) : pour une session `cashless_app`
   (`pg_has_role(current_user, 'cashless_app', 'MEMBER')`), refuse (`CL029`) tout `status` hors `AWAITING_HOLDER`/`REQUESTED` (ferme `CANCELLED`, seul statut non couvert par les CHECK), `holder_decision`/`approved_by`/… non NULL
   (au cas où un droit de colonne serait un jour rouvert), `hold_until` incohérent. Un déclencheur inconditionnel est impossible : les fixtures du propriétaire insèrent des états finals (tests_statements, refund-flow-fixtures).
   Ajouter le déclencheur à la liste `REVOKE EXECUTE … FROM cashless_app` de la section 12b (post-roles.sql:1110-1116).
3. Alternative rejetée : fonction DEFINER `create_refund_request(...)` + retrait total d'INSERT : plus sûre en théorie mais réécrit deux appelants TypeScript, le mapping `refund_request_one_open`/`REFUND_ALREADY_OPEN`, les tests pgTAP
   `tests_refund_requests.sql:287-334` et change le mode de contrôle d'accès (EXECUTE nouveau) ; aucun gain sur les statuts une fois le déclencheur posé. À réserver si le porteur veut zéro INSERT direct.
4. Tests (règle 3) : `limits-9b.spec.ts` : `has_column_privilege('cashless_app', …, 'INSERT')` vrai pour EXACTEMENT les 16 colonnes, faux pour les 14 autres ; toujours aucun autre rôle ; mutation `GRANT INSERT (status, external_reference)`
   → test échoue. Comportement sous `cashless_app` (nouveau pgTAP `tests_refund_insert_guard.sql`) : INSERT `PAID`/`CANCELLED`/`REQUESTED` avec `approved_by` : refusé (`42501` ou `CL029`) ; les deux INSERT légitimes passent
   (`AWAITING_HOLDER`, `REQUESTED`) ; `refund-backoffice-create` et `create-refund-request` (integration) inchangés. Écrire le test en famille dans `tests_9b_rights.sql` (écrit à la main) pour la liste des droits.
5. Fichiers à faire relire : `0090/0091` (garde d'insertion), `post-roles.sql` section 12c.

### 2.3 Anciennes signatures
Définitions : `refund_deposit(uuid, uuid DEFAULT NULL)` (schéma de référence `schema_grand_livre_cashless.sql:1626`, redéfini en délégation par `0086:122-126`, EXECUTE à personne : `tests_cash_psp_rights.sql:347`) ;
`refund_deposit_for_session(uuid, uuid)` (0036:659-674, délégation par `0086:147-151`) ; EXECUTE accordé à `cashless_app` : post-roles.sql:711 (§7c) pour la version à deux arguments, §12a (l.1106) pour celle à quatre.
Appelants :
- TypeScript : AUCUN appel aux deux anciennes signatures. `apps/api/src/ledger/db/ledger-queries.ts:268-272` appelle `refund_deposit_from_balance($1)` (sans session) ou `refund_deposit_for_session($1,$2,$3::uuid,$4::uuid)` (quatre arguments).
  Les autres mentions (`ledger-engine.service.ts:267-309`, `registry.ts`) ne sont que des noms de commande.
- SQL interne : `0041_deposit_from_balance.sql:32-38` `refund_deposit_from_balance` appelle `refund_deposit(p_media, NULL)` (deux arguments) ; `refund_deposit_for_session` (0036) appelait `refund_deposit(media, compte)`.
- Générés (NE PAS modifier à la main) : `packages/ledger-sql/gen_tests.py:407` et `:918` → `tests_grand_livre_cashless.sql:321` et `:703` appellent `refund_deposit(media)` (forme à un argument, via la valeur par défaut) en propriétaire ;
  `schema_grand_livre_cashless.sql:1626` définit la forme à deux arguments (schéma de référence, source de vérité, non modifiable). `tools/` : aucun appel.
- pgTAP écrits à la main qui nomment les anciennes signatures : `tests_cash_sessions.sql:194-207, 518, 561, 587, 597` ; `tests_execute_grants.sql:136` (liste accordée à `cashless_app`) ; `tests_cash_psp_rights.sql:347, 352` ;
  `tests_refund_transitions.sql:289-293, 318-319, 338-354, 366-371` (`has_function` des deux formes, rejeu `(a, NULL)`, P0002) ; `tests_9b_rights.sql` (listes de droits).
**Conception.**
- `refund_deposit_for_session(uuid, uuid)` : RETIRER (`DROP FUNCTION` en 0090/0091 + retirer de `post-roles.sql:711`) — c'est la seule des deux accordée à l'API et le seul chemin « sans auteur ni valideur » (OP-N128) joignable depuis `cashless_app`.
  Aucun appelant TS : sans risque. Adapter `tests_cash_sessions.sql` (appels 2 arguments → 4 arguments avec `NULL, NULL`, ou deux UUID de personnes), `tests_execute_grants.sql:136`, `tests_cash_psp_rights.sql:352`,
  `tests_refund_transitions.sql` (les `has_function … deux arguments conservée` deviennent `hasnt_function`) et `tests_9b_rights.sql`. Cela RESSERRE les droits : à consigner, aucune soumission préalable nécessaire (règle 1, renforcement).
- `refund_deposit(uuid, uuid)` : le retrait est PLUS COÛTEUX et moins utile : sans EXECUTE pour l'API, mais (i) `refund_deposit_from_balance` (0041) l'appelle → il faudrait un `CREATE OR REPLACE` de celle-ci vers la forme à quatre arguments
  `(media, NULL, NULL, NULL)` ; (ii) `gen_tests.py:407, 918` l'appellent sous la forme `refund_deposit(media)` : deux modifications DE GÉNÉRATEUR (autorisées par CLAUDE.md, régénération `check-generated.sh`) ; (iii) la forme existe dans le schéma de référence
  (priorité §0.3 : tests exécutables > schéma, donc le générateur prime, mais on diverge du schéma de référence). Recommandation : à décider par le porteur. Option 1 (recommandée) : retirer
  `refund_deposit_for_session(uuid,uuid)` seulement, garder `refund_deposit(uuid,uuid)` interne et non accordée (documenté dans l'ADR). Option 2 : retirer aussi `refund_deposit(uuid,uuid)` avec les trois changements ci-dessus.
- Lien avec `refund_deposit_from_balance` : sans session il passe `NULL, NULL` (aucun auteur) ; hors périmètre d'OP-N145 mais à rappeler (OP-N128 vise la session).

---------------------------------------------------------------------------------------------------------------------
## 3. OP-N137 — versements (a) à (d)
---------------------------------------------------------------------------------------------------------------------

### 3.1 Mécanisme actuel
- `ApprovalService.approve` (`approval/approval.service.ts:117-175`) : `prepareDecision` (l.271-291) ne vérifie que `requiredRoles(definition)` = UNE liste de rôles où l'un quelconque suffit (`PAYOUT_ROLES` =
  `ORGANIZER_ADMIN` ou `OPERATOR_ADMIN`, `payout-action.ts:55`). `decide` enregistre la décision (`decide_approval_request`, passe la demande à `APPROVED`), puis `definition.execute` dans un `SAVEPOINT`.
  Le contrôle de classe est DANS `execute` (`payout-action.ts:332-358`, boucle `[requestedBy, approvedBy]` + `missingRole` → `ProblemException('FORBIDDEN')`) ; or `businessFailure` (approval.service.ts:399-404) traite toute
  `ProblemException` < 500 comme un échec métier : `ROLLBACK TO SAVEPOINT`, demande FAILED (`failure_code=FORBIDDEN`), `onClosed` écrit `PAYOUT_BATCH_CLOSED`. Donc **(a)** : n'importe quel détenteur d'un seul des deux rôles peut, en approuvant un lot
  mixte ou de l'autre classe, tuer la demande (nuisance ; aucune écriture comptable).
- `ApprovalService.reject` (l.177-208) passe par la même `prepareDecision` : **(b)** un détenteur de l'un des rôles peut refuser un lot dont il n'a pas la classe de bénéficiaire. La fiche dit « même 403 pour tous » : le refus de rôle
  est un `403 FORBIDDEN` sans précision de la classe manquante (à l'exécution seulement : détail « Le rôle X est exigé… », payout-action.ts:355). Lecture retenue : le refus doit vérifier les rôles par classe comme l'approbation ;
  ambiguïté à confirmer avec le porteur (voir 3.3).
- `PayoutsService.confirm` (`payouts/payouts.service.ts:~188-247`) : verrou consultatif, lecture de la ligne, `scoped` + `missingRole`, garde « échec par préparateur/valideur » (décision 18), `settle_payout`, puis `audit.record` seulement
  `if (current.status === 'INITIATED')` (l.~228-238). **(c)** : rejeu identique (même résultat) : `settle_payout` renvoie la ligne (`0089` l.42-47 « rejeu identique »), la route répond `200` sans écriture ni audit (les rejeux avec la même
  `Idempotency-Key` ne passent même pas ici : la réponse mémorisée est rendue).
- Auto-approbation : `decide_approval_request` (schéma de référence, `schema_grand_livre_cashless.sql:~2965`) refuse `p_approver = r.requested_by` par `CL023`, mappé `409 APPROVAL_INVALID` (`errors/sqlstate-map.ts:33`).
  Le préparateur tient le rôle (sinon sa demande n'aurait pas été créée) : `prepareDecision` passe, `decide` lève `CL023` : le résultat est donc DÉTERMINISTE : `409`, `code: APPROVAL_INVALID`. Test imprécis : `payouts/payout-batch.spec.ts:63-73`
  (`expect([403, 409]).toContain(self.status)` l.68, `expect(self.body.status).not.toBe('EXECUTED')` l.69). **(d)**.

### 3.2 Conception (migrations : aucune ; changement d'API interne seulement)
- **(a) + (b)** : ajouter à `ApprovalActionDefinition` (`approval/action-registry.ts:44-72`) un crochet OPTIONNEL `guardDecision?(client, ctx: {request, payload, actor: ApprovalActor, decision: 'APPROVE' | 'REJECT', chain?}) : Promise<void>`,
  appelé dans `prepareDecision` (approval.service.ts:271-291) juste après le contrôle de rôle générique et AVANT `decide` : il lève `ProblemException('FORBIDDEN', {detail})` : réponse `403`, AUCUN changement d'état (la demande reste `PENDING`,
  aucun `APPROVAL_FAILED`). Implémentation PAYOUT : `missingRole(actor.principal, kinds, chain)` avec `kinds` lus du payload (`payload.lines[].beneficiary_kind`, déjà validé) et `chain = resolveChain(client, scopeOf(payload))`
  — les attributions de l'acteur sont déjà dans `actor.principal.assignments` (pas de relecture en base pour lui). Rétrocompatible : les autres actions ne définissent pas le crochet.
  Le contrôle de `execute` (`[requestedBy, approvedBy]`) est CONSERVÉ comme défense en profondeur (attribution de l'auteur révoquée entre la demande et la validation, race). Le refus de rôle à l'exécution restera possible dans ce seul cas (documenter).
  Pour (b), appliquer le même crochet au refus (`decision: 'REJECT'`) : même rôles que pour approuver. C'est un resserrement (une personne sans la classe ne peut plus refuser), pas un affaiblissement.
- **Tests à changer** : `payout-batch.spec.ts:95-122` (« valideur du mauvais rôle : demande FAILED ») devient : approbation par `p.organizerAdmin2` du lot mixte → `403`, la demande reste `PENDING` (relire `GET /approval-requests/{id}`), aucune écriture ;
  puis un valideur des deux rôles (`p.holdingBoth()`) approuve la MÊME demande → `EXECUTED` (preuve que la nuisance est levée) ; ajouter : refus (`/reject`) par un détenteur d'une seule classe : `403`, la demande reste `PENDING`.
  Nouveau unit test : le crochet n'est appelé que si défini, appelé pour approve ET reject (`approval` unit tests existants dans `apps/api/test/unit/approval/`). `test/unit/payouts/payout-roles.spec.ts` : cas du crochet. Mutation : retirer le crochet → le test échoue.
- **(c)** : en rejeu identique, enregistrer un audit sans écriture comptable : action `PAYOUT_CONFIRM_REPLAYED` (nom proposé) avec `after: { ledger_id, outcome, replay: true }`, MÊME auteur/portée (jamais de destination ni de référence). Détection : `current.status !== 'INITIATED'` après le
  contrôle `settle_payout` réussi (le rejeu différent est déjà `409` par `CL029`). Conserver : `200`, aucune transaction, aucune écriture `payout`. Option (non retenue) : laisser sans audit et consigner : le rejeu ne change rien ; mais le brief du porteur le liste.
  Code d'audit : **`AuditAction` est une union TypeScript** (`apps/api/src/audit/audit.service.ts:8-~150`, ajout d'un membre à côté de `PAYOUT_CONFIRMED`/`PAYOUT_FAILED`) ; `audit_log.action` est un `text` libre
  (`0004_audit_log.sql:20`, CHECK de longueur seulement) ; **aucun enum `AuditAction` dans `packages/contracts/openapi.yaml`** (grep : `PAYOUT_CONFIRMED`/`PAYOUT_FAILED` n'y figurent que comme types de TRANSACTION, l.12979, et dans le texte, l.11256).
  Donc ajouter `PAYOUT_CONFIRM_REPLAYED` ne change PAS le contrat (rien à signaler pour openapi), mais vérifier `docs/` (liste des actions d'audit, p. ex. `docs/07-api-reference.md`) et tout test qui énumère les actions
  (aucun `AuditAction` référencé dans `apps/api/test`, grep négatif). Test : `payout-confirm.spec.ts` : rejeu identique (clé d'idempotence DIFFÉRENTE) → `200`, `txCount('PAYOUT_CONFIRMED')` inchangé, UNE ligne `PAYOUT_CONFIRM_REPLAYED` ; un rejeu avec la même clé ne passe pas par le gestionnaire (aucune ligne de plus).
- **(d)** : `payout-batch.spec.ts:68` → `expect(self.status).toBe(409); expect(self.body.code).toBe('APPROVAL_INVALID')`, et vérifier que la demande reste `PENDING` (l'erreur `CL023` revient avant toute écriture ; transaction annulée). Aucun changement de code.

### 3.3 Risques et questions au porteur
- (b) ambigu : confirmer que « refus sans rôle par classe » = le refus ne contrôle pas les classes (lecture retenue). Si le porteur voulait seulement des 403 différenciés, c'est un simple message de détail (sans effet de sécurité).
- Le crochet change `prepareDecision` pour toutes les actions (facultatif ; aucune autre action ne l'utilise) : vérifier `approval.service` unit tests et `action-registry.ts` (`registry.spec`).
- `GET /approval-requests` : `canSee` (approval.service.ts:351-365) liste les demandes que la personne « peut lancer ou approuver » via les rôles génériques : un détenteur d'une seule classe voit encore le lot mixte (lecture, sans effet ; mentionner).

---------------------------------------------------------------------------------------------------------------------
## 4. OP-N141 — plafond « frais bruts » de la régularisation `OPERATOR_FEE`
---------------------------------------------------------------------------------------------------------------------

### 4.1 État actuel
- Constructeur : `apps/api/src/ledger/builders/closing/fees.ts:89-128`. Charge `OperatorFeePayload = { bases: {TOPUP_AMOUNT?, PER_MEDIA?}, regularization?, amount? }`. Branche de régularisation (l.110-114) :
  `push(lines, org('ORG_FPREST'), requirePositive(amount, 'écart de régularisation'))` puis `creditWithTax(...)` ; seule borne : `amount > 0` (`festival/lines.ts:5-9`).
- Appelant unique : `apps/api/src/closing/calculators/operator-fee-regularization.ts:21-84` : `gross = bases écrites en SETTLING` (`basesFrom(recorded.summary.bases)` sinon `readBases`), `net` = recharges − remboursements,
  `delta = feeTotal(gross) − feeTotal(net)` (l.51-53), commande `{variant:'REGULARIZATION', bases: gross, regularization: true, amount: delta}` (l.62-67). Le payload porte DÉJÀ les `bases` brutes.
- Frais bruts = `feeTotal(ctx.config, bases)` (`closing/calculators/operator-fee.ts:40-47`) : somme sur `config.operatorFees` de `bases.PER_MEDIA * fee(0n, rule)` (PER_MEDIA) ou `fee(bases.TOPUP_AMOUNT, rule)` ; c'est la même arithmétique que les lignes
  `ORG_FPREST` de la branche normale (fees.ts:115-121). Montants TTC (le `amount` aussi : `creditWithTax` extrait ensuite la taxe).
- Tests existants : `test/unit/closing/calculators.spec.ts:167-205` (régularisation), `test/unit/builders/closing/closing-builders.spec.ts` (constructeurs), `test/integration/closing/closing-variants.spec.ts:33-48,91` (écart 200, rejeu), `test/unit/status-matrix.spec.ts:133`.
  Aucun test ne pose le plafond.

### 4.2 Conception
- Fixer le plafond DANS le constructeur (`buildOperatorFee`, branche régularisation), le seul endroit où toute écriture OPERATOR_FEE passe : calculer
  `grossFees = Σ_{config.operatorFees} (basis === 'PER_MEDIA' ? (bases.PER_MEDIA ?? 0n) * fee(0n, rule) : fee(bases.TOPUP_AMOUNT ?? 0n, rule))` avec `config` du `BuildContext` ; si `amount > grossFees` → `BuildError('VALIDATION_FAILED', 'écart de régularisation : supérieur aux frais bruts')`.
  `amount === grossFees` reste admis (tout remboursé : net 0, écart = frais bruts). Ne pas exiger de champ nouveau : `bases` est déjà dans la commande (calculateur l.64).
- Factoriser : extraire la somme en une fonction exportée `operatorFeeTotal(config, bases)` dans `fees.ts` et faire que `closing/calculators/operator-fee.ts:40` (`feeTotal`) la réutilise (un seul calcul, pas de dérive entre calculateur et constructeur ; `closing` importe déjà `ledger/builders`).
- Régularisation sans `bases` (ou `config.operatorFees` vide) : plafond 0 → refus (le calculateur renvoie déjà `notApplicable` pour `operatorFees.length===0`).
- Le plafond ne se déclenche jamais pour le calculateur interne (`delta ≤ grossFee` par monotonie de `fee`) : il protège contre une valeur corrompue ou une commande forgée par un futur appelant.
- Tests : unit `closing-builders.spec.ts` : écart = frais bruts : accepté ; frais bruts + 1 : `VALIDATION_FAILED` ; `bases` vides : refus ; cas PER_MEDIA et TOPUP_AMOUNT ; `calculators.spec.ts` inchangé ; `closing-variants.spec.ts` inchangé (écart 200 < brut). Retirer la mention « Limite résiduelle OP-N141 » (ADR-205) et la ligne de `POINTS_OUVERTS.md`.
- Aucune migration, aucun changement de contrat (`VALIDATION_FAILED` existe). Aucun droit touché.

---------------------------------------------------------------------------------------------------------------------
## 5. Points à signaler au porteur / pour le plan
1. OP-N140 : l'IBAN vit en clair dans TROIS emplacements (refund_request.iban sans lecteur ; payout.iban lu par le CSV ; approval_request.payload) ; le service de clés est un faux sans port dans l'API publique : le chiffrement KMS est impossible sans changer `x-process`
   (contrat) ; recommandation = coffre AES-GCM à anneau de configuration (décision à prendre : clé dans le processus public, `iban_mask` dans le payload, outil de reprise propriétaire ou rien si aucune donnée réelle).
2. OP-N145 : la fiche surévalue la limite actuelle (INSERT est de table entière, pas limité) ; solution par droits d'INSERT par colonne + déclencheur conditionné au rôle ; `refund_deposit(uuid,uuid)` à garder ou retirer (coût : `refund_deposit_from_balance`, `gen_tests.py:407/918`, schéma de référence) : décision à prendre.
3. OP-N137 : crochet `guardDecision` ; nouvelle action d'audit `PAYOUT_CONFIRM_REPLAYED` (union TS, aucun enum du contrat) ; (b) ambigu.
4. OP-N141 : plafond dans le constructeur, aucun impact contrat.
5. Reports obligatoires (règle 3 de CLAUDE.md) : POINTS_OUVERTS.md, DECISIONS_ADR.md (suite d'ADR-201/203/204/205), PROMPTS-A-ENVOYER.md, PRD.md ; fichiers à faire relire : `redact.ts`, `iban-vault.ts`, migrations 0090/0091 (gardes), post-roles.sql §12c.
