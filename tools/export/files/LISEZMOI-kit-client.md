# Kit client Cashless

Version du contrat : commit `@SHA@`, export du @DATE@. Aucun code serveur dans ce kit.

## Contenu

| Chemin | Statut | Rôle |
|---|---|---|
| `packages/contracts/openapi.yaml` | Normatif | Le contrat de l'API. |
| `packages/contracts/generated/` | Normatif (dérivé) | Types TypeScript générés (back-office web). |
| `packages/contracts/dart/` | Normatif (dérivé) | Types Dart générés (applications Flutter). |
| `packages/tag-format/dart/`, `packages/tag-format/vectors/` | Normatif | Format des bracelets et vecteurs de test (app terminal). |
| `tools/nfc-bench/` | Information | Banc NFC (app terminal) : code non testé sur appareil, protocole de terrain. |
| `docs/sync_protocol.md` | Normatif | Protocole de synchronisation des terminaux (même rang que le contrat). |
| `docs/SPECIFICATION.md` | Normatif | Les règles ; priorité des sources au §0.3. |
| `docs/08-pile-logicielle.md` | Normatif | Versions imposées et choix refusés. |
| `PRD.md`, `docs/01`…`05`, `docs/07-api-reference.md` | Synthèse | Produit, acteurs, séquences, référence de l'API. |
| `contrats-complementaires/` | Normatif | Contrats détaillés des terminaux (enrôlement, authentification, jetons, cycle de vie) et du hors ligne (snapshots, lots, conformité, ajouts au contrat). |
| `ACCES-API.md` | Guide | Serveur simulé, API locale, authentification, demandes de changement. |

## Par où commencer

1. `ACCES-API.md`.
2. Les tags du contrat propres à votre application (liste fournie par le référent).
3. `docs/SPECIFICATION.md` §0.3, puis les sections citées pour votre application.
