# Contrat : routes du central pour la passerelle (existantes, rien ne change)

Sept opérations du tag `Passerelle`, déjà publiées dans `packages/contracts/openapi.yaml` (commit `d2a7c538`, 05/11/2026).
La mission les met en oeuvre au central ; elle ne renomme, ne retire et ne change ni route, ni schéma, ni code d'erreur
(C-002). Les lignes citées ont été relues dans le fichier courant, identique à `d2a7c538`.

Sources de comportement : `sync_protocol.md` §9, `SPECIFICATION.md` §9.7 et §14.1 (S12, S13), `DECISIONS_ADR.md` ADR-52 et
ADR-74. Le rôle de base de données et la garde sont des propositions du plan (IC-01, IC-03), marquées « proposé ».

## Vue d'ensemble

| Opération | Méthode et chemin | Ligne | Sécurité déclarée | Appelant | Fonction du schéma |
|---|---|---|---|---|---|
| `getDebitAuthority` | `GET /ledgers/{ledger_id}/debit-authority` | 6720 | `humanBearer` ou `edgeMtls` | admin ou passerelle | lecture de `ledger`, du handover ouvert |
| `requestDebitAuthorityChange` | `POST /ledgers/{ledger_id}/debit-authority` | 6753 | `humanBearer` (hérité, rôle dans le texte) | `OPERATOR_ADMIN` | `grant_edge_authority`, `request_edge_release`, `fail_edge_grant` (`target`, état), `force_central_authority` (via approbation) |
| `getCurrentEdgeHandover` | `GET /edge/handovers/current` | 6827 | `edgeMtls` | passerelle | lecture ; écrit `last_seen_at` |
| `ackEdgeHandover` | `POST /edge/handovers/{handover_id}/ack` | 6861 | `edgeMtls` | passerelle | `ack_edge_handover` |
| `releaseEdgeHandover` | `POST /edge/handovers/{handover_id}/release` | 6909 | `edgeMtls` | passerelle | état `RELEASING` (API) puis `complete_edge_release` |
| `getEdgeReplicationFeed` | `GET /edge/replication-feed` | 6968 | `edgeMtls` | passerelle | lecture des soldes, statuts, bracelets (et `reference`, voir `replication-page-additions.yaml`) |
| `submitEdgeSyncBatch` | `POST /edge/sync-batches` | 7018 | `edgeMtls` | passerelle | `record_edge_seq` + écritures `EDGE_SYNC` |

Schémas liés : `DebitAuthority` (12537, requis : `ledger_id`, `authority`, `epoch`, `edge_gateway_id`, `edge_base_url`),
`DebitAuthorityState` (14680, `DebitAuthority` + `handover` requis, nul permis), `Handover` (14645),
`DebitAuthorityChangeRequest` (14626, requis : `target`, `reason`), `ReplicationPage` (14690), `EdgeSyncBatch` (14485),
`EdgeSyncOperation` (14416).

## Règles communes

### Garde `edgeMtls` (IC-03, proposé)

Le contrat déclare `edgeMtls` : « Certificat client de la passerelle locale (`edge_gateway.public_key`) » (10995). Le
schéma porte aussi `cert_sha256` et `lan_url`. Mise en oeuvre proposée, sans toucher au texte du contrat :

1. chaîne du certificat client vérifiée contre une autorité de passerelles distincte de celle des terminaux ; un
   certificat de terminal ne passe jamais sur `/edge/*`, un certificat de passerelle jamais sur une route de terminal ;
2. empreinte du certificat égale à `edge_gateway.cert_sha256` ;
3. relecture de `edge_gateway` à chaque requête : `status <> 'REVOKED'` (la révocation est donc immédiate, sans
   attendre une liste de révocation TLS), prestataire et événement lus en base, jamais dans la requête ;
4. toutes les lectures et écritures de la requête bornées à l'événement, au grand livre et au prestataire de cette
   passerelle (NFR-011). Un identifiant étranger est traité comme absent.

