# API Cashless, version exécutable locale

Commit `@SHA@`, export du @DATE@. Pour une équipe cliente ou un environnement d'intégration : **jamais pour la
production**. L'API tourne ici en configuration de développement, avec des faux (serveur d'identité, KMS, PSP,
attestation, SMS) que la configuration de production refuse au démarrage.

## Prérequis

- Node.js 22 (`engines` : `>=22 <23`), npm.
- Docker (ou colima / Podman) avec Docker Compose.
- Client PostgreSQL facultatif.

## Démarrer

```bash
bash demarrer-local.sh
```

Le script :
1. lance PostgreSQL 17 dans Docker sur `127.0.0.1:5433` (`docker-compose.yml`, accès local seulement) ;
2. installe les dépendances (`npm ci`) ;
3. crée la base `cashless_dev` et applique les migrations et les rôles (`packages/ledger-sql`) ;
4. compile et démarre l'API (`apps/api`) avec les valeurs de test de `tools/dev-db/env.sh`.

Arrêter : `Ctrl+C` pour l'API, puis `docker compose down` (ajouter `-v` pour effacer la base).

## Contenu

| Chemin | Rôle |
|---|---|
| `apps/api/` | API NestJS et ses processus (clés des bracelets, personnalisation, contrôle, interrogation PSP, administration des clés, snapshots, maintenance). |
| `packages/contracts/` | Contrat OpenAPI et types générés. |
| `packages/ledger-sql/` | Schéma du grand livre, migrations, rôles, tests pgTAP. Les fichiers `.sql` générés ne se modifient pas à la main. |
| `packages/tag-format/` | Format des bracelets (TypeScript, Dart, vecteurs). |
| `tools/dev-db/` | Variables de développement (valeurs de test publiques). |
| `ACCES-API.md` | Authentification, serveur simulé, demandes de changement. |

## Tests

Les tests d'intégration et pgTAP demandent pgTAP dans PostgreSQL (absent de l'image `postgres:17`) ; ils relèvent
de l'équipe serveur. Le contrat se vérifie avec `npm run check -w @cashless/contracts`.
