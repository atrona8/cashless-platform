# Registre de nécessité et complétude des documents

> Tenu à jour par l'Agent Documentaliste à CHAQUE passage (initialisation,
> post-mission, audit). Ne jamais laisser une ligne sans réponse humaine explicite
> aux deux portes (nécessité, complétude).

## Fraîcheur de PRD.md

> `PRD.md` n'est pas listé parmi les "Documents globaux" ci-dessous (ce n'est
> pas un livrable de doc technique, c'est la source du besoin), mais il doit
> rester vivant : chaque nouveau besoin fonctionnel décidé en conversation,
> planifié ou non dans le découpage initial, doit y être reporté au moment de
> la décision — voir `CLAUDE.md`, section "Nouveau cas d'usage évoqué en
> conversation". Une ligne ci-dessous à chaque enrichissement permet de
> vérifier d'un coup d'oeil que `PRD.md` n'est pas resté figé pendant que le
> produit grandissait.

| Date | Mission / besoin à l'origine de l'ajout | Section de PRD.md enrichie | Entrée correspondante ajoutée à PROMPTS-A-ENVOYER.md ? |
|---|---|---|---|
| 07/10/2026 | Découpage initial (structuration de SPECIFICATION.md v1.2) ; décisions de cadrage : toute la V1, pas de code préexistant, app terminal en dernier | (toutes) ; §9 Notes non classées | Oui (Étape 6 initiale) |
| 08/10/2026 | Mission 2 `identite-roles-double-validation-01M4DNDN` : routes de gestion des personnes et des rôles, amorçage du premier administrateur, OIDC pour l'authentification du personnel | §2.10 Double validation et rôles ; intégrations externes (serveur d'identité) | Oui (slug réel reporté, specify coché) |
| 08/10/2026 | Question du porteur sur l'intégrité du journal d'audit : chaîne d'empreintes et scellements (mission 2), copie externe (mission 9) | §2.10 ; §2.11 Sécurité | Oui (mission 9 complétée) |

## Documents globaux

| Document | Nécessaire ? | Justification | Complet ? | Ce qui manque | Dernière mission ayant motivé une MAJ | Date | Validé par |
|---|---|---|---|---|---|---|---|
| 01-product-overview.md | Oui | Vision, personas, domaines et glossaire : point d'entrée fonctionnel | Partiel | Socle du Grand livre et domaine Identité implémentés ; autres domaines à venir ; frustrations des personas déduites du contexte | `identite-roles-double-validation-01M4DNDN` (review) | 09/10/2026 | Agent, par délégation du porteur (09/10/2026) |
| 02-use-case-diagram.md | Oui | Nombreux acteurs terrain et administration | Partiel | Cas d'usage terrain non implémentés ; administration (personnes, rôles, double validation) implémentée | `identite-roles-double-validation-01M4DNDN` (review) | 09/10/2026 | Agent, par délégation du porteur (09/10/2026) |
| 03-context-diagram.md | Oui | 11 systèmes externes (PSP, KMS, OTP, OIDC, S3…) | Partiel | Fournisseurs OTP non choisis (ADR-66) ; aucune intégration réelle à ce jour | Initialisation | 07/10/2026 | Porteur du projet (07/10/2026) |
| 04-architecture-diagram.md | Oui | Central, passerelle, apps Flutter, back-office | Partiel | Décrit la cible : seuls l'API centrale (squelette, moteur, identité, double validation, audit) et la base existent ; région AWS provisoire (OP-N11) | `identite-roles-double-validation-01M4DNDN` (review) | 09/10/2026 | Agent, par délégation du porteur (09/10/2026) |
| 05-sequence-diagrams.md | Oui | Flux critiques multi-composants (en ligne, hors ligne, passerelle, PSP, double validation, clôture) | Partiel | Flux cibles non implémentés, sauf la clôture (rejeu) et le mécanisme de double validation | `identite-roles-double-validation-01M4DNDN` (review) | 09/10/2026 | Agent, par délégation du porteur (09/10/2026) |
| 07-api-reference.md | Oui | Le projet expose une API (73 chemins dans `openapi.yaml`) | Partiel | Endpoints du back-office absents du contrat (§10.4) ; routes Personnes et Approbations implémentées (mission 2), aucune route métier de paiement ; `GET /v1/health` hors contrat (C-009) | `identite-roles-double-validation-01M4DNDN` (review) | 09/10/2026 | Agent, par délégation du porteur (09/10/2026) |