Échec de la garde : `401 UNAUTHENTICATED` (code existant, « certificat absent, expiré ou invalide »), sans dire lequel des
contrôles a échoué. Un `403` n'est pas déclaré sur ces routes : ne pas l'employer.

### Rôle de base de données (proposé)

- Les cinq routes `/edge/*` et la lecture `edgeMtls` de `getDebitAuthority` tournent dans un processus dédié, avec le rôle
  `cashless_edge`. Il n'a aucun droit direct sur `ledger` ni sur `debit_authority_handover` (écriture) : il appelle des
  enveloppes qui vérifient passerelle, handover, époque et `origin_*` (décision 5 du plan). `post_transaction` en
  `EDGE_SYNC` est refusée à `cashless_app`.
- `POST /ledgers/{id}/debit-authority` et la lecture `humanBearer` tournent dans l'API publique, via des enveloppes
  exécutables par `cashless_app` (qui ne reçoit toujours ni `UPDATE` sur `ledger`, ni `EXECUTE` sur
  `set_debit_authority`, C-003).
- L'application n'appelle jamais `set_debit_authority`.
- Aucun `GRANT` n'existe aujourd'hui pour les fonctions S12 et S13 : à créer par migration (0058 et suivantes) et à
  figer dans `tests_execute_grants.sql`. Fichiers à faire relire par une personne (CLAUDE.md règle 4).

### Idempotence et traçage

`POST /ledgers/{id}/debit-authority` porte `Idempotency-Key` (paramètre déclaré). Les routes de passerelle déclarent
seulement `X-Request-Id` et `Accept-Language` ; `submitEdgeSyncBatch` déclare en plus `Idempotency-Key` = `batch_id`.
`ack` et `release` sont idempotents par construction (état du handover) : rejouer après réussite répond la même chose que
l'état courant, sans nouvelle écriture.

### Erreurs de bascule (déjà au contrat, 11726 et suivants)

| Code | Statut | `CL` | Sens |
|---|---|---|---|
| `HANDOVER_INVALID_STATE` | 409 | CL013 | action impossible dans l'état du handover |
| `EDGE_NOT_CAUGHT_UP` | 409 | CL014 | filigrane non atteint, ou `edge_seq` manquants |
| `STALE_AUTHORITY_EPOCH` | 409 | CL015 | époque différente ; l'émetteur cesse de débiter |
| `SEQ_OUT_OF_ORDER` | 409 pour un `edge_seq` ; 400 pour un lot de terminal | CL016 | numéro qui n'est pas le suivant attendu |
| `CHAIN_BROKEN` | 409 | CL017 | chaîne rompue ; alerte, examen manuel |
| `DEBIT_AUTHORITY_EDGE` | 409 | CL006 | débit central refusé ; pas un refus définitif |
| `DEBIT_AUTHORITY_MOVING` | 409 | aucun | bascule en cours (`RELEASING`) |
| `BATCH_SIGNATURE_INVALID` | 400 | aucun | signature de passerelle ou d'origine invalide |
| `BATCH_TOO_LARGE` | 413 | CL011 | plus de 500 opérations ou 1 Mio |

Les 409 de `/edge/*` utilisent la réponse partagée `Conflict` (11525), qui nomme déjà `HANDOVER_INVALID_STATE`,
`DEBIT_AUTHORITY_EDGE`, `DEBIT_AUTHORITY_MOVING` et `CHAIN_BROKEN`.

### Corps du 409 `DEBIT_AUTHORITY_EDGE` (toutes routes de débit du central)

