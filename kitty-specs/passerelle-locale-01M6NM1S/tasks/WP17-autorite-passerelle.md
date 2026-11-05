---
work_package_id: WP17
title: 'Autorité sur la passerelle : client du central, machine à états, époques'
dependencies: [WP16]
requirement_refs:
- FR-006
- FR-012
- FR-021
- FR-023
- C-004
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
subtasks: [T075, T076, T077, T078, T079, T119]
phase: Phase 4 - Passerelle
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/gateway/src/authority/
create_intent: [apps/gateway/src/central-client/central-client.ts, apps/gateway/src/central-client/central-errors.ts, apps/gateway/src/central-client/central-client.module.ts, apps/gateway/src/authority/authority.service.ts, apps/gateway/src/authority/authority-transitions.ts, apps/gateway/src/authority/control-channel.ts, apps/gateway/src/authority/site-order.ts, apps/gateway/src/authority/authority.module.ts, apps/gateway/test/authority/authority-states.spec.ts, apps/gateway/test/authority/restart-cases.spec.ts, apps/gateway/test/authority/epochs.spec.ts, apps/gateway/test/authority/local-unstale.spec.ts, apps/gateway/test/authority/central-client.spec.ts, apps/gateway/src/admin/local-orders.controller.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/gateway/src/central-client/**, apps/gateway/src/authority/**, apps/gateway/test/authority/**, apps/gateway/src/admin/**]
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP17 – Autorité sur la passerelle

> **Corrections après analyse** : `contracts/interfaces.md` § 12.13 et § 13.3 : le format de l'ordre à deux personnes EST fixé, ignore toute mention contraire. T119 : écouteur local et `registerOrderHandler`, tests (liaison hors boucle locale refusée, une signature refusée, deux fois la même clé refusée, ordre expiré, nonce rejoué, refus si le central a confirmé l'époque). § 13.9 pour le rattrapage.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role :
implementer / Agent : claude).
Lis ensuite la fiche de contexte, ce prompt, puis seulement :

- `contracts/interfaces.md` § 4 (`AUTHORITY`), § 7 (correspondance des erreurs, lignes passerelle),
  § 10 (`onHandover`, `observeEpoch`), § 8 ;
- `data-model.md` B.1 (`edge_authority`), B.7 (invariants 3 et 4), **B.8 en entier** (diagramme et
  tableau « persisté avant ») ;
- `research.md` R-15, **R-16 en entier** (A12, A13, `STANDBY`), R-17 (côté passerelle) ;
- `contracts/edge-routes.md` (codes des cinq routes `/edge/*` que le client appelle) ;
  `contracts/gateway-served-operations.md`, section « Comportements communs » ;
- `docs/passation-8/rapports/plan-adversarial.md` A12, A13, A17 ; `docs/passation-8/contexte-m8.md`
  décisions 4, 9, 15.

Code produit par WP16 que tu utilises : `GatewayTx`, `GatewayClock`, `failpoints`, tables
`edge_authority`, `edge_authority_transition`, `edge_audit`. Priorité des sources : SPECIFICATION
§0.3 ;
une contradiction se signale. Écart de sécurité : jamais en silence.

## Objective

Garantir qu'**une seule autorité débite**, y compris après un redémarrage, une époque forgée ou un
rendu qui échoue. Ce lot fournit le client HTTPS mTLS vers le central, la machine à états persistée,
le canal de contrôle (attente longue), l'accusé idempotent, `observeEpoch` (A12) et la levée locale
de `STALE` à deux personnes. Il ne sert aucune route de terminal.

## Branch Strategy

Planification `feat/passerelle-locale`, cible `feat/passerelle-locale`, worktree alloué par lane
selon `lanes.json`.

## Commande

`spec-kitty agent action implement WP17 --agent claude --mission passerelle-locale-01M6NM1S`
(précédée de `LC_ALL=C LANG=C`).

Rappels : ni Jest, ni pgTAP, ni `reset-db` (l'orchestrateur, en série) ; pas de commit ; ne touche
pas au port 80 ; aucune migration sans `REVOKE ALL ... FROM PUBLIC` ; si une table manque dans
`edge-0001`,
signale-le (migration `edge-0002` seulement avec accord de l'orchestrateur) ; un écart qui affaiblit
la sécurité s'arrête et remonte au porteur.

## T075 – Client du central en mTLS

**But** : un seul point d'appel vers le central, typé, avec les erreurs du contrat.

- `central-client.ts` : `node:https` (pas de bibliothèque nouvelle), certificat client
  `GATEWAY_CENTRAL_CLIENT_CERT_FILE` / `_KEY_FILE`, autorité du central épinglée par le fichier
  d'enrôlement (`GATEWAY_ENROLLMENT_FILE`), adresse `GATEWAY_CENTRAL_URL`. Méthodes (noms des
  `operationId`) : `getCurrentEdgeHandover(wait)`, `ackEdgeHandover`, `releaseEdgeHandover`,
  `getEdgeReplicationFeed` (WP18 l'utilise), `submitEdgeSyncBatch` (WP20 l'utilise). Délais
  explicites, annulables (`AbortSignal`), jamais de nouvelle tentative implicite sur un `POST` : la
  reprise est du ressort de l'appelant (idempotence par identifiants).
- À chaque réponse (succès ou erreur HTTP, pas une erreur réseau) : en-tête `Date` donné à
  `GatewayClock.observeCentral`. C'est la seule mesure d'heure centrale (R-14).
- `central-errors.ts` : erreurs typées pour `HANDOVER_INVALID_STATE`, `EDGE_NOT_CAUGHT_UP` (avec
  `missing_edge_seqs`), `STALE_AUTHORITY_EPOCH`, `SEQ_OUT_OF_ORDER`, `CHAIN_BROKEN`,
  `BATCH_SIGNATURE_INVALID`, `403`/`401` du certificat (la passerelle est révoquée : état `REVOKED`,
  voir T076). Un code inconnu n'est jamais transformé en succès.
- Le lien traverse le relais de test en banc (`GATEWAY_CENTRAL_URL` pointe sur lui) : le client ne
  suppose rien sur l'adresse du central.

**Cas limites** : réponse tronquée ; connexion coupée pendant une attente longue (reprise sans état
perdu) ; certificat du central différent de l'épinglage (refus, jamais de repli en clair).

## T076 – Machine à états, table de transitions, persistance avant action

**But** : `AuthorityService` (`interfaces.md` § 4 et § 10) : `state()`,
`assertCanDebit(requestEpoch)`, `onHandover(h)`, `observeEpoch(epoch, source)`.

- États : `STANDBY`, `ARMED`, `GRANTED_PENDING`, `ACTIVE`, `RELEASING`, `RELEASED`, `STALE`,
  `REVOKED` ; transitions **exactement** celles de B.8, centralisées dans `authority-transitions.ts`
  et alignées sur la table `edge_authority_transition` de WP16 (un test compare les deux).
- **Persisté (commit) avant d'agir**, pour chaque ligne du tableau B.8. `RELEASING` est commité
  **avant** de cesser de débiter et de refuser les lots (invariant B.7-4, point d'arrêt
  `after-releasing-persisted`).
- `assertCanDebit(requestEpoch)` s'exécute **dans la transaction de l'opération** (WP20, WP21, WP22
  l'appellent avec la leur) et lit `edge_authority` `FOR SHARE`. Il lève, sans rien écrire :
  `DEBIT_AUTHORITY_MOVING` (`GRANTED_PENDING`, `RELEASING`), `STALE_AUTHORITY_EPOCH` (`STALE`,
  `epoch < highest_epoch_seen`, ou en-tête différent de l'époque détenue quand la route le déclare),
  `CONFLICT_STATE` détail `GATEWAY_NOT_AUTHORITY` (`ARMED`, `STANDBY`), refus de revocation
  (`REVOKED`, traité comme `STALE`), `DEBIT_AUTHORITY_EDGE` n'est **pas** levé ici (propre aux
  opérations indisponibles, WP21 et WP22). La correspondance exacte est le tableau « Comportements
  communs » et `interfaces.md` § 7.
- Accord vu (`GRANTED`) : `GRANTED_PENDING` (handover, époque, filigrane), aucun débit. Accusé `200`
  reçu ou répété (A17) : écrire `ACTIVE`, `activated_at` (heure **centrale** lue du handover),
  `edge_seq_at_activation`, `token_tolerance_until = activated_at + 12 h`, jamais prolongée. Si
  `GatewayClock.refusesAck()` : n'envoie pas l'accusé, reste `ARMED`, alerte (A14).
- Rôle `STANDBY` : lu à chaque passe du flux (`reference.gateway.role`, WP18 appelle
  `onRoleChanged`) ; `STANDBY -> ARMED` sur promotion. Aucun accord n'est jamais accepté en
  `STANDBY`.
- **Démarrage** : `recover()` relit `edge_authority` et le handover courant
  (`get_current_edge_handover`, A13) et rejoue les **quatre cas** : redémarrage pendant `RELEASING`,
  avec `RELEASE_REQUESTED` toujours ouvert (reste `RELEASING`), avec `FAILED` de même époque (retour
  `ACTIVE`), avec `COMPLETED` (`RELEASED` puis `ARMED`). Entre `200` et écriture d'`ACTIVE` :
  `GRANTED_PENDING` + handover vu `ACTIVE` de même époque + curseur au filigrane donne `ACTIVE` sans
  nouvel accusé. Cas inconnu : reste en état sûr (aucun débit) et alerte.
- Certificat refusé par le central : `REVOKED`, persistant, alerte locale.

## T077 – Canal de contrôle, accusé idempotent, reprise après arrêt

- `control-channel.ts` : boucle `getCurrentEdgeHandover?wait=25` relancée aussitôt, interruptible.
  Chaque changement passe par `onHandover` qui **persiste d'abord** puis agit. Le réveil immédiat
  est du côté central (R-17) ; ici, aucun `sleep` de sondage. Sur erreur réseau : attente bornée
  croissante (plafond 5 s), `link_state` passe à `ISOLATED` après 25 s sans échange réussi,
  `CATCHING_UP` au retour tant que la file n'est pas vide (la file est lue via une interface en
  lecture seule fournie par WP20, définie ici comme `QueueProbe { isEmpty(): Promise<boolean> }`,
  jamais d'import de `queue/**`).
- Accusé : `ackEdgeHandover` seulement quand `ReplicationService.catchUpTo(watermark)` (WP18) est
  revenu ; ce lot consomme l'interface `catchUpTo` via un jeton d'injection `REPLICATION_CATCH_UP`
  (fabrique vide tant que WP18 n'est pas là, et un test qui échoue si l'accusé part sans lui). `409
  EDGE_NOT_CAUGHT_UP` : demande à WP18 de reprendre depuis `missing_edge_seqs`.
- Rendu : `RELEASE_REQUESTED` vu -> `RELEASING` persisté -> signal à WP20 (`DrainService`) -> file
  vide et `acked_*` vérifiés -> `releaseEdgeHandover(final_edge_seq, last_chain_hash,
  operations_count)`. `operations_count = final_edge_seq - edge_seq_at_activation` (A05, **pas**
  `final_edge_seq`) ; test sur deux cycles. `200` : `RELEASED`, `highest_epoch_seen = e + 2`, puis
  `ARMED`.
- Reprise : tout état est relu en base au démarrage ; une opération de contrôle reçue deux fois
  (accusé, rendu) a le même effet que reçue une fois.

## T078 – `observeEpoch` (A12) et levée locale à deux personnes

- `observeEpoch(epoch, 'central')` (long-polling, source fiable) : `epoch > époque détenue` persiste
  `STALE` et `highest_epoch_seen`. `observeEpoch(epoch, 'request')` (en-tête d'un terminal) :
  persiste `STALE` **seulement si** l'époque est confirmée par le canal de contrôle ou **plausible**
  (`<= epoch + 2`). Sinon : `unconfirmed_epoch_seen`, ligne d'audit `STALE_EPOCH_UNCONFIRMED`,
  alerte, **aucun arrêt de débit**, et la requête reçoit `409 STALE_AUTHORITY_EPOCH` pour elle
  seule. Test avec 9999 (sans arrêt) et `epoch + 1` (arrêt).
- **Levée locale** (`site-order.ts`, `AuthorityService.localUnstale(order)`) : un ordre `{kind:
  'LOCAL_UNSTALE', gateway_id, epoch, issued_at, nonce}` canonicalisé (JCS) et signé par **deux clés
  de procédure de site distinctes** (liste `site_order_keys` du fichier d'enrôlement, ES256).
  Validité 10 minutes sur l'horloge de la passerelle, nonce à usage unique (consigné dans
  `edge_audit`). Refusée si le central a confirmé l'époque supérieure ou si le lien est sain. Effet
  : `ACTIVE`, `highest_epoch_seen` ramenée à `epoch`, audit `LOCAL_UNSTALE` avec les deux auteurs.
  Au retour du lien, l'ordre est versé à l'audit du central (WP20). `site-order.ts` est réutilisé
  par la purge (WP24) : exporte une vérification générique `verifyTwoPersonOrder(kind, payload,
  signatures)`.
- **Format de l'ordre à deux personnes : non fixé par les sources** (data-model B.8 dit « ordre
  signé de deux personnes distinctes », B.9 bis « clé d'accord de la procédure de site »). Le format
  ci-dessus est un choix de ce lot : signale-le, ainsi que le point qui engage la sécurité (qui
  détient les clés de procédure, comment elles sont inscrites). Ne le généralise pas sans accord.

## T079 – Tests (`apps/gateway/test/authority/`)

Bases jetables `cashless_m8_edge_*` ; central simulé par un faux serveur HTTPS de test (code du lot,
dans `test/authority/`), pas par le vrai central.

- `authority-states.spec.ts` : chaque ligne de B.8 ; la table de transitions du code égale la table
  SQL ; transition absente refusée ; `assertCanDebit` pour chaque état (code et corps, rien écrit) ;
  accusé répété idempotent.
- `restart-cases.spec.ts` : les **quatre cas** de redémarrage, plus « arrêt entre `200` et `ACTIVE`
  ». Doit échouer si `recover()` lit « `ACTIVE`, même époque » au lieu de `RELEASING`.
- `epochs.spec.ts` : 9999 sans arrêt ni persistance, `epoch + 1` avec arrêt, époque confirmée par le
  canal, `highest_epoch_seen` jamais abaissée sauf levée ; `operations_count` correct au second
  cycle.
- `local-unstale.spec.ts` : une seule signature refusée, deux fois la même clé refusée, ordre périmé
  (10 min + 1 s), nonce rejoué, central ayant confirmé, lien sain : tous refusés ; cas valide :
  `LOCAL_UNSTALE` audité avec deux auteurs.
- `central-client.spec.ts` : épinglage du central, `Date` transmis à l'horloge, aucune nouvelle
  tentative implicite d'un `POST`, annulation d'une attente longue, chaque code du contrat devient
  son erreur typée.

## Sécurité

- Une seule autorité : tout chemin qui permettrait un débit en `GRANTED_PENDING`, `RELEASING`,
  `STALE`, `REVOKED`, `ARMED` ou `STANDBY` est un défaut bloquant.
- Écart OP-N110 : un en-tête forgé à `epoch + 1` ou `epoch + 2` est plausible et provoque un `STALE`
  (disponibilité, pas sécurité). Test de borne qui échoue si la fenêtre s'élargit à `+ 3`.
- Aucun secret dans les journaux ; l'ordre à deux personnes ne consigne que les identifiants des
  clés.
- À faire relire par une personne : `authority.service.ts`, `authority-transitions.ts`,
  `site-order.ts`.

## Definition of Done

- [ ] Quatre cas de redémarrage et « arrêt entre `200` et `ACTIVE` » verts ; époque forgée prouvée dans les deux sens.
- [ ] `operations_count` correct sur deux cycles ; accusé et rendu idempotents.
- [ ] La table de transitions du code égale la table SQL.
- [ ] Format de l'ordre à deux personnes signalé au porteur ; aucune dépendance npm nouvelle ; lignes de 100 caractères.

## Ce que le relecteur doit casser

- Tuer le processus après chaque commit d'un changement d'état et vérifier qu'aucun débit n'est
  possible avant le redémarrage complet.
- Envoyer `X-Authority-Epoch: 9999` sur mille requêtes : les débits continuent. Envoyer `epoch + 1`
  : arrêt, puis levée à deux seulement.
- Rejouer un ordre de levée signé ; le signer avec la même clé deux fois ; le présenter lien sain.
- Faire échouer le rendu (`FAILED`) pour une autre époque : la passerelle ne doit pas repasser
  `ACTIVE`.
- Faire reculer l'horloge de 25 h par une réponse du central : l'accusé ne part pas.
