# Quickstart : passerelle locale de site (mission 8)

**Statut : cible d'implémentation.** Rien de ce qui suit n'existe encore dans le dépôt : ni `apps/gateway`, ni `tools/edge-admin`,
ni les routes `/edge/*` du central, ni les variables nouvelles. Les noms de commandes, de scripts et de variables sont ceux que
le plan prévoit (`plan.md`, IC-01 à IC-16) ; chacun est à confirmer à l'écriture du lot qui le crée. Les commandes qui existent
déjà (`reset-db`, `npm run build -w @cashless/api`, `start`, `npm run check -w @cashless/contracts`) sont marquées « existe ».

Poste visé : macOS, PostgreSQL 17 dans Docker (conteneur `cashless-platform-pg17` sous colima, `127.0.0.1:5433`), Node 22.
Spec Kitty : toujours `LC_ALL=C LANG=C` devant la commande (git en français casse `spec-kitty 4.0.0rc7`).

## Règles de poste à respecter

- Une API tourne déjà sur le port 80 : ne pas y toucher, ne pas réutiliser ce port. Central et passerelle prennent d'autres
  ports ci-dessous.
- La base partagée `cashless_test` est à l'orchestrateur. La mission travaille sur des **bases dédiées** (`cashless_m8_central`,
  `cashless_m8_edge`), créées et détruites sans toucher à `cashless_test`.
- Les agents ne lancent ni Jest, ni pgTAP, ni `reset-db` sur `cashless_test`. Les preuves se jouent en série, par l'agent principal.
- L'horloge de PostgreSQL dans Docker avance de 0 à 120 ms sur celle de Node et recule parfois : aucun test ne compare l'horloge de
  Node à une date posée par la base. Les seuils de temps se mesurent sur le serveur, pas sur l'horloge de la base.
- Colima s'arrête parfois : `colima start && docker start cashless-platform-pg17`.
- Jest tient dans 16 Go avec `--runInBand` ; ne pas lancer plusieurs batteries en même temps.

## 1. Préparer l'environnement

```bash
# Outils PostgreSQL du poste (psql, createdb, dropdb) et pg_prove à recréer à chaque session (voir docs/passation-6/REPRISE.md)
export PATH="/Library/PostgreSQL/18/bin:$PATH"
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres

npm ci --ignore-scripts                    # existe ; .npmrc impose ignore-scripts
npm run build -w @cashless/api             # existe ; sortie dist/, lancée ensuite avec tsx
npm run build -w @cashless/gateway         # cible (IC-06)
```

Variables (toutes **cibles** sauf mention) :

| Variable | Valeur locale | Rôle |
|---|---|---|
| `NODE_ENV` | `development` | existe ; obligatoire ; `production` refuse tout faux (garde de démarrage) |
| `PGDATABASE` | `cashless_m8_central` | base du central pour `reset-db` (existe) |
| `DATABASE_URL_APP` | `postgres://cashless_app:cashless_app_local@127.0.0.1:5433/cashless_m8_central` | existe ; rôle applicatif |
| `DATABASE_URL_PLATFORM` | idem avec `cashless_platform` | existe |
| `DATABASE_URL_EDGE` | `postgres://cashless_edge:cashless_edge_local@127.0.0.1:5433/cashless_m8_central` | cible ; rôle du processus `/edge/*` (migration 0058 et suivantes) |
| `CASHLESS_EDGE_PASSWORD` | `cashless_edge_local` | cible ; comme `CASHLESS_APP_PASSWORD` dans `tools/dev-db/env.sh` |
| `PORT` | `3100` | existe ; API publique du central en local (jamais 80) |
| `EDGE_PORT` | `3101` | cible ; processus `/edge/*` (TLS mutuel) |
| `DEVICE_CA_CERT_FILE`, `DEVICE_REQUEST_AUTHORITIES` | générés par l'outil d'essai ; **la liste du central ne contient JAMAIS l'adresse de la passerelle** (ni joker `:*`) : c'est ce qui empêche le rejeu entre central et passerelle (A20) | existe |
| `EDGE_CA_CERT_FILE` | autorité des passerelles, distincte de celle des terminaux | cible |
| `GATEWAY_PORT` | `3200` | cible ; API de la passerelle sur le réseau du site |
| `GATEWAY_DATABASE_URL` | `postgres://cashless_gateway:cashless_gateway_local@127.0.0.1:5433/cashless_m8_edge` | cible ; base **locale** de la passerelle, jamais celle du central |
| `GATEWAY_CENTRAL_URL` | `https://127.0.0.1:3201` (adresse du relais, pas du central) | cible ; passe par le relais pour pouvoir couper le lien |
| `HARDWARE_KEYSTORE` | `fake` | cible ; faux du port de stockage matériel, **refusé en production** (C-007, NFR-009) ; même nom que `research.md` R-26 |
| `GATEWAY_REQUEST_AUTHORITY` | `localhost:3200` | cible ; seule `@authority` acceptée par la passerelle, jamais de joker ; disjointe de celle du central |
| `EDGE_PACK_DELAY` | `0` en développement | cible ; délai avant l'envoi des mots de passe après inscription ou promotion (30 minutes hors développement, porteur, 05/11/2026) |
| `GATEWAY_IDENTITY_JWKS_URL` | adresse du faux serveur d'identité d'essai | cible ; copie des clés publiques d'identité |
| `EDGE_FAILPOINT`, `EDGE_ALLOW_FAILPOINTS` | vides | cible ; points d'arrêt brutal de NFR-004 (`before-local-write`, `after-local-write-before-reply`, `during-drain-after-send-before-result`, `after-releasing-persisted`, `kill-local-database`) ; actifs seulement avec `NODE_ENV` `development` ou `test` ET `EDGE_ALLOW_FAILPOINTS=1` ; **refusent le démarrage si `NODE_ENV=production`** |

