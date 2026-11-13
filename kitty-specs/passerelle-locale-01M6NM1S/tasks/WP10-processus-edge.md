---
work_package_id: WP10
title: Processus edge, identité mTLS et canal de contrôle
dependencies: [WP09]
requirement_refs:
- FR-004
- FR-005
- FR-031
- NFR-007
- NFR-011
planning_base_branch: feat/passerelle-locale
merge_target_branch: feat/passerelle-locale
branch_strategy: Planning artifacts for this mission were generated on feat/passerelle-locale. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/passerelle-locale unless the human explicitly redirects the landing branch.
base_branch: kitty/mission-passerelle-locale-01M6NM1S
base_commit: 2b13275a7bf5ecef3a78d9bd165a5ed7dcc4597c
created_at: '2026-11-09T11:58:18.806019+00:00'
subtasks: [T042, T043, T044, T045, T046]
phase: Phase 3 - API du central
agent: claude
history:
- timestamp: '2026-11-05T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: apps/api/src/processes/edge.module.ts
create_intent: [apps/api/src/main.edge.ts, apps/api/src/processes/edge.module.ts, apps/api/src/edge/edge-ca.port.ts, apps/api/src/edge/ca/fake-edge-ca.ts, apps/api/src/edge/ca/edge-ca.module.ts, apps/api/src/edge/identity/edge-mtls.guard.ts, apps/api/src/edge/identity/edge-identity.service.ts, apps/api/src/edge/identity/edge-context.ts, apps/api/src/edge/identity/edge-identity.module.ts, apps/api/src/edge/control/current-handover.controller.ts, apps/api/src/edge/control/current-handover.service.ts, apps/api/src/edge/control/handover-listener.ts, apps/api/src/edge/control/debit-authority-edge.controller.ts, apps/api/src/edge/control/edge-control.module.ts, apps/api/test/integration/edge/process/edge-process-start.spec.ts, apps/api/test/integration/edge/process/edge-mtls-guard.spec.ts, apps/api/test/integration/edge/process/current-handover-wait.spec.ts, apps/api/test/integration/edge/process/edge-isolation.spec.ts]
execution_mode: code_change
model: sonnet
owned_files: [apps/api/src/main.edge.ts, apps/api/src/processes/edge.module.ts, apps/api/src/edge/ca/**, apps/api/src/edge/identity/**, apps/api/src/edge/control/**, apps/api/src/edge/edge-ca.port.ts, apps/api/test/integration/edge/process/**]
tags: []
tracker_refs: []
---

# Work Package Prompt: WP10 : Processus `edge`, identité mTLS et canal de contrôle

> **Arbitrages de l'orchestrateur** : `contracts/interfaces.md` § 12 fait foi sur ce prompt, notamment pour le retrait de `EDGE_PACK_DELAY_SECONDS` et `EDGE_REPLAY_MAX_*` de la configuration, et la lecture `edgeMtls` de `getDebitAuthority`.


## ⚡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (Profile : implementer-ivan / Role : implementer / Agent : claude).
Lis ensuite la fiche de contexte de l'orchestrateur (`docs/passation-8/contexte-m8.md`, décisions 5, 7, 10, 12), ce prompt, puis seulement :

- `contracts/interfaces.md` § 2 (WP03, WP04 : `identify_edge_gateway`, `touch_edge_gateway`, `get_current_edge_handover`, `get_debit_authority`), § 3, § 4 (`EDGE_CA`),
  § 8 (clés de configuration du central), § 11 (fichiers sans propriétaire unique) ;
- `contracts/edge-routes.md` : « Garde `edgeMtls` », « Rôle de base de données », `getDebitAuthority` (côté passerelle), `getCurrentEdgeHandover` ;
- `research.md` **R-03, R-04, R-17** (font foi) ; `data-model.md` A.1, A.4 (lignes `identify_edge_gateway`, `touch_edge_gateway`, `get_current_edge_handover`), A.6 (invariants 5 et 6) ;
- constats `A04`, `A12`, `A13` de `docs/passation-8/rapports/plan-adversarial.md` ;
- le code qui sert de modèle : `apps/api/src/processes/bootstrap.ts` (`serve`, `tlsServerOptions`, `assertProcessIsSafe`), `processes/tag-keys.module.ts`,
  `processes/process-base.ts` (`DenyUnmarkedRoutesGuard`), `device-ca/device-ca.port.ts`, `device-ca/fake-device-ca.ts`, `device-identity/device.guard.ts`,
  `device-identity/real-device-identity.ts`, `main.tag-keys.ts`, `db/process-db.module.ts`.

## Objectif

Créer un **processus à part**, `edge`, qui sert `/edge/*` et la lecture `edgeMtls` de `GET /ledgers/{id}/debit-authority`, avec **sa propre autorité de
certificats**, son propre rôle de base (`cashless_edge`, `DATABASE_URL_EDGE`) et un seul pool. Un certificat de terminal ne passe jamais ici, un certificat
de passerelle ne passe jamais sur une route de terminal. Ce lot livre le socle (processus, port `EDGE_CA`, garde, identité) et la route
`getCurrentEdgeHandover` avec attente longue. Les routes d'accusé, de rendu, de flux et de lot (WP12, WP13) se brancheront sur ce socle : elles ne sont pas ici.

## Branch Strategy

- Branche de planification : `feat/passerelle-locale`. Branche de fusion : `feat/passerelle-locale`.
- Worktree alloué par lane selon `kitty-specs/passerelle-locale-01M6NM1S/lanes.json` (calculé par `finalize-tasks`). N'invente pas de chemin.

## Commande d'implémentation

```bash
LC_ALL=C LANG=C spec-kitty agent action implement WP10 --agent claude --mission passerelle-locale-01M6NM1S
```

## Règles du lot

- Tu ne lances ni Jest, ni pgTAP, ni `reset-db` (l'orchestrateur le fait en série, base partagée). Tu ne commites pas. Tu ne touches pas à l'API qui tourne sur le port 80.
- Aucune migration ici. Aucun `GRANT` (WP09). Aucun `.sql` généré touché. Lignes de 100 caractères. Français, sans tiret cadratin.
- Fichiers hors carte (`interfaces.md` § 11) : `apps/api/src/config/config.ts` (clés `DATABASE_URL_EDGE`, `EDGE_TLS_CERT_FILE`, `EDGE_TLS_KEY_FILE`,
  `EDGE_CA_CERT_FILE`, `EDGE_LISTEN_PORT`, et seulement elles pour ce lot), `apps/api/src/processes/bootstrap.ts` (écouteur `edge`), `apps/api/package.json`
  (script `start:edge`), `apps/api/src/security/port-tokens.ts` (jeton `EDGE_CA`) et, si nécessaire, `apps/api/src/db/process-db.module.ts` (nom de processus `edge`).
  Une ligne par fichier dans ton rapport. Toute autre retouche hors carte s'arrête et se signale.
- Un écart qui affaiblit la sécurité (garde élargie, secret exposé, faux gardé plus longtemps) est soumis au porteur avant d'être codé (CLAUDE.md, règle 1).

## T042 : Point d'entrée, module racine, un pool, script

**But.** `main.edge.ts` n'est qu'un appel à `serve(EdgeProcessModule, port)` comme `main.tag-keys.ts`. `processes/edge.module.ts` suit `tag-keys.module.ts` :
`ProcessDbModule.forProcess('edge')` (rôle `cashless_edge`, lit `DATABASE_URL_EDGE`), `ProcessBaseModule`, `HealthModule`, `AuditModule`, le module d'identité de
passerelle, le module de contrôle, `DenyUnmarkedRoutesGuard` en `APP_GUARD`.

**Arbitrages.**
- Le port d'écoute vient de `EDGE_LISTEN_PORT` (`interfaces.md` § 8). Pas `EDGE_PORT` (voir « Contradictions » en fin de prompt).
- `DenyUnmarkedRoutesGuard` refuse toute route non marquée. Marque chaque route de ce processus par un décorateur `@EdgeAuth()` (pose `IS_PUBLIC` pour passer la garde
  globale, puis `EdgeMtlsGuard` en `UseGuards`), sur le modèle de `@DeviceAuth()`. Une route oubliée reste refusée.
- Le processus ne monte pas de documentation interactive, n'importe pas `KmsModule` et ne reçoit aucune capacité de clé : il n'a pas à signer ni à déchiffrer.
- Le test d'architecture « un processus, un pool » existe déjà : étends sa liste à `edge` s'il en a une (le fichier appartient à WP09 s'il est dans `tests/` de droits ;
  si le test est dans `apps/api/test/`, étends-le avec une ligne dans le rapport). Un second pool ouvert dans `apps/api/src/edge/**` fait échouer ce test.

**Cas limites.** Sans `DATABASE_URL_EDGE`, le processus refuse de démarrer avec un message qui nomme la clé. En production, `EDGE_TLS_CERT_FILE`, `EDGE_TLS_KEY_FILE`,
`EDGE_CA_CERT_FILE` sont obligatoires (la configuration le vérifie comme pour l'écouteur public).

## T043 : Écouteur TLS du processus `edge` et port `EDGE_CA`

**But.** Seconde autorité sur son propre écouteur (R-04.3) : `ca` = `EDGE_CA_CERT_FILE` seule, `requestCert: true`, `rejectUnauthorized: false` (la garde décide, comme
pour les terminaux), TLS 1.3 minimum.

**Fichiers.** `edge/edge-ca.port.ts` : `EdgeCaPort { caCertPem(): string; issue(csrPem: string, serial: string): Promise<string> }` (signature figée, `interfaces.md` § 4),
`isFake?: boolean`. `edge/ca/fake-edge-ca.ts` : faux de développement, `isFake = true`, autorité de test éphémère. `edge/ca/edge-ca.module.ts` : fournit `EDGE_CA`.

**Arbitrages.**
- Ne généralise pas `tlsServerOptions` en changeant sa signature actuelle : ajoute une fonction sœur (`edgeTlsServerOptions`) dans `bootstrap.ts` et fais choisir `serve`
  par une option (`{ listener: 'edge' }`). L'écouteur public garde `ca` = `DEVICE_CA_CERT_FILE` seule, inchangé (test de non-régression).
- `assertProcessIsSafe` : ajoute `'l’autorité des passerelles': optional(app, EDGE_CA)` à la liste. Le processus `edge` refuse de démarrer en production avec le faux.
  C'est la règle 2 de CLAUDE.md : **un test doit le prouver par un démarrage réel** (T046).
- L'adaptateur réel de `EDGE_CA` est la mission 12b : ne l'écris pas. Note dans le rapport que le faux est la dette « autorité des passerelles simulée jusqu'à 12b » (OP/ADR déjà consignés au plan ; aucune nouvelle entrée).

## T044 : Garde `EdgeMtlsGuard`

**But.** Identité de la passerelle, jamais crue sur parole (R-04, `edge-routes.md` « Garde `edgeMtls` »).

**Déroulé, dans cet ordre, un seul échec = `401 UNAUTHENTICATED` sans dire lequel.**
1. `socket.authorized` vrai et certificat présent (la chaîne est déjà vérifiée contre `EDGE_CA_CERT_FILE` par TLS).
2. Empreinte SHA-256 du DER du certificat client, puis `identify_edge_gateway(cert_sha256)` : la fonction refuse l'inconnue et la `REVOKED` (`no_data_found`, traduit en 401).
   Aucune mémoire cache de plus de 0 s : la révocation est immédiate (R-04.5).
3. Dans la transaction de la requête (le service de transaction existant du processus), pose `app.operator_id` et `app.gateway_id` (`set_config(..., true)`). Prestataire,
   événement et grand livre viennent de la ligne lue, **jamais** de la requête. Pose `req.edgeGateway` (`gateway_id, operator_id, event_id, ledger_id, role, status, lan_url`).
4. Un identifiant de la route ou du corps qui désigne autre chose que cette passerelle (autre `ledger_id`, autre `edge_gateway_id`) est traité comme absent par le service appelant : fournis un helper
   `assertOwnGateway(req, id)` qui lève l'erreur neutre attendue par la route (404 pour `getDebitAuthority`, 409 `HANDOVER_INVALID_STATE` pour un handover étranger, WP12).

**Arbitrages.**
- Une passerelle `STANDBY` passe la garde (elle surveille, `edge-routes.md`). Les routes qui l'excluent le font elles-mêmes (WP12, WP13).
- Aucun `403` : non déclaré sur ces routes. Aucun message distinguant « inconnu » de « révoqué » de « autre autorité ».
- La garde n'écrit rien : `touch_edge_gateway` est appelé par `getCurrentEdgeHandover` seulement (T045).
- Un certificat émis par `DEVICE_CA` ne passe pas, même si son empreinte est inscrite par erreur dans `edge_gateway.cert_sha256` : c'est la chaîne TLS qui l'arrête, pas la base. Test (T046).

## T045 : `getCurrentEdgeHandover` avec attente longue (NFR-007)

**But.** `GET /edge/handovers/current?wait=<0..25>` rend immédiatement s'il y a un changement depuis le dernier état vu, sinon attend. Réveil immédiat sur notification, repli à 2 s (R-17).

**Fichiers.** `edge/control/current-handover.controller.ts` (route, validation de `wait` : entier 0 à 25, sinon `VALIDATION_FAILED`), `current-handover.service.ts` (boucle),
`handover-listener.ts` (une connexion dédiée par processus, `LISTEN edge_handover_changed`, ouverte avec `cashless_edge` ; reconnexion automatique avec revérification complète).

**Arbitrages.**
- « Dernier état vu » : empreinte de la ligne rendue (id, état, époque, `updated_at`) gardée **en mémoire par requête** (la requête arrive avec l'état précédent implicite : à la première
  lecture, on rend toujours). Pas d'état global par passerelle, pas de table. Si tu as besoin d'un paramètre pour porter l'état vu, c'est un ajout de contrat : **non**, ne l'ajoute pas ; compare à l'état lu à l'entrée de la requête.
- `touch_edge_gateway` à l'entrée de chaque attente et à sa sortie (battement de cœur, FR-005). Il fait aussi `ISOLATED` vers `CATCHING_UP` : n'écris rien d'autre sur ces états ici.
- Réponse : `200` avec `DebitAuthorityState`, `handover: null` si rien d'ouvert. Pas de `204` (voir « Contradictions »). `edge_base_url` = `lan_url`.
- Le payload de `NOTIFY` est l'identifiant de la passerelle seul ; ne réveille que les attentes de cette passerelle. Une notification d'une autre passerelle ne réveille rien (test).
- Une attente ne tient pas de transaction ouverte ni de connexion du pool pendant qu'elle dort (`idle_in_transaction_session_timeout` la tuerait) : relis la base à chaque tour, dans une transaction courte.
- Le client qui coupe la connexion arrête l'attente (libère l'écoute et la minuterie). Test d'absence de fuite : 50 attentes abandonnées, zéro écouteur résiduel.

**T045 bis : `GET /ledgers/{ledger_id}/debit-authority` en `edgeMtls`.** `tasks.md` ne l'attribue à aucun lot ; `interfaces.md` § 3 place cette lecture dans le processus `edge` et `edge-routes.md`
la décrit côté passerelle. Elle est donc faite ici (`edge/control/debit-authority-edge.controller.ts`), via `get_debit_authority`, `404` neutre pour un autre `ledger_id`. La lecture
`humanBearer` du même chemin est à WP11, dans l'API publique. Signale cette attribution à l'orchestrateur.

## Tests attendus

Dans `apps/api/test/integration/edge/process/` (l'orchestrateur les lance) :

- `edge-process-start.spec.ts` : **démarrage réel** (vrai `NestFactory`, comme le fait la garde de la mission 4) : en production, `EDGE_CA` factice refusé ; `EDGE_LISTEN_PORT` absent ; sans TLS refusé ;
  hors production avec le faux, le processus démarre et répond sur `/health`. Chaque refus a son cas. Doit échouer si on retire `EDGE_CA` de la liste de `assertProcessIsSafe`.
- `edge-mtls-guard.spec.ts` : certificat de la CA des passerelles inscrit : 200 ; sans certificat : 401 ; certificat de la CA des terminaux : refusé à la poignée de main ou 401 ;
  passerelle `REVOKED` entre deux requêtes : la seconde est 401 (aucun cache) ; empreinte inconnue : 401 ; réponse identique pour les trois cas (même corps).
  Inverse : un certificat de passerelle sur une route de terminal du processus public est refusé (`ca` public inchangée).
- `current-handover-wait.spec.ts` : changement posé pendant une attente de 25 s : réponse en moins de 2 s (notification) ; notification coupée (écoute détruite) : réponse au plus tard 2 s plus tard (repli) ;
  `wait=26` et `wait=-1` : 422 ; rien d'ouvert : 200 `handover: null` ; les deux handovers ouverts : le `TO_CENTRAL` est rendu (A13) ; `last_seen_at` avance à chaque appel.
- `edge-isolation.spec.ts` : passerelle d'un autre événement, d'un autre prestataire : `getDebitAuthority` d'un `ledger_id` étranger répond 404 identique à un inconnu ; `cashless_edge`
  n'a aucun droit direct (un `SELECT` sur `ledger` depuis la connexion du processus échoue) ; un seul pool (test d'architecture).

Chaque test doit échouer sur une implémentation fausse : ajoute pour chaque garde un cas « mauvais » qui doit être refusé (si la garde est neutralisée, le test devient rouge).

## Sécurité

- Fichiers à faire relire par une personne : `main.edge.ts`, `edge-mtls.guard.ts`, `edge-identity.service.ts`, `bootstrap.ts` (écouteur `edge`). Dis-le dans le rapport.
- Aucun secret dans un journal : ni le certificat, ni l'empreinte complète (logue les 8 premiers octets au plus), ni `DATABASE_URL_EDGE`.
- Deux autorités ne se mélangent jamais sur un écouteur. Si tu dois élargir `ca` à deux fichiers, **arrête-toi** : c'est un affaiblissement, à soumettre au porteur.
- Les erreurs de garde n'indiquent pas laquelle des vérifications a échoué (NFR-011).

## Definition of Done

- [ ] `start:edge` démarre un processus avec `cashless_edge`, un pool, une autorité de certificats propre.
- [ ] `EDGE_CA` factice refusé en production, prouvé par un démarrage réel.
- [ ] Garde `EdgeMtlsGuard` : empreinte, `REVOKED` immédiat, `app.gateway_id` posé, certificat de terminal refusé.
- [ ] `getCurrentEdgeHandover` : réveil immédiat, repli 2 s, battement de cœur, A13 respecté.
- [ ] `GET debit-authority` en `edgeMtls` servi, 404 neutre.
- [ ] Aucun `.sql` touché, aucune migration, aucun `GRANT`. Rapport : fichiers hors carte listés, fichiers à relire nommés.

## Ce que le relecteur doit casser

- Présenter à `/edge/handovers/current` le certificat d'un terminal enrôlé, puis celui d'une passerelle révoquée une seconde plus tôt.
- Lancer le processus avec `NODE_ENV=production` et le faux `EDGE_CA` ; avec `EDGE_FAILPOINT` posé (doit rester refusé par WP16 côté passerelle, ici sans effet).
- Passer un `ledger_id` d'un autre événement, un `gateway_id` dans le corps, un `X-Gateway-Id` : rien ne doit changer l'identité.
- Poser `wait=25` puis tuer la connexion `LISTEN` : le repli doit répondre.
- Chercher un second `new Pool` ou `pg.Client` dans `apps/api/src/edge/**` hors du listener unique.

## Contradictions relevées entre les sources (aucune n'est corrigée ici)

- `research.md` R-03 nomme `EDGE_PORT` ; `interfaces.md` § 8 nomme `EDGE_LISTEN_PORT`. **`interfaces.md` fait foi.**
- `research.md` R-17 admet un `204` « si le contrat le déclare » ; `contracts/edge-routes.md` dit `200` avec `handover: null` (le contrat ne déclare que `200` et `401`). **`200`.**
- `tasks.md` n'attribue à aucun lot la lecture `edgeMtls` de `getDebitAuthority` (T047 ne parle que de la lecture humaine) alors que `interfaces.md` § 3 la met dans le processus `edge` : prise ici (T045 bis).
- `data-model.md` A.4 liste `identify_edge_gateway` sans `lan_url` ni `public_key` ; `interfaces.md` § 2 les renvoie. **`interfaces.md` fait foi.**
