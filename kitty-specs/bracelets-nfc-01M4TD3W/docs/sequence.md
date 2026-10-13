# Séquences — mission bracelets-nfc-01M4TD3W

> État : **plan finalisé** (2026-10-13).

## Flux internes propres à cette mission

### Personnalisation d'un bracelet

![Personnalisation d'un bracelet](diagrams/sequence-personnalisation.png)

Sources : [`sequence-personnalisation.excalidraw`](diagrams/sequence-personnalisation.excalidraw), [`sequence-personnalisation.svg`](diagrams/sequence-personnalisation.svg).

### Lecture d'un bracelet par un terminal

![Lecture d'un bracelet par un terminal](diagrams/sequence-lecture.png)

Sources : [`sequence-lecture.excalidraw`](diagrams/sequence-lecture.excalidraw), [`sequence-lecture.svg`](diagrams/sequence-lecture.svg).

### Lecture suspecte dans une opération

![Lecture suspecte dans une opération](diagrams/sequence-lecture-suspecte.png)

Sources : [`sequence-lecture-suspecte.excalidraw`](diagrams/sequence-lecture-suspecte.excalidraw), [`sequence-lecture-suspecte.svg`](diagrams/sequence-lecture-suspecte.svg).

### Rattachement d'un bracelet approvisionné

![Rattachement d'un bracelet approvisionné](diagrams/sequence-rattachement.png)

Sources : [`sequence-rattachement.excalidraw`](diagrams/sequence-rattachement.excalidraw), [`sequence-rattachement.svg`](diagrams/sequence-rattachement.svg).

### Création d'une clé, à deux

![Création d'une clé, à deux](diagrams/sequence-creation-cle.png)

Sources : [`sequence-creation-cle.excalidraw`](diagrams/sequence-creation-cle.excalidraw), [`sequence-creation-cle.svg`](diagrams/sequence-creation-cle.svg).

Les diagrammes se régénèrent par `python3 diagrams/generate.py <dossier de sortie> <chemin de render_excalidraw.py du skill illustre>`.

## Lien avec la synthèse globale
Contribue à : `docs/05-sequence-diagrams.md`, flux « Paiement en ligne par bracelet » (la lecture et la demande de mot de
passe) et « Double validation au back-office » (actions de clé et sortie de liste noire).

## Nécessaire pour cette mission ? Oui — interactions entre terminal, poste, quatre processus, service de clés et base.
## Complet ? Oui au stade du plan.
## Validé par : Agent, par délégation du porteur (13/10/2026) — diagrammes générés par `/illustre` (préférence du porteur, 13/10/2026), police sans empattement, rendu relu