Le contrat l'illustre avec `retryable: true`, `edge_base_url` et `authority_epoch` (exemple `edge`, 11542). `Problem`
est `additionalProperties: true` ; sa description ne documente `authority_epoch` que pour `STALE_AUTHORITY_EPOCH`, mais
l'exemple déclare bien les deux champs pour `DEBIT_AUTHORITY_EDGE`. Le central DOIT donc les renseigner (le code actuel
les omet : `ProblemException('DEBIT_AUTHORITY_EDGE')` nu). C'est un alignement sur le contrat existant, pas une
modification (décision 7 du plan : compléter un 409 n'est permis que parce que le contrat le déclare).

## `getDebitAuthority`

- **Garde** : `humanBearer` (personne) ou `edgeMtls` (passerelle).
- **Rôle personne** : le contrat ne dit pas lesquels. Proposition à confirmer au plan : `OPERATOR_ADMIN` du prestataire du
  grand livre ; lecture `ORGANIZER_ADMIN` de l'événement. Ne rien élargir à un rôle de guichet. Écart à signaler : rôle non
  déclaré.
- **Passerelle** : lit uniquement le grand livre de son événement ; un autre `ledger_id` répond `404` neutre (déclaré).
- **Paramètres** : `ledger_id`, `X-Request-Id`, `Accept-Language`.
- **Codes déclarés** : `200` `DebitAuthorityState` ; `401` ; `404`.
- **Contenu** : `authority` (`CENTRAL` ou `EDGE`), `epoch`, `edge_gateway_id`, `edge_base_url` (nuls tous deux tant qu'aucune
  passerelle n'est désignée), `handover` (le handover ouvert, ou nul). `edge_base_url` = `edge_gateway.lan_url`.
- **Déjà déclaré** : exemple `EDGE` à l'époque 5 (6742). Pas d'effet de bord.

## `requestDebitAuthorityChange`

- **Garde** : `humanBearer` (le bloc `security` n'est pas répété, il hérite de la sécurité globale) ; **rôle**
  `OPERATOR_ADMIN` (texte de l'opération, 6758).
- **Corps** `DebitAuthorityChangeRequest` : `target` (`EDGE` ou `CENTRAL`), `reason` requis ; `edge_gateway_id`, `force`
  (défaut faux), `gateway_confirmed_offline` (vrai obligatoire si `force`).
- **Comportement par cas**
  - `target = EDGE` : `grant_edge_authority` sous verrou exclusif ; époque +1 ; filigrane = plus grand `posting.id` ;
    handover `GRANTED`. Réponse `202` avec `DebitAuthorityState` (`handover.state = GRANTED`). Refus `CL013` (`409
    HANDOVER_INVALID_STATE`) : passerelle absente, autre événement, `STANDBY`, révoquée, ou bascule déjà ouverte.
  - `target = CENTRAL`, `force = false` : `request_edge_release` ; le grand livre reste `EDGE` ; handover
    `RELEASE_REQUESTED`. Réponse `202`. Refus `409 HANDOVER_INVALID_STATE` si le handover `TO_EDGE` n'est pas `ACTIVE`.
  - bascule non accusée à abandonner : `fail_edge_grant` (`GRANTED` seulement) rend l'autorité au central ; l'époque
    augmente encore. Le contrat ne nomme pas de champ pour ce cas : il se déduit de `target = CENTRAL` sur un handover
    `GRANTED`. À figer dans les tests.
  - `force = true` : exige `gateway_confirmed_offline = true` et deux personnes ; l'appel crée une demande d'approbation
    `FORCE_CENTRAL_AUTHORITY` et répond `202` avec l'`ApprovalRequest` `PENDING`. Rien n'est exécuté. Une seconde personne
    `OPERATOR_ADMIN`, différente de l'appelant, l'approuve par `approveApprovalRequest` ; l'approbation appelle
    `force_central_authority`, révoque la passerelle et met le handover à `FORCED`. Pas de valideur dans le corps.
- **Codes déclarés** : `202` (`DebitAuthorityState` ou `ApprovalRequest`) ; `401` ; `403` ; `404` ; `409`.
- **Déjà déclaré** : exemple `202` en `GRANTED` (6805), en-tête `Idempotency-Replayed`.
- **Écart** : aucun `400` n'est déclaré. Un corps invalide (`target` hors énumération, `force` sans confirmation) répond
  par le code habituel `VALIDATION_FAILED` ; le contrat n'a pas la ligne `400` sur cette route. Ne pas inventer un autre
  statut ; signalé plus bas.

## `getCurrentEdgeHandover`

- **Garde** : `edgeMtls`. **Rôle de base (proposé)** : `cashless_edge`.
- **Paramètres** : `wait` entier 0 à 25, défaut 0 (secondes d'attente longue) ; `X-Request-Id`, `Accept-Language`.
- **Handover rendu (A13)** : UN seul, par priorité : le `TO_CENTRAL` ouvert (`RELEASE_REQUESTED`, `RELEASING`) l'emporte sur le `TO_EDGE ACTIVE` ouvert en même
  temps ; à défaut le dernier `TO_CENTRAL` `FAILED` du `TO_EDGE` actif (fenêtre bornée) ; à défaut le `TO_EDGE`. Le schéma `DebitAuthorityState` garde son objet
  `handover` unique.
- **Comportement** : rend immédiatement s'il existe un changement (accord, demande de rendu, échec, révocation) depuis le
  dernier état vu ; sinon attend jusqu'à `wait` secondes. Chaque appel met à jour `edge_gateway.last_seen_at` (battement
  de cœur, FR-005). Le réveil immédiat sur changement est requis par NFR-007 (accusé en 30 s) : une attente qui ne se
  réveille qu'au bout de 25 s ne tient pas le seuil. Mécanisme à fixer au plan (par exemple `LISTEN/NOTIFY`).
- **Codes déclarés** : `200` `DebitAuthorityState` (avec `handover: null` si rien) ; `401`. Un `404` n'est pas déclaré :
  une passerelle sans grand livre actif reçoit `200` avec l'état courant de son événement.
- **Déjà déclaré** : `last_seen_at` ; borne 25 s ; pas d'`Idempotency-Key`.
- **Passerelle `STANDBY`** : servie (elle doit pouvoir surveiller) ; elle ne reçoit jamais d'accord sans promotion.

## `ackEdgeHandover`

- **Garde** : `edgeMtls`, `cashless_edge`. Le handover doit appartenir à la passerelle appelante.
- **Corps** : `epoch`, `replicated_posting_id` (tous deux int64 requis).
- **Comportement** : `ack_edge_handover` ; le handover passe de `GRANTED` à `ACTIVE`, `last_replicated_posting_id` et
  `last_seen_at` sont écrits. La passerelle NE DOIT débiter qu'après la réponse `200`. **Idempotent (A17)** : un accusé répété sur un handover déjà `ACTIVE`
  de la même passerelle et de la même époque répond `200` avec l'état courant, sans écrire (la réponse `200` perdue dans le lien ne laisse pas la passerelle
  en `ARMED`). Le central refuse aussi (`409 EDGE_NOT_CAUGHT_UP`) tant que le curseur `after_change_seq` appliqué par la passerelle n'a pas atteint celui pris à
  l'accord (A03) : un blocage sans écriture comptable est donc livré avant l'accusé.
- **Refus** : handover qui n'est pas `GRANTED` : `409 HANDOVER_INVALID_STATE` (`CL013`) ; `replicated_posting_id` inférieur
  au filigrane : `409 EDGE_NOT_CAUGHT_UP` (`CL014`) ; `epoch` différente de celle du handover : `409
  STALE_AUTHORITY_EPOCH` (`CL015`). Un accusé incomplet ou sans valeur est refusé de la même façon (FR-006).
- **Codes déclarés** : `200` `DebitAuthorityState` (`ACTIVE`) ; `401` ; `409`. Ni `403`, ni `404` : un `handover_id` inconnu
  ou d'une autre passerelle répond `409 HANDOVER_INVALID_STATE`, comme un handover absent, sans révéler son existence.

## `releaseEdgeHandover`

- **Garde** : `edgeMtls`, `cashless_edge`.
- **Corps** : `epoch`, `final_edge_seq`, `last_chain_hash` (`Hex32`), `operations_count` (tous requis).
- **Comportement, dans cet ordre**
  1. à la réception, AVANT toute vérification, le handover passe à `RELEASING` (posé par l'API ; aucune fonction SQL ne le
     fait, `Handover.state` 14653 et description de l'opération). La table de transitions autorise aussi `RELEASE_REQUESTED` vers
     `COMPLETED` directement ; l'API ne l'emprunte jamais ;
  2. `complete_edge_release` vérifie l'époque (`CL015`), la continuité `1..final_edge_seq` (`CL014`, renvoie
     `missing_edge_seqs`), la chaîne et le nombre (`CL017`) ;
  3. si tout est bon : autorité `CENTRAL` (époque +1), handovers `COMPLETED`, réponse `200` avec `DebitAuthorityState`
     `authority = CENTRAL`.
- **Refus** : opérations manquantes, `409 EDGE_NOT_CAUGHT_UP` avec `missing_edge_seqs` (`Handover.missing_edge_seqs`
  existe) ; la passerelle reprend la vidange, le handover reste `RELEASING`. Chaîne différente : `409 CHAIN_BROKEN`
  (`CL017`), alerte, examen manuel. Handover ni `RELEASE_REQUESTED` ni `RELEASING` : `409 HANDOVER_INVALID_STATE`. Époque
  différente : `409 STALE_AUTHORITY_EPOCH`.
- **Codes déclarés** : `200` ; `401` ; `409`.
- **`operations_count`** (A05) : requis par le corps, mais `complete_edge_release` ne le reçoit pas. Le contrat ne définit pas la sémantique du champ ; l'exemple
  (4211 et 4211) correspond au premier cycle. Règle retenue et consignée : compte **par cycle**, `operations_count = final_edge_seq - edge_seq_at_activation`
  (valeur posée à l'accusé), car la numérotation et la chaîne de la passerelle ne repartent jamais de zéro ; écart : `409 CHAIN_BROKEN`. Contrôle qui renforce.
  Test : deux cycles consécutifs, puis un cycle après changement de rôle.

## `getEdgeReplicationFeed`

- **Garde** : `edgeMtls`, `cashless_edge`. Lecture seule, bornée à l'événement de la passerelle.
- **Paramètres** : `after_posting_id` requis (int64 >= 0) ; `limit` (1 à 200, défaut 50) ; `X-Request-Id`,
  `Accept-Language`. Ajout facultatif proposé : `after_change_seq` (voir `replication-page-additions.yaml`).
- **Contenu aujourd'hui** : `ledger_id`, `epoch`, `from_posting_id`, `to_posting_id` (borné à l'horizon des écritures validées, A18), `wallets[]` (`wallet_id`, `status`,
  `paid`, `promo`), `media[]` (`SnapshotEntry`, mots de passe et PACK chiffrés), `has_more`. Ajouts facultatifs : voir `replication-page-additions.yaml`, seul schéma du flux.
- **Garanties** : soldes servis exacts (les débits locaux de la passerelle ne dépassent jamais le solde réel ; une recharge espèces locale non rejouée est la seule
  exception, A09) ; reprise sans trou ni doublon par les curseurs ; un blocage, même sans écriture comptable, est publié par le journal `change_seq` en moins de 5 s
  au p95 (NFR-008) et refusé avant l'accusé de bascule s'il date d'avant l'accord (A03).
- **Jamais** : clé maître, PWD ou PACK en clair, empreinte de PIN (NFR-010).
- **Codes déclarés** : `200` ; `401` ; `409`. Le contrat ne dit pas quel `409` : aucun cas ne l'exige aujourd'hui ; ne pas en
  inventer.

## `submitEdgeSyncBatch`

- **Garde** : `edgeMtls`, `cashless_edge`. En-têtes : `Idempotency-Key` = `batch_id`.
- **Corps** `EdgeSyncBatch` : `batch_id`, `edge_gateway_id`, `ledger_id`, `epoch`, `edge_seq_from`, `edge_seq_to`,
  `prev_chain_hash`, `last_chain_hash`, `operations[]` (`EdgeSyncOperation`), `signature` requis ; `device_batches` pour les
  lots hors ligne relayés avec l'en-tête et la signature d'origine ; `staff_token_audit` facultatif (décision 18 : usages d'un jeton de personne expiré toléré,
  couverts par la signature du lot). Un lot `ABANDONED` ne se relit pas : le reste part sous un nouveau `batch_id` (A29).
- **Comportement** : au plus 500 opérations et 1 Mio, un lot en vol. Pour chaque opération, dans l'ordre : `record_edge_seq`
  (refuse hors ordre, `CL016` ; contenu différent pour un même `edge_seq`, `CL002`), puis écriture `EDGE_SYNC` avec
  `metadata.origin_key`, `origin_occurred_at`, `origin_mode` (`ONLINE_EDGE` ou `OFFLINE`) ; décision reprise de
  `edge_decision`, frais et commissions seuls recalculés ; clé déjà connue : `DUPLICATE`. Rejeu impossible d'une
  `ACTIVATION` ou d'un `DEPOSIT_CASH` : `REJECTED` / `EDGE_REPLAY_FAILED`, anomalie, espèces en `SUSPENSE`.
- **Refus** : `edge_seq_from` inattendu : `409 SEQ_OUT_OF_ORDER` ; chaîne rompue : `409 CHAIN_BROKEN` ; signature de passerelle
  ou d'origine invalide : `400 BATCH_SIGNATURE_INVALID` ; époque qui n'est pas celle de la passerelle : `409
  STALE_AUTHORITY_EPOCH`, sauf pendant la vidange `RELEASING` de cette même époque ; plus de 500 opérations ou 1 Mio : `413
  BATCH_TOO_LARGE`.
- **Codes déclarés** : `200` `OfflineBatchResult` ; `400` ; `401` ; `409` ; `413`.
- **Mise en garde** : une limite de corps de 100 ko répondrait `500` au lieu de `413` (OP-N95) ; relever la limite sur cette
  route seule.
- **`TOPUP_CASH`** : dans un lot de terminal il reste toujours `REJECTED OFFLINE_NOT_ALLOWED` (C-006) ; dans la file de la
  passerelle, il est rejoué avec `authorized_mode = EDGE_ONLINE`. Le texte de `OfflineOperationType` ne prévoit pas cette
  exception (signalé plus bas).

## Écarts constatés (rien n'est modifié, tout est à porter au plan ou au porteur)

1. `getDebitAuthority` : rôles de personne non déclarés (lecture). Proposition ci-dessus.
2. `requestDebitAuthorityChange` : pas de `400` déclaré ; pas de champ ni de cible nommant l'abandon d'une bascule non accusée
   (`fail_edge_grant`).
3. `ackEdgeHandover` et `releaseEdgeHandover` ne déclarent ni `403`, ni `404` : un handover étranger répond `409
   HANDOVER_INVALID_STATE`. NFR-011 attend « 401, 403 ou 404 sans fuite » : `409` uniforme sans fuite convient, à confirmer.
4. `getEdgeReplicationFeed` déclare `409` sans cause.
5. `DEBIT_AUTHORITY_MOVING` n'a pas de code `CL` ; le contrat ne le produit que pour les lots, le texte de `createPayment` et de
   `submitOfflineBatch` le prévoit aussi pendant `RELEASING` (côté passerelle).
6. `edgeMtls` cite `edge_gateway.public_key`, alors que le schéma porte `cert_sha256` ; le contrat ne dit ni quelle autorité
   émet, ni si l'on authentifie par clé ou par empreinte.
7. `EdgeSyncOperation.edge_decision` est « obligatoire » par description mais absent de `required` ; `chain_hash` désigne tantôt la
   chaîne du terminal, tantôt celle de la passerelle (exemples 14550 et 14623 : `60303a...` et `8a7b9c...`). À trancher au plan par vecteurs.
8. `operations_count` non vérifié par la fonction (désormais par cycle, A05) ; transition `RELEASE_REQUESTED` vers `COMPLETED` possible dans la table (refusée par l'enveloppe).
9. Hors `/edge/*`, à ne pas modifier : la fermeture d'une session de caisse (`closeCashSession`, `409 CONFLICT_STATE` déclaré
   pour d'autres causes) devra refuser tant que l'autorité est à la passerelle ou que la file n'est pas vide (décision 6 du
   contexte). C'est un comportement de route publique : déjà décidé par le porteur, à lui rappeler au moment du codage.
