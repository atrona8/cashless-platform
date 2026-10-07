---
work_package_id: WP02
title: 'Base locale : cluster PostgreSQL 17 privÃ© avec pgTAP'
dependencies: []
requirement_refs:
- FR-003
planning_base_branch: feat/fondations-grand-livre
merge_target_branch: feat/fondations-grand-livre
branch_strategy: Planning artifacts for this mission were generated on feat/fondations-grand-livre. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/fondations-grand-livre unless the human explicitly redirects the landing branch.
subtasks:
- T006
- T007
- T008
- T009
- T010
phase: Phase 1 - Mise en place
history:
- timestamp: '2026-10-07T12:00:00Z'
  agent: claude
  action: Prompt generated via /spec-kitty.tasks
agent_profile: implementer-ivan
authoritative_surface: tools/dev-db/
create_intent:
- tools/dev-db/setup.sh
- tools/dev-db/start.sh
- tools/dev-db/stop.sh
- tools/dev-db/env.sh
- tools/dev-db/build_pgtap.py
- tools/dev-db/README.md
- tools/dev-db/env.test.example
execution_mode: code_change
owned_files:
- tools/dev-db/**
role: implementer
tags: []
tracker_refs: []
---

# Work Package Prompt: WP02 â€“ Base locale : cluster PostgreSQL 17 privÃ© avec pgTAP

## âš¡ Do This First: Load Agent Profile

Charge le profil : `/ad-hoc-profile-load implementer-ivan` (rÃ´le `implementer`). Lis ensuite
`kitty-specs/fondations-grand-livre-01M4AY8M/research.md` Â§R-01 et Â§R-11.

## Objective

Rendre les suites pgTAP exÃ©cutables sur le poste Windows sans droits administrateur ni Docker : un cluster
PostgreSQL 17 privÃ©, sur `127.0.0.1:5433`, dont la copie des binaires contient l'extension pgTAP, plus `pg_prove`.

## Context

- Constats (research R-01) : les suites font `CREATE EXTENSION IF NOT EXISTS pgtap` ;
  `C:\Program Files\PostgreSQL\17\share\extension` est en lecture seule ; PostgreSQL 17.4 est installÃ©
  (`/c/Program Files/PostgreSQL/17/bin`) ; Perl 5 est fourni par Git Bash (`/usr/bin/perl`) ; Python 3.11 prÃ©sent.
- Exigences : FR-003, NFR-006 (< 5 min hors premier tÃ©lÃ©chargement), C-006.
- Le service PostgreSQL existant (5432) ne doit pas Ãªtre touchÃ©.

## Branch Strategy

Planification et merge sur `feat/fondations-grand-livre`. Commande : `spec-kitty agent action implement WP02 --agent claude`.

## Subtasks

### T006 â€” Copie relocalisable de PostgreSQL 17

- `tools/dev-db/env.sh` (sourcÃ© par les autres scripts) : `PG_SRC` (dÃ©faut `/c/Program Files/PostgreSQL/17`,
  surchargeable), `PG_HOME` (dÃ©faut `$LOCALAPPDATA/cashless-pg17`, converti en chemin Unix avec `cygpath`),
  `PGDATA=$PG_HOME/data`, `PGPORT=5433`, `PGHOST=127.0.0.1`, `PGUSER=postgres`, `PATH` prÃ©fixÃ© par `$PG_HOME/bin`.
- `setup.sh` : si `$PG_HOME/bin/postgres.exe` absent, copier `bin`, `lib`, `share` (pas `data`, pas `pgAdmin`).
- VÃ©rifier la relocalisation : `"$PG_HOME/bin/pg_config" --sharedir` doit pointer sous `$PG_HOME` ; sinon,
  arrÃªter avec un message explicite (repli documentÃ© : copie admin unique, voir README).
- Idempotent : relancer `setup.sh` ne recopie pas si la version (`pg_config --version`) est identique.

### T007 â€” Construction de l'extension pgTAP sans make

- Version Ã©pinglÃ©e (`PGTAP_VERSION`, ex. `1.3.3`) + SHA-256 attendu (`PGTAP_SHA256`) ; tÃ©lÃ©chargement de l'archive
  de release officielle (`https://github.com/theory/pgtap/archive/refs/tags/v<version>.tar.gz` ou l'archive PGXN),
  contrÃ´le de la somme, extraction dans `$PG_HOME/src/pgtap-<v>`.
- `build_pgtap.py` (Python, lancÃ© avec `python -I`) reproduit les substitutions du `Makefile` de pgTAP pour
  PostgreSQL â‰¥ 12 : `sql/pgtap.sql.in` â†’ `pgtap--<v>.sql` (remplacer `TAPSCHEMA` par rien/`public` selon le
  Makefile, `MODULE_PATHNAME` inutile car pgTAP est en SQL pur, retirer les blocs conditionnels des anciennes
  versions comme le fait le Makefile), copier `pgtap.control` avec `default_version` = version. Lire le `Makefile`
  de la version Ã©pinglÃ©e pour reproduire **exactement** ses Ã©tapes ; ne pas inventer.
- Copier les fichiers dans `$PG_HOME/share/extension/`.

### T008 â€” `pg_prove` via CPAN `local::lib`

- Installer `TAP::Parser::SourceHandler::pgTAP` (pur Perl ; version Ã©pinglÃ©e) dans `$PG_HOME/perl5` avec
  `cpan`/`cpanm` en mode `local::lib`, sans droits admin. Si CPAN n'est pas configurÃ© dans Git Bash, tÃ©lÃ©charger
  l'archive CPAN du module, vÃ©rifier sa somme et l'installer avec `perl Makefile.PL INSTALL_BASE=$PG_HOME/perl5 &&
  make install` â€” **sans make disponible**, copier `lib/` et `bin/pg_prove` Ã  la main (module pur Perl).
- `env.sh` exporte `PERL5LIB` et ajoute `$PG_HOME/perl5/bin` au `PATH`. VÃ©rifier `pg_prove --version`.

### T009 â€” Cluster privÃ© 5433, start/stop

- `setup.sh` : `initdb -D "$PGDATA" -U postgres -A trust -E UTF8 --locale=C` (une fois) ; `postgresql.conf` :
  `port = 5433`, `listen_addresses = '127.0.0.1'` ; `pg_hba.conf` : `trust` pour `127.0.0.1/32` seulement.
- `start.sh` : `pg_ctl -D "$PGDATA" -l "$PG_HOME/server.log" -w start` (sans effet si dÃ©jÃ  dÃ©marrÃ©).
- `stop.sh` : `pg_ctl -D "$PGDATA" -m fast stop`.
- ContrÃ´le final de `setup.sh` : `psql -d postgres -c "CREATE DATABASE pgtap_probe"`, `CREATE EXTENSION pgtap`,
  `SELECT pgtap_version()`, puis `DROP DATABASE pgtap_probe`.

### T010 â€” README et `.env.test` d'exemple

- `tools/dev-db/README.md` : prÃ©requis, commandes, emplacement (`%LOCALAPPDATA%\cashless-pg17`, ~300 Mo, hors
  dÃ©pÃ´t), dÃ©sinstallation (supprimer le dossier), dÃ©pannage (port pris, relocalisation, CPAN), lien vers
  `kitty-specs/fondations-grand-livre-01M4AY8M/quickstart.md`.
- `env.test.example` : `PGHOST=127.0.0.1`, `PGPORT=5433`, `PGDATABASE=cashless_test`,
  `DATABASE_URL_OWNER=postgres://postgres@127.0.0.1:5433/cashless_test`,
  `DATABASE_URL_APP=postgres://cashless_app:cashless_app_local@127.0.0.1:5433/cashless_test`.

## Definition of Done

- Sur le poste : `bash tools/dev-db/setup.sh && bash tools/dev-db/start.sh` rÃ©ussit ; `CREATE EXTENSION pgtap`
  fonctionne sur le port 5433 ; `pg_prove --version` rÃ©pond ; second `setup.sh` rapide et sans effet.
- Aucun fichier Ã©crit sous `C:\Program Files` ; aucun binaire ni archive commitÃ© dans le dÃ©pÃ´t.

## Risks / Reviewer guidance

- VÃ©rifier la somme SHA-256 rÃ©ellement contrÃ´lÃ©e (Ã©chec si diffÃ©rente).
- VÃ©rifier que `trust` n'Ã©coute que sur `127.0.0.1`.
