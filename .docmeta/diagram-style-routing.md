# Routage des diagrammes — quel outil pour quel document

> Référencé depuis `SKILL.md` (Étape 4) et depuis `mission-docs-template.md`.
> Vérifie la présence des skills externes ci-dessous **avant** de générer un
> diagramme ; à défaut, utilise le repli Mermaid déjà présent dans chaque
> gabarit (aucune perte de fonctionnalité, juste un rendu moins soigné).
>
> **Avant d'appliquer la table ci-dessous, vérifie toujours
> `.docmeta/preferences-utilisateur.md`.** Une préférence explicite de
> l'utilisateur qui y est enregistrée prime sur cette table par défaut pour le
> document concerné — ce fichier-ci reste le comportement par défaut, pas la
> source de vérité finale.

## Table de routage

| Document | Skill externe à utiliser s'il est installé | Repli si absent |
|---|---|---|
| `docs/03-context-diagram.md` | `excalidraw-diagram-skill` | Mermaid `C4Context` (déjà dans le gabarit) |
| `docs/04-architecture-diagram.md` | `excalidraw-diagram-skill` | Mermaid `C4Container` (déjà dans le gabarit) |
| `kitty-specs/NNN-slug/docs/architecture-notes.md` | `excalidraw-diagram-skill` | Prose + tableau seuls (pas de diagramme dans ce fichier) |
| `docs/02-use-case-diagram.md` | `/illustre` (naiersaidane/claude-mastery) | Mermaid `flowchart` (déjà dans le gabarit) |
| `kitty-specs/NNN-slug/docs/use-case.md` | `/illustre` | Mermaid `flowchart` (déjà dans le gabarit) |
| `docs/05-sequence-diagrams.md` | `/illustre` | Mermaid `sequenceDiagram` (déjà dans le gabarit) |
| `kitty-specs/NNN-slug/docs/sequence.md` | `/illustre` | Mermaid `sequenceDiagram` (déjà dans le gabarit) |

## Comment vérifier la présence des skills

Avant de générer un diagramme, vérifie si `excalidraw-diagram-skill` et/ou le
skill `/illustre` de `naiersaidane/claude-mastery` figurent dans la liste des
skills disponibles pour cette session. Si un skill attendu par la table
ci-dessus est absent, utilise directement le repli Mermaid **sans bloquer** —
ne demande pas à l'utilisateur de l'installer avant de continuer, contente-toi
de signaler dans `docs/06-docs-status.md` que le rendu est en repli Mermaid par
défaut d'outil.

## Règle de police, dans tous les cas où l'un de ces deux skills est utilisé

Les deux skills utilisent par défaut la police manuscrite d'Excalidraw
("Virgil"), reconnue peu lisible pour une partie des lecteurs. **Remplace
systématiquement cette police par une police sans-serif propre et lisible**
(ex: Helvetica, Inter, ou l'équivalent disponible dans le moteur de rendu du
skill) — uniquement le texte des labels est concerné, le style de trait
("sketch") des formes elles-mêmes est conservé.

## Règle de validation, dans tous les cas où l'un de ces deux skills est utilisé

Applique le principe de vérification visuelle de `excalidraw-diagram-skill`
**même quand c'est `/illustre` qui génère le diagramme** : après génération,
relis/inspecte le rendu produit (chevauchement de texte, flèches mal alignées,
espacement déséquilibré, légende manquante) et corrige avant de considérer le
diagramme terminé. Ne livre jamais un diagramme non relu.

## Règle de contenu, indépendante de l'outil choisi

Quel que soit l'outil (skill externe ou repli Mermaid), les labels de nœuds
doivent rester courts (2 à 4 mots), en langage simple, sans jargon technique
superflu — un diagramme n'est pas l'endroit pour des phrases complètes.
