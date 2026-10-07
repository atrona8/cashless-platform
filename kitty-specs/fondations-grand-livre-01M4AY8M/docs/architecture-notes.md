# Notes d'architecture — mission fondations-grand-livre-01M4AY8M

> État : **plan finalisé** (2026-10-07). Source : `plan.md`, `research.md`, `data-model.md`, `contracts/`.

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **Monorepo** (racine) : npm workspaces, TypeScript strict partagé, ESLint, Jest + `@swc/jest`.
- **`packages/ledger-sql`** : migrations SQL numérotées (`0001` = schéma de référence lu tel quel, `0002` =
  `api_idempotency` S21), exécuteur `migrate.ts` (table `ops.schema_migrations`), `roles.sql` rejoué après chaque
  série, tests pgTAP S21 écrits à la main.
- **`apps/api`** (NestJS 11, Node 22) : pool `pg` en `cashless_app`, `withTenantTx` (seul accès base), port
  `TenantContext`, `X-Request-Id`, `Accept-Language`, filtre problem+json (SQLSTATE → `ProblemCode`), intercepteur
  d'idempotence, route de santé, moteur d'écritures (`ledger/` : calculs `bigint`, 26 constructeurs purs, matrice des
  statuts, port `ConfigResolver`).
- **`packages/contracts`** : types TypeScript générés depuis `openapi.yaml`.
- **`tools/dev-db/`** : cluster PostgreSQL 17 privé (copie des binaires dans le profil, pgTAP, `pg_prove`, port 5433).
- **CI** : `.github/workflows/ledger-tests.yml` réécrit (migrations, pgTAP, générateurs, tests TS, types générés).

## Décisions d'architecture prises dans cette mission

| Décision | Justification | Alternative envisagée |
|---|---|---|
| Cluster PostgreSQL 17 privé pour pgTAP local | Suites en `CREATE EXTENSION pgtap` ; Program Files non modifiable sans admin ; pas de Docker | Copie admin unique ; WSL 1 ; CI seulement |
| Migrations SQL pures + exécuteur maison, `roles.sql` rejoué | Aucun DSL ; droits des nouvelles tables toujours alignés | node-pg-migrate, graphile-migrate, Flyway |
| `pg` sans ORM, `int8` → `BigInt`, accès base uniquement par `withTenantTx` | `set_config` transactionnel garanti ; SQLSTATE visibles ; aucun flottant | Prisma, TypeORM, Kysely |
| Idempotence en deux transactions : réserver, puis travail + réponse dans la même transaction | Aucune écriture validée sans réponse enregistrée ; concurrence → `IN_PROGRESS` | Une seule transaction (concurrence invisible) ; réponse enregistrée après coup (fenêtre de perte) |
| Constructeurs purs (commande + contexte → lignes), service qui applique la matrice des statuts puis appelle `post_transaction` | Testables sans base ; un seul point d'appel | Constructeurs avec accès base |
| 5 types délégués aux fonctions SQL (`take_deposit`…) | §5.4 : ces fonctions sont les constructeurs de leurs types | Reconstruire leurs lignes en TypeScript |
| Rejeu du scénario : lignes du constructeur comparées à celles du JSON avant écriture | Preuve ligne à ligne, pas seulement des soldes | Comparer uniquement les soldes finaux |

Contradiction consignée (research R-07) : clés et dates des cautions du scénario ≠ celles produites par
`take_deposit` / `refund_deposit` / `forfeit_deposit` ; §5.4 appliqué, comparaison sur montants et comptes.

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table **« Décisions d'architecture notables »** et tableau
« Détail par mission » (conteneurs : API centrale, base de données ; outillage : CI, base locale).

## Nécessaire pour cette mission ? Oui — la mission crée la structure de code, l'accès base et le moteur sur lesquels reposent toutes les suivantes.
## Complet ? Partiel — décisions du plan ; versions exactes des dépendances et vérification de la relocalisation PostgreSQL à confirmer à l'implémentation.
## Validé par : Porteur du projet (07/10/2026)