Mots de passe locaux et valeurs de développement seulement. Aucune clé maître de bracelet n'est jamais configurée sur la
passerelle (C-009). Le détail exact des variables est fixé par `data-model.md` et les lots.

## 2. Créer les deux bases

```bash
# Central : base dédiée, migrations 0001 à 00NN (0058 et suivantes de la mission), puis roles.sql (existe)
PGDATABASE=cashless_m8_central npm run reset-db -w @cashless/ledger-sql

# Passerelle : schéma réduit, série de migrations propre `edge-NNNN`, jamais celle du central
createdb cashless_m8_edge
npm run migrate -w @cashless/gateway        # cible (IC-06)
```

Le script `reset-db` détruit la base nommée par `PGDATABASE` : ne jamais le lancer sans cette variable, qui retombe sinon sur
`cashless_test`.

## 3. Lancer le central

```bash
# API publique (existe) : habituel, sur le port 3100 (jamais 80)
(cd apps/api && PORT=3100 npm run start)

# Processus des routes /edge/* et de la garde edgeMtls (cible, IC-03)
(cd apps/api && npm run start:edge)
```

Contrôle : `GET /ledgers/{id}/debit-authority` répond `authority = CENTRAL`, `edge_gateway_id` nul.

## 4. Inscrire et lancer la passerelle

L'inscription ne passe pas par l'API publique (décision 5 du plan, FR-002) : outil d'administration, rôle de base distinct,
audité.

```bash
# Inscrit une passerelle : numéro de série, rôle PRIMARY ou STANDBY, certificat (empreinte), clé d'accord, adresse sur le site
node tools/edge-admin/register.mjs --event <event_id> --serial EDGE-LOCAL-01 --role PRIMARY \
  --cert <chemin du certificat client> --agreement-key <clé publique d'accord> --lan-url https://localhost:3200/v1   # cible

# Lance la passerelle (cible, IC-06)
(cd apps/gateway && GATEWAY_PORT=3200 npm run start)
```

La passerelle démarre en `ARMED` (réplique, ne débite pas). Pour vérifier la garde de production :

```bash
(cd apps/gateway && NODE_ENV=production HARDWARE_KEYSTORE=fake npm run start)   # doit refuser : sortie non nulle, message nommant le faux
(cd apps/gateway && NODE_ENV=staging npm run start)                              # doit refuser : valeur hors production, development, test
(cd apps/gateway && NODE_ENV=production CORS_ALLOW_ALL=1 npm run start)         # doit refuser (un test de démarrage réel par réglage, NFR-009)
```

## 5. Relais coupable

Le lien passerelle vers central traverse un relais TCP de test, sans modifier le réseau du poste :