## Surfaces dérivées (hors des 5 documents globaux)

> Si le projet construit une surface qui affiche ou dérive le contenu de
> `docs/` autrement que par lecture directe des fichiers Markdown (ex: un
> visualiseur in-app, un site généré, un export PDF automatisé), liste-la
> ici. Une surface dérivée n'est pas un 6ᵉ document à maintenir séparément,
> mais elle doit être explicitement rattachée à un mode de fraîcheur :
> soit elle est **strictement dérivée** des fichiers sources au moment de
> l'affichage (aucun contenu propre, donc rien à maintenir en plus), soit
> elle a une logique propre (routes, filtres, exclusions) qui peut se
> désynchroniser des fichiers sources et doit alors être revérifiée à
> chaque audit périodique au même titre que les 5 documents globaux.

| Surface | Chemin | Mode de fraîcheur | À revérifier à chaque audit ? |
|---|---|---|---|
| Vue visuelle en quadrants (user stories, entités, hypothèses, cas limites par mission) | `docs/spec-index.json` consommé par la page dans `src/app/documentation/` (ou équivalent) | Logique propre : `spec-index.json` est réécrit par `spec-kitty-docs-maintain` à chaque addendum post-plan/post-review, pas régénéré à l'affichage — une entrée peut donc devenir obsolète si l'addendum a été manqué. Voir `.docmeta/spec-index-schema.md`. | Oui |
| | | Strictement dérivée / Logique propre | Oui/Non |

## Documents locaux par mission

| Mission | use-case.md | architecture-notes.md | sequence.md |
|---|---|---|---|
| `fondations-grand-livre-01M4AY8M` | Nécessaire : Oui · Complet : Oui (recalé après review) · Agent, par délégation du porteur (08/10/2026) | Nécessaire : Oui · Complet : Oui (recalé après review) · Agent, par délégation du porteur (08/10/2026) | Nécessaire : Oui · Complet : Oui (recalé après review) · Agent, par délégation du porteur (08/10/2026) |
| `identite-roles-double-validation-01M4DNDN` | Nécessaire : Oui · Complet : Oui (recalé après review) · Agent, par délégation du porteur (09/10/2026) | Nécessaire : Oui · Complet : Oui (recalé après review) · Agent, par délégation du porteur (09/10/2026) | Nécessaire : Oui · Complet : Oui (recalé après review) · Agent, par délégation du porteur (09/10/2026) |

## Légende
- **Nécessaire ?** : Oui / Non / Non applicable à cette mission
- **Complet ?** : Oui / Partiel / Non / À valider — si "Partiel" ou "Non", la
  section "Ce qui manque" est obligatoire, pas optionnelle.
- Une ligne "Non" en nécessité n'est **pas supprimée** du dépôt : le document reste
  présent, avec une mention explicite en tête de fichier "Jugé non nécessaire pour
  ce projet le [date], voir 06-docs-status.md pour la justification."

---

## Journal des mises à jour — par commande Spec Kitty

> Rempli à chaque passage. Permet de savoir, pour toute commande spec-kitty
> exécutée, si une mise à jour de documentation a suivi, a été jugée inutile, ou
> est encore en attente.

