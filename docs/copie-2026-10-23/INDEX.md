# État du projet Cashless Platform au 23/10/2026 — copie des documents

Ce dossier est une **copie figée** des documents du projet au 23/10/2026, mis à jour ce jour-là. Les originaux, qui
continuent de vivre, sont dans `docs/` et à la racine du dépôt. Ne pas éditer les copies.

## Missions

| N° | Mission (Spec Kitty) | État | Document Word |
|---|---|---|---|
| 1 | Fondations du grand livre et de l'API (`fondations-grand-livre-01M4AY8M`) | Fusionnée le 08/10/2026 | — |
| 2 | Identité, rôles et double validation (`identite-roles-double-validation-01M4DNDN`) | Fusionnée le 09/10/2026 | — |
| 3 | Configuration, parties et événements (`configuration-parties-evenements-01M4GCJ9`) | Fusionnée le 13/10/2026 (PR #2) | `docs/Mission-03-…docx` |
| 4 | Bracelets NFC (`bracelets-nfc-01M4TD3W`) | Fusionnée le 16/10/2026 (PR #3) | `docs/Mission-04-…docx` |
| 5a | Identité et enrôlement des terminaux (`identite-enrolement-terminaux-01M52R6H`) | Fusionnée le 22/10/2026 (PR #4, correctif PR #5) | `docs/Mission-05a-…docx` |
| 5b | Encaissement en ligne (`terminaux-paiement-en-ligne-01M52QB9`) | **En implémentation** : 6/14 lots approuvés, WP05 au cycle 2 | `docs/Mission-05b-…docx` |
| 6 | Recharges, caisses et PSP | Planifiée | — |
| 7 | Hors ligne (snapshots et lots) | Planifiée | — |
| 8 | Passerelle locale | Planifiée | — |
| 9 | Remboursements, versements et clôture | Planifiée | — |
| 10 | App festivalier (reçoit aussi l'identification au guichet) | Planifiée | — |
| 11 | Back-office web | Planifiée | — |
| 12 | App terminal | Planifiée | — |
| 13 | Recette V1 | Planifiée | — |

Les missions 6 à 13 sont décrites, avec leurs prompts et les dettes dont elles héritent, dans
`racine/PROMPTS-A-ENVOYER.md` ; le besoin de chacune dans `racine/PRD.md`.

## Contenu de la copie

| Fichier | Contenu |
|---|---|
| `racine/README.md` | Kit de départ |
| `racine/PRD.md` | Besoin produit, source de vérité du besoin |
| `racine/PROMPTS-A-ENVOYER.md` | Découpage en missions et commandes de chacune |
| `docs/00-README-onboarding.md` | Méthode de documentation continue |
| `docs/01-product-overview.md` | Description produit par domaine, avec le statut de chaque domaine (mis à jour le 23/10) |
| `docs/02` à `05`, `09` | Cas d'utilisation, contexte, architecture, séquences, diagramme de classes |
| `docs/06-docs-status.md` | État de la documentation et journal des mises à jour (ligne du 23/10) |
| `docs/07-api-reference.md` | Référence de l'API |
| `docs/08-pile-logicielle.md` | Pile logicielle (ADR-78) |
| `docs/SPECIFICATION.md` | Spécification normative (§10.2 mise à jour le 23/10) |
| `docs/DECISIONS_ADR.md` | Décisions, jusqu'à ADR-125 |
| `docs/POINTS_OUVERTS.md` | Points ouverts et dettes, jusqu'à OP-N77 |
| `docs/REVUE_COHERENCE*.md` | Revues de cohérence de la spécification |
| `docs/sync_protocol.md` | Protocole de synchronisation hors ligne |
| `docs/Mission-*.docx` | Documents Word des missions 3, 4, 5a et 5b |
| `docs/spec-index.json`, `docs-state.json`, `diagrams/` | Vue en quadrants, état machine de la doc, diagrammes |

## Reprendre le travail

Mission en cours : voir `docs/passation-5b/REPRISE.md` (à jour en continu, pas copié ici). Les dettes de sécurité
ouvertes sont dans `docs/POINTS_OUVERTS.md` ; celles qui bloquent la production y sont marquées.
