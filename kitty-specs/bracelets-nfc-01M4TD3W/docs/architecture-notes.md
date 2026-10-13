# Notes d'architecture — mission bracelets-nfc-01M4TD3W

> État : **plan finalisé** (2026-10-13).

## Composant(s) introduit(s) ou modifié(s) par cette mission
- Bibliothèque de format `packages/tag-format` : workspace TypeScript `@cashless/tag-format` et paquet Dart
  `cashless_tag_format`, prouvés sur les mêmes vecteurs du kit.
- API centrale : un seul code, **quatre processus** (API publique, clés de bracelet, personnalisation, contrôle
  quotidien) et une **commande d'administration des clés** lancée à la demande ; module `media/` (clés, lots,
  personnalisation, lecture, cycle de vie, rattachement, liste noire, contrôle quotidien).
- Ports avec faux pour les tests : service de clés (découpé par droit), identité du terminal, identité du festivalier ;
  garde qui refuse le démarrage en production avec un faux.
- Base centrale : migrations `0010` (codes et demandes de rattachement, S19), `0011` (rôle `PERSONALIZER`, quatre
  actions à deux), `0012` (travaux de clé, comptes rendus du contrôle), `0013` (fonctions d'appui) ; `post-roles.sql` :
  quatre rôles de base de plus, et retrait à `cashless_app` de la lecture des secrets chiffrés.
- Contrat : environ 25 opérations ajoutées (back-office des clés, des lots, des bracelets ; poste de
  personnalisation) ; types TypeScript et Dart générés.

## Décisions d'architecture prises dans cette mission
| Décision | Justification | Alternative envisagée |
|---|---|---|
| Quatre processus pour un seul code | Droits séparés sur les clés (§3.2, §13.2) : une faille de l'API publique n'atteint aucune clé | Un seul processus avec séparation logique (écart de sécurité refusé) |
| Rôles de base distincts ; l'API publique ne lit plus les secrets chiffrés | Seconde barrière, indépendante du service de clés | Rôle applicatif unique |
| Commande d'administration séparée pour créer et désactiver une clé | Aucun service permanent ne peut détruire une clé | Droit donné au processus de personnalisation |
| Travaux de clé en table (`tag_key_job`) | Une action approuvée dans l'API publique s'exécute là où le droit existe | Appel interne entre processus |
| Mot de passe jamais transmis en clair, y compris au poste | Règle du contrat pour le terminal, étendue au poste | Réponse en clair sous TLS (écart de sécurité refusé) |
| Clé de données en mémoire 5 minutes au plus | Le contrat prévoit un cache ; durée bornée et effacement | Aucun cache ; cache à vie |
| Une clé de données par session de personnalisation | La personnalisation n'a pas le droit de déchiffrer (§3.2) : aucun droit ajouté | Lui donner ce droit ; faire sceller par le processus des clés |
| Empreinte à clé des codes de rattachement et de confirmation | Un code court se retrouve par essais si la base fuit | Empreinte simple |
| Rôle dédié `PERSONALIZER` | Moindre privilège sur l'opération la plus sensible | `OPERATOR_ADMIN` sur un poste d'atelier |
| Les fonctions de la base font les règles | §2.2 ; le schéma de référence les fournit déjà | Règles réécrites dans l'API |

## Dettes de sécurité ouvertes par cette mission
Faux service de clés, faux terminal, faux festivalier, requêtes de terminal non signées : chacune a sa garde (refus de
démarrer en production), sa mission de levée et son entrée à créer dans `docs/POINTS_OUVERTS.md` et
`docs/DECISIONS_ADR.md` (contrainte C-012 de la spec).

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, tables « Composants par mission » et « Décisions d'architecture
notables ».

## Nécessaire pour cette mission ? Oui — nouveaux processus, nouveaux rôles de base, nouvelle bibliothèque en deux langages.
## Complet ? Oui au stade du plan.
## Validé par : Agent, par délégation du porteur (13/10/2026)
