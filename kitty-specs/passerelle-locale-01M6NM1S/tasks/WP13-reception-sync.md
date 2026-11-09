---
work_package_id: WP13
title: 'Réception EDGE_SYNC : lots de la passerelle'
dependencies: [WP02, WP10]
requirement_refs:
- FR-017
- FR-018
- FR-019
- FR-020
- FR-025
- FR-036
- FR-038
- NFR-003
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T057, T058, T059, T060, T061, T062]
phase: Phase 3 - API du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/edge/sync/
create_intent: [apps/api/src/edge/sync/edge-sync.controller.ts, apps/api/src/edge/sync/edge-sync.service.ts, apps/api/src/edge/sync/edge-sync-body.ts, apps/api/src/edge/sync/edge-sync-signature.ts, apps/api/src/edge/sync/edge-sync-chain.ts, apps/api/src/edge/sync/edge-sync.writer.ts, apps/api/src/edge/sync/edge-sync-dispatch.ts, apps/api/src/edge/sync/tap-proof.port.ts, apps/api/src/edge/sync/device-batches.verifier.ts, apps/api/src/edge/sync/staff-token-audit.ts, apps/api/src/edge/sync/edge-sync.module.ts, apps/api/test/integration/edge/sync/sync-batch-intake.spec.ts, apps/api/test/integration/edge/sync/sync-chain-order.spec.ts, apps/api/test/integration/edge/sync/sync-writer.spec.ts, apps/api/test/integration/edge/sync/sync-tap-proof.spec.ts, apps/api/test/integration/edge/sync/sync-device-batches.spec.ts, apps/api/test/integration/edge/sync/sync-audit-abandon.spec.ts, apps/api/test/integration/edge/sync/sync-replay-hundred.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/edge/sync/**, apps/api/test/integration/edge/sync/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP13 : Réception EDGE_SYNC

## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte (`docs/passation-8/contexte-m8.md`, décisions 4, 5, 13, 14, 18), ce prompt, puis seulement :

- `contracts/interfaces.md` § 2 (WP05 : `edge_sync_batch_begin`, `_result`, `_finish`, `edge_record_seq` ; WP06 et WP07 : les quatre enveloppes d'écriture ; WP08 : `edge_record_staff_token_audit`), § 5 (`edgeContent`,
  `edgeContentSha256`, `edgeChainGenesis`, `chainStep`, `batchSigningPayload`), § 7, § 11 ;
- `contracts/edge-routes.md` : `submitEdgeSyncBatch` (en entier), « Erreurs de bascule » ; `contracts/replication-page-additions.yaml` : propriété `staff_token_audit` d'`EdgeSyncBatch` ;
- `research.md` **R-08** (table d'idempotence, traitement, `ABANDONED`), **R-09** (enveloppe, `CL007`, risque résiduel), **R-10**, **R-12** (contenu haché, chaîne, sens de `chain_hash`), **R-13** (signature du lot) ;
  `data-model.md` A.4, A.4 bis, A.5, A.6, A.7 ; `packages/contracts/openapi.yaml` schémas `EdgeSyncOperation` (l. 14416) et `EdgeSyncBatch` (l. 14485) ;
- constats `A05`, `A06`, `A07`, `A08`, `A10`, `A29` de `docs/passation-8/rapports/plan-adversarial.md` ;
- code existant à imiter, pas à copier : `apps/api/src/offline/batches/` (`batch-body.ts`, `batch-intake.ts`, `batch-runner.ts`, `batch-chain.ts`, `offline-batches.controller.ts`, `offline-batches.service.ts`),
  `offline/processing/` (`offline-sale.writer.ts`, `offline-reversal.writer.ts`, `offline-operation.processor.ts`), `payments/chained-content.ts` (déplacé par WP02 vers `@cashless/shared-rules`),
  `ledger/ledger-engine.service.ts` (frais et commissions), `apps/api/src/edge/identity/` (WP10).

## Objectif

Recevoir `POST /edge/sync-batches` : valider le lot, le rejouer **dans l'ordre**, opération par opération, **sans double écriture**, par les enveloppes SQL `edge_*` seules. Le central ne recalcule pas la décision de
la passerelle (`edge_decision`) : il la **reprend** et ne recalcule que frais et commissions. Un seul lot en vol par passerelle, 100 rejeux d'un même lot donnent une écriture.

## Branch Strategy

- Branche de planification : `feat/passerelle-locale`. Branche de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane selon `kitty-specs/passerelle-locale-01M6NM1S/lanes.json`.

## Commande d'implémentation

```bash
LC_ALL=C LANG=C spec-kitty agent action implement WP13 --agent claude --mission passerelle-locale-01M6NM1S
```

## Règles du lot

- Tu ne lances ni Jest, ni pgTAP, ni `reset-db`. Tu ne commites pas. Tu ne touches pas à l'API du port 80. Aucune migration, aucun `GRANT`, aucun `.sql` généré. Lignes de 100 caractères, français, sans tiret cadratin.
- Le processus `edge` n'a **aucun port de clé** et n'exécute ni `post_transaction`, ni `record_edge_seq` brute : uniquement les enveloppes de `interfaces.md` § 2.
- Toute fonction partagée vient de `@cashless/shared-rules` (WP02). Tu n'en recopies aucune. Si une fonction attendue manque, arrête-toi et signale.
- Hors carte : `apps/api/src/processes/bootstrap.ts` (monter la lecture de corps de la route avant l'analyseur global, ligne dans le rapport), `apps/api/src/processes/edge.module.ts` (import du module). Rien d'autre sans accord.
- Un écart qui affaiblit la sécurité (borne retirée, vérification reportée) s'arrête et remonte au porteur (CLAUDE.md, règle 1).

## T057 : Réception, corps, signature, idempotence, un lot en vol

**But.** Le contrôleur lit le corps lui-même (comme `batch-body.ts`) : limite **1 Mio** sur cette route seule, garde les octets bruts, ne fait aucun `JSON.parse` avant le contrôle de taille. La limite globale de 100 ko
répondrait `500` au lieu de `413` (OP-N95, `edge-routes.md`). Fichier : `edge-sync-body.ts`, monté par `bootstrap.ts` pour le seul chemin `/edge/sync-batches` (méthode `POST`).

**Ordre des contrôles, un échec arrête tout, avant toute écriture.**
1. Taille : plus de 1 Mio ou plus de 500 opérations : `413 BATCH_TOO_LARGE`. Avant tout `JSON.parse`.
2. Forme : schéma généré `EdgeSyncBatch` ; `edge_gateway_id` et `ledger_id` du corps **égaux à ceux de la garde** (sinon `409 HANDOVER_INVALID_STATE`, jamais « autre passerelle »).
3. `Idempotency-Key` = `batch_id`.
4. **Signature de la passerelle** : ECDSA P-256 / SHA-256 sur `batchSigningPayload(lot)` (JCS du lot sans `signature`), clé `edge_gateway.public_key` lue en base. Invalide : `400 BATCH_SIGNATURE_INVALID`, lot **non traité**, alerte (`edge-sync-signature.ts`).
5. `edge_sync_batch_begin(gateway, batch, epoch, from, to, request_sha256)` : `request_sha256` est l'empreinte JCS du corps sans signature. Même `batch_id` et même empreinte : résultats mémorisés. Autre empreinte :
   `IDEMPOTENCY_KEY_REUSED` (422 par la table d'erreurs existante). Un autre lot en vol : `CL010` (`BATCH_IN_PROGRESS`).
6. Époque : celle de la passerelle. Autre : `409 STALE_AUTHORITY_EPOCH`, **sauf** pendant le rendu `RELEASING` de cette même époque (vidange admise ; la fonction SQL l'établit, ne la recode pas).
7. `edge_seq_from` : le suivant attendu. Sinon `409 SEQ_OUT_OF_ORDER`.

**Arbitrages.**
- Un lot dont tous les résultats existent déjà est répondu depuis la mémoire (`already_done`), sans toucher au grand livre. Test : rejeu 100 fois, une écriture.
- Reprise après arrêt du central en plein lot : reprise à la première opération sans résultat (même chaîne de reprise que la mission 7). Test avec un arrêt simulé entre deux opérations.
- Réponse `200` `OfflineBatchResult` (réutilise le mapper de la mission 7 sans le modifier ; si ses champs ne conviennent pas, écris un mapper local).

## T058 : Recalcul de `content_sha256` et de la chaîne, ordre

**But.** Le central ne croit pas la chaîne de la passerelle : il la recalcule (`edge-sync-chain.ts`).
- Pour chaque opération : `content_sha256 = edgeContentSha256(op)`, puis `chain(n) = chainStep(chain(n-1), content_sha256(n))` depuis `prev_chain_hash` du lot, vérifié égal à la dernière chaîne enregistrée de la passerelle
  (ou `edgeChainGenesis(gatewayId)` pour la première). `last_chain_hash` du lot doit égaler le dernier maillon recalculé. Désaccord : `409 CHAIN_BROKEN`, alerte `EDGE_CHAIN_BROKEN`, lot non traité.
- `chain_hash` d'une opération `EDGE_ONLINE` désigne la chaîne de la passerelle ; pour `DEVICE_OFFLINE`, le maillon du terminal (R-12). Ne les confonds pas.
- Numéros : continus de `edge_seq_from` à `edge_seq_to`, sans trou ni doublon dans le lot ; `edge_seq` entier sûr (≤ 2^53 - 1), sinon `422 VALIDATION_FAILED`.
- Passe `p_content = edgeContentSha256(op)` à chaque enveloppe (elles attendent l'empreinte déjà faite). Même `edge_seq` avec un contenu différent : `CL002`, jamais une écriture.

## T059 : Écrivain : envoi vers l'enveloppe par type

**But.** `edge-sync-dispatch.ts` choisit l'enveloppe ; `edge-sync.writer.ts` construit `p_op` et `p_fee_lines`. **Une seule transaction par opération** : l'enveloppe écrit l'opération ET appelle `record_edge_seq`.

| Type de l'opération | Enveloppe | Remarque |
|---|---|---|
| `PURCHASE`, `REVERSAL`, relayés `DEVICE_OFFLINE` | `edge_post_transaction` | `p_fee_lines` : frais et commissions **recalculés** ici ; le reste vient de `edge_decision` |
| `ACTIVATION` | `edge_activate_media` | clé d'origine `<serial>:<seq>` |
| `DEPOSIT_CASH` | `edge_take_deposit` | compte de caisse **jamais** lu de la requête |
| `TOPUP_CASH` | `edge_topup_cash` | jamais rejetée pour un plafond (deux parts, anomalie) |
| `VOID` | `edge_record_seq` seule, issue `VOID` | numéro consommé sans effet comptable |
| `ONLINE_REF` | **non reçu d'une passerelle** : `MALFORMED_OPERATION` | un terminal seul envoie `ONLINE_REF` |

**Arbitrages.**
- `edge_decision` absente pour un type qui porte un montant : `REJECTED` / `MALFORMED_OPERATION`, jamais devinée (R-09). Décision incohérente (`charged_to_wallet + shortfall_amount <> amount`, négatif, raison absente) : même rejet.
- Frais et commissions : seuls recalculés, par les fonctions du moteur existant (`ledger-engine.service.ts`, mêmes règles qu'en ligne, via le paquet partagé). Pas de seconde copie de règle.
- `origin_key` = `Idempotency-Key` du terminal `<serial>:<seq>` pour **toutes** les opérations, guichet compris (A10) ; la caution d'une activation porte `<serial>:<seq>#deposit`. `edge_seq` ne sert qu'à l'ordre.
  Clé déjà connue (y compris dans le registre d'idempotence de la route en ligne) : `DUPLICATE`.
- `CL007` ne doit pas survenir (verrou de compte, A06). Si elle survient, la transaction est annulée **en entier**, rejouée **une fois**, puis une seconde transaction enregistre le numéro par `record_edge_seq` avec
  `REJECTED` / `INSUFFICIENT_FUNDS_RETRY` (`retryable: true`) et une anomalie. **Le vidage ne se bloque jamais** et un numéro n'est jamais consommé sans résultat. Test avec une injection de `CL007`.
- Rejeu impossible (`ACTIVATION`, `DEPOSIT_CASH`) : `REJECTED` / `EDGE_REPLAY_FAILED`, anomalie, aucune écriture de transaction : c'est l'enveloppe SQL qui le décide.
- Jamais d'autre grand livre que celui du handover ; jamais un `ledger_id` pris du corps pour écrire.

## T060 : Preuve du bracelet au rejeu (A07, décision 13)

**But.** Pour `PURCHASE` et `REVERSAL` de mode `EDGE_ONLINE`, l'opération doit porter l'objet `tap` : compteur strictement supérieur au dernier compteur du bracelet connu du central, UID égal à celui du bracelet,
signature de passage valide, `token_hash` égal au portefeuille débité. Compteur, UID et `token_hash` se contrôlent **en SQL** dans `edge_post_transaction` (A.4 bis, point 6). La **vérification de la signature de passage** exige du matériel de
clé que le central détient et que le processus `edge` n'a pas.

**Point à régler avant de coder.** `interfaces.md` ne nomme aucun port ni route pour cette vérification (voir « Contradictions »). Marche à suivre :
1. Regarde ce que fait `register_tap` (schéma, `p_signature`) et `offline-operation.processor.ts` / `compliance-input.reader.ts` pour un lot hors ligne de la mission 7 : si la signature se vérifie **en SQL** avec des données
   que `cashless_edge` peut atteindre par l'enveloppe, appelle l'enveloppe et n'ajoute rien.
2. Sinon, crée un port `TAP_PROOF_VERIFIER` (`tap-proof.port.ts`) dont l'adaptateur appelle le processus des clés par son interface existante. **Ne donne jamais de clé de bracelet au processus `edge`**, n'importe pas `KmsModule`. Un faux
   de test est `isFake = true`, refusé en production (ajoute-le à `assertProcessIsSafe`, ligne dans le rapport), et un test le prouve.
3. Si ni 1 ni 2 n'est possible sans toucher un fichier hors carte ou élargir un droit : **arrête-toi sur T060 et signale-le au porteur**. Ne reporte pas la vérification, ne la saute pas : c'est un affaiblissement (règle 1).

Opération sans `tap` valide : `REJECTED` / `MALFORMED_OPERATION`, `detail` précis, anomalie `NON_COMPLIANT_OPERATION` ; **le numéro reste consommé** par `record_edge_seq` avec l'issue `REJECTED` (le vidage ne se bloque pas).

## T061 : Lots de terminal relayés (`DEVICE_OFFLINE`)

**But.** Les opérations `DEVICE_OFFLINE` s'accompagnent de `device_batches` (en-tête et signature d'**origine** du lot du terminal). `device-batches.verifier.ts` : pour chaque `device_batch_id` cité,
(a) signature de l'en-tête avec `device.public_key` du terminal **de ce grand livre** (sinon `400 BATCH_SIGNATURE_INVALID`) ; (b) chaîne du terminal recalculée jusqu'à `header.last_chain_hash` avec les fonctions pures de `@cashless/shared-rules`
(sinon `409 CHAIN_BROKEN`) ; (c) toute opération `DEVICE_OFFLINE` référence un `device_batch_id` présent, du même terminal que `device_serial`. Aucune signature par opération n'existe : le terminal signe l'en-tête.

**Cas limites.** Un terminal révoqué ou d'un autre événement : refus uniforme. `TOPUP_CASH` d'un lot de terminal relayé : `REJECTED` / `OFFLINE_NOT_ALLOWED` (C-006), alors que dans la file de la passerelle il est rejoué. Un lot relayé puis renvoyé
directement par le terminal : un seul effet, `DUPLICATE` à la seconde arrivée (clé d'origine identique).

## T062 : `staff_token_audit`, lot abandonné

**But.** `staff-token-audit.ts` : si le lot porte `staff_token_audit`, vérifie que chaque ligne désigne une opération du lot (intervalle `edge_seq_from..edge_seq_to`), que le tout est couvert par la signature du lot (il l'est :
la propriété est dans le JCS signé), puis appelle `edge_record_staff_token_audit(gateway, batch, rows)` (audit `EDGE_STAFF_TOKEN_TOLERATED`). Une ligne hors intervalle : refus, rien d'écrit.
**Lot `ABANDONED`** (traitement interrompu plus de 15 min) : ses résultats sont partiels ; la passerelle renvoie le reste sous un **nouveau `batch_id`** avec `edge_seq_from` = premier numéro non enregistré. Le central ne rend pas un lot abandonné comme
terminé et accepte la reprise.

## Tests attendus

Dans `apps/api/test/integration/edge/sync/` (l'orchestrateur les lance) :

- `sync-batch-intake.spec.ts` : 501 opérations et 1 Mio + 1 : `413` ; signature altérée d'un octet : `400`, rien d'écrit ; `edge_gateway_id` du corps différent de la garde ; empreinte différente pour le même `batch_id` ; second lot en vol ;
  époque d'avant : `409 STALE_AUTHORITY_EPOCH`, mais admise pendant `RELEASING` de la même époque ; corps de 200 ko accepté (pas de `500`).
- `sync-chain-order.spec.ts` : `edge_seq_from` inattendu : `409 SEQ_OUT_OF_ORDER` ; chaîne altérée : `409 CHAIN_BROKEN` + alerte ; vecteurs de `apps/api/test/fixtures/edge-vectors/vectors.json` (cas a à j) donnent les mêmes empreintes que le central ; même
  `edge_seq`, contenu différent : refusé.
- `sync-writer.spec.ts` : un cas par type du tableau ; `edge_decision` reprise telle quelle, seuls frais et commissions recalculés (modifier la décision change l'écriture, modifier un frais dans la requête ne change rien) ; décision incohérente ; `CL007`
  injectée : rejeu unique puis `INSUFFICIENT_FUNDS_RETRY`, le vidage continue ; `REVERSAL` d'une vente rognée (A08) ne crédite pas plus que `charged_to_wallet` écrit ; clé déjà connue en ligne : `DUPLICATE` ; caution `#deposit`.
- `sync-tap-proof.spec.ts` : vente sans `tap`, compteur non croissant, UID différent, `token_hash` d'un autre portefeuille, signature fausse : `REJECTED` / `MALFORMED_OPERATION` avec anomalie, numéro consommé ; vente avec preuve valide : acceptée ; plafond par vente et par
  terminal par heure : part au-delà en `S-ATTENTE` avec alerte (la valeur du plafond vient du réglage de plateforme, WP06) ; scénario hostile de 2 000 ventes fictives : perte mesurée sous le plafond.
- `sync-device-batches.spec.ts` : signature d'origine fausse, chaîne du terminal rompue, terminal d'un autre événement, `device_batch_id` absent ; `TOPUP_CASH` relayé rejeté ; relais puis envoi direct : un effet.
- `sync-audit-abandon.spec.ts` : audit toléré écrit ; ligne hors intervalle refusée ; lot abandonné puis reprise sous un autre `batch_id`.
- `sync-replay-hundred.spec.ts` : 100 rejeux du même lot, en série puis 10 en parallèle : une seule écriture par opération, mêmes réponses.

Chaque test doit échouer sur une implémentation fausse (une fonction qui fait confiance au `last_chain_hash` du lot, qui lit un compte de caisse du corps, ou qui n'a qu'un `INSERT ... ON CONFLICT` sans registre doit être rouge).

## Décisions du porteur du 09/11/2026 (font foi sur ce prompt)

Source : `docs/passation-8/contexte-m8.md`, décisions 19 à 31, et les notes adressées à ce lot dans
`docs/passation-8/suivi-lots.md` (à lire en entier pour ce lot).

- Décision 26 : les frais d'une vente reçue sont recalculés par le moteur central (règle active, bonne portée, bonne
  période, bon payeur) et passés en `p_fee_lines` ; les frais annoncés par la passerelle sont ignorés. Test hostile : la
  passerelle cite la règle la plus généreuse de l'opérateur, le central applique la bonne.
- Décision 33 (ADR-169, accord du porteur pour toucher le contrat) : retouche hors carte de `packages/contracts/openapi.yaml`,
  `generated/**`, `dart/**` et `tools/contract-stability/contract-baseline.json` : champ facultatif sous `/edge/*` (dans
  le corps du lot ou à côté de `staff_token_audit`) pour les ordres locaux à deux personnes (`LOCAL_UNSTALE`, purge
  manuelle : type, gateway_id, détenteurs, horodatage, empreinte de l'ordre signé) ; le central les verse à son audit ;
  un lot sans le champ reste accepté ; `npm run check:stability` vert avec la ligne de décision de l'ADR-169.
- Relecture de WP08 : rejouer sur `40001` (`reference_applied_seq`) et `23505` (REPEATABLE READ). Relecture de WP07
  (M2) : clé d'origine déjà au registre sous un autre numéro (`23505` après écriture) : la passerelle ne doit pas rester
  bloquée sur ce numéro.

## Sécurité

- Fichiers à faire relire par une personne : `edge-sync.service.ts`, `edge-sync-signature.ts`, `edge-sync.writer.ts`, `tap-proof.port.ts` (s'il existe). L'agent qui écrit n'est pas une relecture indépendante.
- Aucune clé de bracelet, aucune clé maître dans le processus `edge`. Aucune valeur de signature ni contenu d'opération complet dans les journaux (identifiants et compteurs seulement).
- Rien n'est écrit avant que signature, chaîne et ordre du lot soient vérifiés.
- Un montant, un compte, un grand livre, un compte de caisse ne se lisent jamais de la requête quand la base les connaît.

## Definition of Done

- [ ] `POST /edge/sync-batches` : 1 Mio, signature, idempotence, un lot en vol.
- [ ] Chaîne recalculée avec les fonctions partagées et les vecteurs ; ordre strict.
- [ ] Un envoi par type vers l'enveloppe, une transaction par opération, `CL007` traitée sans blocage.
- [ ] Preuve du bracelet vérifiée (ou point T060 signalé au porteur).
- [ ] Lots relayés vérifiés ; audit toléré versé ; lot abandonné repris.
- [ ] 100 rejeux, une écriture.
- [ ] Hors carte listé ; fichiers à relire nommés.

## Ce que le relecteur doit casser

- Envoyer un lot dont `last_chain_hash` est faux mais cohérent avec un `prev_chain_hash` falsifié.
- Rejouer le même lot avec une opération modifiée, et avec une signature recalculée par une autre clé de passerelle du même événement.
- Inverser deux opérations ; sauter un numéro ; envoyer `edge_seq` 2^53.
- Mettre dans `edge_guichet` un compte de caisse d'une autre session ; dans `tap` le `token_hash` d'un autre portefeuille.
- Interrompre le central entre deux opérations (arrêt du processus) puis rejouer.
- Chercher un `INSERT` direct, un appel à `post_transaction`, un import du KMS dans `apps/api/src/edge/sync/**`.

## Contradictions relevées entre les sources (aucune n'est corrigée ici)

- `data-model.md` A.4 bis (6) et `tasks.md` T060 disent « vérifiée par le processus des clés » ; **aucune interface** (port, route, fonction) de `interfaces.md` n'en décrit le mécanisme. Voir T060 : à trancher par l'orchestrateur ou le porteur.
- `tasks.md` T059 « envoi par type » ne dit rien du type `DEVICE_OFFLINE` ni de `VOID` ; ici : `edge_post_transaction` avec `origin_mode = OFFLINE`, et `edge_record_seq` seule pour `VOID`. À confirmer avec WP05 et WP06.
- `research.md` R-09 donne à `edge_post_transaction` une signature à plusieurs paramètres (`p_media`, `p_amount`, `p_type`, `p_decision`) ; `interfaces.md` § 2 : `p_op jsonb`. **`interfaces.md` fait foi.**
- `research.md` R-08 situe la table des lots en `0059` ; `interfaces.md` § 1 : `0060`. **`interfaces.md` fait foi.**
- `tasks.md` donne à WP13 les fichiers de `edge/sync/**` seulement, mais la lecture de corps à 1 Mio doit être montée par `bootstrap.ts` (hors carte, § 11).
