# Cas d'usage — mission identite-enrolement-terminaux-01M52R6H

> État : **plan finalisé** le 19/10/2026 (`plan.md`, commit `c7d9d04`). Rédigé d'après le plan ; à recaler sur le
> code réel à l'addendum après review.

## Cas d'usage propres à cette mission

![Cas d'usage des terminaux](diagrams/usecase-terminaux.png)

Sources : [`usecase-terminaux.excalidraw`](diagrams/usecase-terminaux.excalidraw), [`usecase-terminaux.svg`](diagrams/usecase-terminaux.svg).

| Cas d'usage | Acteur | Règle principale |
|---|---|---|
| Émettre un code d'enrôlement | `OPERATOR_ADMIN` (tout le prestataire), `ORGANIZER_ADMIN` (ses événements) | Usage unique, 24 h par défaut, affiché une seule fois ; choix obligatoire « téléphone personnel » ; `PAIRED_TPE` refusé |
| Suivre les terminaux | idem | Liste et fiche sans aucun secret |
| Suspendre ou réactiver | idem, une seule personne | Suspendu : remonte ses lots et sa présence, n'autorise rien |
| Révoquer un terminal | idem, une seule personne | Définitif ; jetons révoqués ; effet à la requête suivante ; le `serial` redevient libre |
| S'enrôler (attestation) | Terminal | Code scanné puis clés créées ; Android 12+ (deux clés attestées) ; iOS par App Attest (clé de signature non attestée, OP-N64) |
| Renouveler son jeton | Terminal | Jeton à usage unique ; grâce de 60 s pour une réponse perdue (OP-N65) |
| Lire sa configuration, signaler sa présence | Terminal | Permis aussi quand le terminal est suspendu |
| Appeler une route signée | Terminal | Certificat, jeton lié et signature ensemble, sur toute route de terminal (dont celles de la mission 4) |

Les six dettes de base héritées de la mission 4 (OP-N44, N50, N54, N59, N62, N63) n'introduisent pas de cas d'usage :
elles durcissent ceux qui existent.

## Lien avec la synthèse globale
Contribue à : `docs/02-use-case-diagram.md`, domaine « Terminaux » (vue administration : « Enrôler un terminal » ;
vue terrain : appels du terminal).

## Nécessaire pour cette mission ? Oui — la mission introduit l'enrôlement, le cycle de vie d'un terminal et ses appels authentifiés.
## Complet ? Oui au stade du plan — à recaler après review sur les routes réellement servies.
## Validé par : Agent, par délégation du porteur, le 19/10/2026
