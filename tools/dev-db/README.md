# Base de développement locale (PostgreSQL 17 + pgTAP)

Outil de poste pour exécuter les suites pgTAP du grand livre (`packages/ledger-sql`) et les tests d'intégration de
l'API sur un poste **Windows 10 sans Docker ni droits administrateur**.

Pourquoi un cluster privé : les suites commencent par `CREATE EXTENSION IF NOT EXISTS pgtap`, et le dossier
`C:\Program Files\PostgreSQL\17\share\extension` n'est pas modifiable sans droits administrateur. Le script copie
donc les binaires PostgreSQL 17 déjà installés dans le profil utilisateur, y ajoute pgTAP, et lance un cluster
séparé. Le PostgreSQL installé (service sur le port 5432) n'est jamais modifié.
(Décision : `kitty-specs/fondations-grand-livre-01M4AY8M/research.md`, R-01.)

## Prérequis

- PostgreSQL 17 installé dans `C:\Program Files\PostgreSQL\17` (sinon : variable `PG_SRC`).
- Git Bash (fournit `bash`, `perl`, `tar`, `curl`, `cygpath`), Python 3.
- Accès réseau lors du premier lancement (téléchargement de pgTAP et de deux modules Perl).

## Commandes (Git Bash, depuis la racine du dépôt)

```bash
bash tools/dev-db/setup.sh      # une fois (idempotent) : copie, pgTAP, pg_prove, initdb, démarrage, contrôle
bash tools/dev-db/start.sh      # démarre le cluster (127.0.0.1:5433)
bash tools/dev-db/stop.sh       # l'arrête
source tools/dev-db/env.sh      # variables PG*, PATH, PERL5LIB, DATABASE_URL_* pour le shell courant
```

Ensuite : création de la base de test par les migrations et lancement des suites, voir
`packages/ledger-sql` (`scripts/reset-db.sh`, `npm run test:pgtap -w @cashless/ledger-sql`) et
`kitty-specs/fondations-grand-livre-01M4AY8M/quickstart.md`.

## Ce qui est installé, et où

| Élément | Emplacement | Taille |
|---|---|---|
| Copie de PostgreSQL 17 (`bin`, `lib`, `share`) | `%LOCALAPPDATA%\cashless-pg17` | ~140 Mo |
| Cluster de test (`data`, `server.log`) | `%LOCALAPPDATA%\cashless-pg17\data` | quelques dizaines de Mo |
| pgTAP 1.3.4 (`pgtap.control`, `pgtap--1.3.4.sql`) | `…\cashless-pg17\share\extension` | < 1 Mo |
| `pg_prove` (Test-Harness 3.52 + TAP-Parser-SourceHandler-pgTAP 3.37, Perl pur) | `…\cashless-pg17\perl5` | < 2 Mo |

Rien n'est écrit dans le dépôt ni sous `C:\Program Files`. Chaque archive téléchargée est vérifiée par sa somme
SHA-256 (épinglée dans `setup.sh`) ; une somme différente arrête le script.

Sécurité : le cluster n'écoute que sur `127.0.0.1` et l'authentification `trust` n'est permise que depuis la
machine elle-même. Ce n'est pas une base de production.

## Désinstallation

```bash
bash tools/dev-db/stop.sh && rm -rf "$LOCALAPPDATA/cashless-pg17"
```

## Dépannage

- **Port 5433 déjà pris** : `PGPORT=5434 bash tools/dev-db/setup.sh` (garder la même valeur ensuite, par exemple
  dans `.env.test`).
- **« les binaires copiés pointent encore vers … »** : la copie n'est pas relocalisable sur ce poste. Repli : copier
  une fois, dans un terminal administrateur, `pgtap.control` et `pgtap--1.3.4.sql` (produits par
  `build_pgtap.py`) dans `C:\Program Files\PostgreSQL\17\share\extension`, puis utiliser le PostgreSQL installé.
- **Commande qui ne rend pas la main** après le démarrage : `start.sh` redirige stdout et stderr de `pg_ctl` ;
  ne pas lancer `pg_ctl start` à la main dans un pipe (le serveur hérite du descripteur sous Windows).
- **`python3` ouvre le Microsoft Store** : le script utilise le premier interpréteur qui s'exécute (`python`).