| Date | Commande spec-kitty concernée | Mission | Prompt appliqué (A/B-plan/B-review/C) | Docs impactés | Résultat |
|---|---|---|---|---|---|
| 07/10/2026 | Initialisation | — | A | 01,02,03,04,05,07 | Mis à jour |
| 07/10/2026 | /spec-kitty.plan | `fondations-grand-livre-01M4AY8M` | B-plan | 01,02,04,05,07 ; docs locaux (use-case, architecture-notes, sequence) ; spec-index.json | Mis à jour |
| 08/10/2026 | review (boucle CLI : `spec-kitty agent action review` WP08-WP14, 14/14 approuvés) | `fondations-grand-livre-01M4AY8M` | B-review | 01,02,04,05,07 ; docs locaux recalés ; spec-index.json ; PROMPTS-A-ENVOYER.md (C-010 caduque) | Mis à jour |
| 08/10/2026 | spec-kitty accept (local) puis spec-kitty merge (squash, local, sans push) | `fondations-grand-livre-01M4AY8M` | Vérification pré-conclusion | 01,02,04,07 (statut « mergée ») ; spec-index.json ; docs-state.json | Mis à jour |
| 08/10/2026 | /spec-kitty.plan | `identite-roles-double-validation-01M4DNDN` | B-plan | 01 (domaine Identité ajouté), 02, 04, 05, 07 ; docs locaux (use-case, architecture-notes, sequence) ; spec-index.json | Mis à jour |
| 09/10/2026 | — (demande du porteur : pile logicielle) | transverse | Hors commande | 08 (nouveau), 00, 04, PRD §5, POINTS_OUVERTS (OP-N39) | Mis à jour — divergences D1-D19 signalées, arbitrage en attente |
| 09/10/2026 | — (décision du porteur : « priorise l'existant ») | transverse | Hors commande | 08 (réécrit en référence arrêtée), DECISIONS_ADR (ADR-78), POINTS_OUVERTS (OP-N39 tranché, OP-N40 ouvert), 00, 04, PRD §5 | Mis à jour |
| 09/10/2026 | — (décision du porteur : « garde les 30 jours ») | transverse | Hors commande | DECISIONS_ADR (ADR-79), POINTS_OUVERTS (OP-N40 tranché), 08 §4 et §6 ; code dans WP08 (défaut 720 h) | Mis à jour |
| 09/10/2026 | review (boucle CLI : `spec-kitty agent action review` WP01-WP10, 10/10 approuvés) | `identite-roles-double-validation-01M4DNDN` | B-review | 01,02,04,05,07 ; docs locaux recalés (use-case, architecture-notes, sequence) ; spec-index.json ; docs-state.json | Mis à jour — écarts plan/implémentation signalés : migration `0006` (`create_platform_admin`), `POST /platform-admins` sans clé d'idempotence, exceptions `TenantTx.identify`/`withoutTenant`, enregistrement des actions par module dynamique, modules globaux, aucune route de retrait d'un `PLATFORM_ADMIN`, routes « Personnes » d'abord placées sous `webhooks:` (corrigé en WP10) ; diagrammes en repli Mermaid (skills externes absents) |
| 09/10/2026 | spec-kitty accept (local, matrice 19/19 FR) puis spec-kitty merge (squash, local, `c2f3934`) | `identite-roles-double-validation-01M4DNDN` | Vérification pré-conclusion | 01,02,04,05,07 (statut « mergée ») ; spec-index.json ; docs-state.json | Mis à jour |

Note : les diagrammes (02 à 05) sont rendus en **repli Mermaid**, faute d'outil : ni `excalidraw-diagram-skill`
ni `/illustre` ne sont installés dans cette session (`.docmeta/diagram-style-routing.md`).

### Statuts possibles en colonne "Résultat"
- **Mis à jour** : le document a été modifié suite à ce prompt.
- **Jugé non nécessaire** : porte de nécessité répondue "Non" — voir tableau
  ci-dessus pour la justification.
- **Aucun changement requis** : le document a été relu mais ne nécessitait pas de
  modification (rare mais possible — le noter quand même, ne pas omettre la ligne).
- **En attente de validation humaine** : proposition faite par l'agent, pas encore
  confirmée.

### Missions en attente de doc-check (à surveiller)
(Liste des missions dont l'addendum post-plan ou post-review n'a pas encore été
appliqué)
- `identite-roles-double-validation-01M4DNDN` : addendum post-plan appliqué le 08/10/2026 ; **addendum post-review en attente** (avant `spec-kitty accept` / `merge`).
- `fondations-grand-livre-01M4AY8M` : post-plan le 07/10/2026, post-review le 08/10/2026 (avant accept).
  Écarts plan / implémentation signalés : accès base par `TenantTx.run` (et non `withTenantTx`) ; idempotence du
  moteur vérifiée avant la matrice et les soldes ; lignes du scénario comparées après écriture ; second rejeu sur le
  grand livre `LOCKED` (et non sur une seconde base) ; démarrage par le hook `tsx` ; détail dans `research.md` R-13.
