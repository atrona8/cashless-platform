# API Cashless, version exécutable locale

Commit `@SHA@`, export du @DATE@. Pour une équipe cliente ou un environnement d'intégration : **jamais pour la
production**. L'API tourne ici en configuration de développement, avec des faux (KMS, PSP, attestation, SMS) que la
configuration de production refuse au démarrage. Aucun serveur d'identité n'est lancé : voir `ACCES-API.md` §3.

## Prérequis

- Node.js 22 (`engines` : `>=22 <23`), npm.
- Docker (ou colima / Podman) avec Docker Compose.
- ngrok, avec un jeton posé (`ngrok config add-authtoken …`) : le script expose l'API sur Internet.
- Client PostgreSQL facultatif.

## Démarrer

```bash
bash demarrer-local.sh
```

Le script :
1. démarre Docker s'il ne répond pas (colima, ou Docker Desktop sur macOS), puis lance PostgreSQL 17 dans Docker sur `127.0.0.1:5434` (`docker-compose.yml`, accès local seulement ; 5434 et non 5433 pour ne pas gêner la base de test du dépôt) ;
2. installe les dépendances (`npm ci`) ;
3. crée la base `cashless_dev` si elle n'existe pas, applique les migrations manquantes et les rôles
   (`packages/ledger-sql`), puis écrit une seule fois les données de démonstration (`DONNEES-DEMO.md`). **La base est
   gardée d'un démarrage à l'autre** : `REINIT_DB=1 bash demarrer-local.sh` repart d'une base neuve, `DEMO_DATA=0`
   n'écrit pas les données de démo ;
4. compile et démarre l'API (`apps/api`) sur le port 80 (`PORT`) avec les valeurs de test de `tools/dev-db/env.sh` ;
5. ouvre un tunnel `ngrok http 80` et affiche l'URL publique. L'API tourne avec des faux et des valeurs de test publiques : ne diffusez pas cette URL au-delà de l'équipe qui intègre.

Arrêter : `Ctrl+C` pour l'API (le tunnel ngrok se ferme avec elle), puis `docker compose down` (ajouter `-v` pour effacer la base).

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