```bash
npx tsx apps/gateway/test/support/tcp-relay.ts --listen 3201 --target 127.0.0.1:3101   # cible ; commandes : pause, drop, resume, delayMs
```

Il laisse passer le TLS mutuel tel quel (le certificat client voyage jusqu'au central). Dans les tests, le même relais est piloté
par code (`apps/gateway/test/support/tcp-relay.ts`, cible ; un seul fichier, pas d'outil séparé).

## 6. Jouer le parcours SC-001

Parcours complet, sans intervention manuelle autre que les demandes d'admin. Les routes sont celles du contrat ; `humanBearer`
= jeton d'une personne `OPERATOR_ADMIN`.

| Étape | Action | Attendu |
|---|---|---|
| 1. Inscription | `register.mjs` (section 4) | passerelle `ACTIVE`, `PRIMARY` |
| 2. Session de caisse | `openCashSession` au central, terminal `TOPUP_DESK`, avant la bascule | session `OPEN`, répliquée sous 5 s |
| 3. Vendeur | `openVendorSession` au central avant la bascule | session vendeur valable 12 h, répliquée |
| 4. Bascule | `POST /ledgers/{id}/debit-authority` `{target: EDGE, edge_gateway_id, reason}` | `202`, handover `GRANTED`, époque +1 |
| 5. Accusé | la passerelle rattrape jusqu'au filigrane, `ackEdgeHandover` | `200`, handover `ACTIVE` ; avant l'accusé aucun débit |
| 6. Ventes | terminal : `POST /payments` sur le central | `409 DEBIT_AUTHORITY_EDGE` (`edge_base_url`, `authority_epoch`) ; rejoué sur la passerelle avec la même clé : `201` |
| 7. Guichet | `POST /topups/cash`, `POST /media/activations`, caution en espèces sur la passerelle | acceptés sur la session ouverte avant la bascule ; refusés sans session répliquée |
| 8. Refus | caution sur solde, QR, restitution sur la passerelle | `409 DEBIT_AUTHORITY_EDGE`, rien d'écrit |
| 9. Blocage | bloquer un bracelet au central | appliqué sur la passerelle sous 5 s, snapshot signé par sa clé |
| 10. Coupure | `pause` du relais | la passerelle continue de servir ; `ISOLATED` côté état local |
| 11. Retour | `reprise` du relais | `CATCHING_UP`, puis `ACTIVE` ; la réplication reprend sans trou |
| 12. Rendu | `POST /ledgers/{id}/debit-authority` `{target: CENTRAL, reason}` | `RELEASE_REQUESTED`, puis `RELEASING` : `409 DEBIT_AUTHORITY_MOVING` sur la passerelle |
| 13. Vidage | la passerelle envoie sa file par `POST /edge/sync-batches` (500 opérations et 1 Mio au plus) | `OfflineBatchResult` ; doublons `DUPLICATE` |
| 14. Reprise | `releaseEdgeHandover` | `200`, `authority = CENTRAL`, handovers `COMPLETED` |
| 15. Caisse | `closeCashSession` au central | le comptage inclut les espèces de la coupure ; soldes central et passerelle égaux (SC-001) |
| 16. Deuxième cycle | refaire les étapes 4 à 14 sur la même passerelle (A05) | `operations_count` du second rendu = `final_edge_seq` moins le numéro d'activation ; rendu accepté |
| 17. Purge | clôture de l'événement, ou ordre de purge à deux personnes sur la passerelle | clés détruites, aucun canari retrouvé (FR-035, NFR-013) |

La même séquence est jouée par un test de bout en bout : `apps/gateway/test/e2e/sc-001-journey.spec.ts` (cible), avec deux
processus et deux bases, le relais en code, et les points d'arrêt actifs hors production.

## 7. Simuler une coupure ou une panne

| Situation | Moyen | Preuve visée |
|---|---|---|
| Lien coupé avant la bascule | `pause` du relais avant l'étape 4 | la bascule n'est pas accordée ; terminaux en hors ligne avec plafonds (mission 7) |
| Lien perdu entre l'accord et l'accusé | `close` du relais après l'étape 4 | aucun débit nulle part ; abandon par `fail_edge_grant` |
| Arrêt brutal de la passerelle (3 moments, plus l'arrêt du conteneur PostgreSQL local) | `EDGE_ALLOW_FAILPOINTS=1 EDGE_FAILPOINT=before-local-write` (puis `after-local-write-before-reply`, `during-drain-after-send-before-result`, `kill-local-database`) | NFR-004 : 0 perte, numérotation continue |
| Passerelle perdue | arrêter le processus, puis `force: true` + `gateway_confirmed_offline: true`, approuvé par une seconde personne | US7, SC-005 : révocation, époque +1, handover `FORCED` |
| Rendu de 10 000 opérations avec redémarrage | générateur de file de test, `kill` au milieu du vidage | NFR-002 |

## 8. Lancer les preuves

À lancer par l'agent principal, en série, bases dédiées. Les suites déjà existantes sont relancées à chaque lot (IC-16).

```bash
# Contrat : types à jour (existe) puis stabilité et témoin positif (cible, IC-15)
npm run check -w @cashless/contracts
npm run check:stability -w @cashless/contracts

# SQL : droits, fonctions de bascule, enveloppes (pgTAP, après reset-db)
PGDATABASE=cashless_m8_central npm run reset-db -w @cashless/ledger-sql
PGDATABASE=cashless_m8_central npm run test:pgtap -w @cashless/ledger-sql   # existe ; pg_prove à recréer

# Central : régression complète puis mesures seules (existe)
(cd apps/api && SKIP_LATENCY=1 npx jest --runInBand)
(cd apps/api && npx jest --runInBand edge)                                  # cible : suites /edge/*

# Passerelle : unitaires, puis intégration à deux processus (cible)
(cd apps/gateway && npx jest --runInBand test/unit)
(cd apps/gateway && npx jest --runInBand test/integration)

# Étape dédiée de CI, en série (cible) : exclusion sous charge, rendu de 10 000, pannes, latence
(cd apps/gateway && npx jest --runInBand test/e2e)
```

Chaque suite de bout en bout démarre sa propre base `cashless_m8_*` jetable, sur le même cluster, sans toucher à `cashless_test`.
`pgTAP` échoue sur une base où Jest vient de tourner : refaire `reset-db` avant.

Correspondance avec les exigences :

| Preuve | Exigence |
|---|---|
| bascule sous 100 débits par seconde, 0 débit hors `EDGE_SYNC` après la bascule | NFR-001, SC-002 (`sync_protocol.md` §13-4) |
| rendu avec 10 000 opérations, 0 débit après `RELEASING` | NFR-002, SC-003 (§13-5) |
| 100 rejeux d'une même opération, par tous les chemins | NFR-003 |
| arrêt brutal à trois moments | NFR-004 |
| 1 000 paiements, serveur seul, p95 200 ms et p99 500 ms | NFR-005, SC-004 |
| 10 000 opérations reversées en moins de 10 min | NFR-006 (à remesurer en recette) |
| accusé de bascule en moins de 30 s | NFR-007 |
| blocage appliqué sur la passerelle en moins de 5 s | NFR-008 |
| faux refusés au démarrage en production, un test par port | NFR-009, SC-007 |
| canari absent du flux, de la base de la passerelle et des journaux | NFR-010 |
| aucune lecture d'une autre passerelle, d'un autre événement, d'un autre prestataire, sur chaque route `/edge/*` | NFR-011 |
| contrat inchangé hors ajouts facultatifs sous `/edge/*`, témoin positif | NFR-012, SC-006 |

## 9. Nettoyer

```bash
dropdb --if-exists cashless_m8_edge
dropdb --if-exists cashless_m8_central
```

Arrêter le central (port 3100 et `EDGE_PORT`), la passerelle (port 3200) et le relais. Ne jamais arrêter ni redémarrer l'API du
port 80.

## Rappels

- La passerelle n'est pas utilisable en production avant la mission 12b (stockage matériel simulé, C-007). Tout faux (stockage
  de clés, serveur d'identité, KMS) fait refuser le démarrage en configuration de production, et un test le prouve.
- Aucun fichier `.sql` généré de `packages/ledger-sql/` ne se modifie ; les migrations de la mission commencent à `0058`.
- Commandes Spec Kitty : `LC_ALL=C LANG=C spec-kitty ...`.
