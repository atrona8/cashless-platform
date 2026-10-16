# Notes d'architecture — mission bracelets-nfc-01M4TD3W

> État : **approuvée** (20 lots relus ; WP20 approuvé au cycle 8 de relecture, 15/10/2026) ; acceptée le 15/10/2026, **mergée le 16/10/2026** dans `feat/bracelets-nfc` (squash `7b1b8c2`).

## Composant(s) introduit(s) ou modifié(s) par cette mission
- Bibliothèque de format `packages/tag-format` : workspace TypeScript `@cashless/tag-format` (format B, message de
  dérivation, PWD/PACK, AAD, enveloppes pour le terminal et pour le poste, codes imprimés) et paquet Dart
  `cashless_tag_format` (`packages/tag-format/dart`), prouvés sur les mêmes vecteurs du kit et l'un contre l'autre.
- API centrale : un seul code, **quatre processus** et une **commande d'administration des clés** (ADR-83) :

  | Point d'entrée | Processus | Ports de clés | Rôle de base |
  |---|---|---|---|
  | `main.ts` | API publique | aucun | `cashless_app` |
  | `main.tag-keys.ts` | Clés de bracelet (`POST /media/auth-keys`, rechiffrement) | `decrypt` | `cashless_tagkeys` |
  | `main.personalization.ts` | Personnalisation (poste, nouvelle clé de données, retrait) | `mac`, `dataKey` | `cashless_perso` |
  | `main.tag-check.ts` | Contrôle quotidien | `mac`, `decrypt` | `cashless_tagcheck` |
  | `main.key-admin.ts` | Commande d'administration, à la demande | `keyAdmin` | `cashless_keyadmin` |

  Module `apps/api/src/media/` : `keys`, `batches`, `personalization`, `auth-keys`, `taps`, `lifecycle` (activation,
  caution, consultation, restitution, remplacement, espèces dues, perte), `claims`, `blacklist`, `daily-check`.
  Chaque opération du contrat porte `x-process` ; un test lit ces 39 opérations et vérifie qu'aucune n'est servie par
  un autre processus.
- Ports avec faux pour les tests (`apps/api/src/kms/`, `device-identity/`, `customer-identity/`) : `MacPort`,
  `DataKeyPort`, `DecryptPort`, `KeyAdminPort`, `DeviceIdentityPort`, `CustomerIdentityPort` ; chaque faux refuse de
  se construire en production et la garde de démarrage refuse un processus qui en porte un (ADR-88).
- Base centrale : migrations `0010` (codes imprimés, demandes de rattachement, essais, consultation anonyme), `0011`
  (rôle `PERSONALIZER`, actions à deux des clés), `0012` (travaux de clé, comptes rendus du contrôle), `0013` (fonctions
  d'appui), **et trois de plus que prévu** : `0014` (prise d'un travail limitée à des prestataires), `0015`
  (`open_event_wallet`, ouverture d'un portefeuille au guichet), `0016` (`consume_tap_for_claim`, lecture consommée par
  la confirmation d'un rattachement) ; puis, après les relectures de WP20 : `0017` (sortie de liste noire liée à une demande
  `REINSTATE_MEDIA` approuvée de l'épisode en cours, ADR-94), `0018` (déclencheurs d'historique en `SECURITY DEFINER`),
  `0019` (`register_personalized_media` et `associate_claim_code` en `SECURITY DEFINER`, contrôles de prestataire refaits
  sans RLS, `search_path = public, pg_temp`) ; puis, au correctif post-fusion n° 1 (constat SEC-1) : `0020` (un travail de clé ne
  naît que d'une demande approuvée à deux : `enqueue_tag_key_job`, `enqueue_tag_key_child_job`, `tag_key_job_refusal`
  revérifiée par les trois exécutants, refus audité `TAG_KEY_JOB_REFUSED` ; `retire_dedicated_key` retirée à `PUBLIC`,
  ADR-102). `post-roles.sql` : quatre rôles de base de plus, droits colonne par colonne, et
  retrait à `cashless_app` de la lecture des chiffrés ; puis retrait des écritures directes sur les historiques, les tables
  de règles de passage, `media_assignment`, `device_config_served`, et de tout `INSERT`/`UPDATE` de `cashless_perso` sur
  `media` (la personnalisation n'écrit plus que par fonctions). `migrate.ts` applique `roles.sql` et `post-roles.sql` dans
  une seule transaction. Variable `TRUST_PROXY_HOPS` obligatoire en production (ADR-95). Correctif post-fusion n° 1 : `INSERT` sur `tag_key_job` retiré à
  `cashless_app` et `cashless_perso` ; `NODE_ENV` obligatoire (`production`, `development`, `test`) ; `TAG_WRAPPING_KEY_REF`
  et `CLAIM_CODE_DOMAIN` exigés en production.
- Contrat : **27 opérations ajoutées sur 24 chemins** (clés et travaux de clé, lots et codes, bracelets au
  back-office, liste noire, perte, poste de personnalisation, remise en stock) ; 12 opérations existantes reçoivent
  `x-process` ; `lookupBalanceByClaimCode` réduite (décision n° 11). Types TypeScript et Dart régénérés.

## Décisions d'architecture prises dans cette mission
| Décision | Justification | Alternative envisagée |
|---|---|---|
| Quatre processus pour un seul code (ADR-83) | Droits séparés sur les clés (§3.2, §13.2) : une faille de l'API publique n'atteint aucune clé | Un seul processus avec séparation logique (écart de sécurité refusé) |
| Rôles de base distincts ; l'API publique ne lit plus les chiffrés (ADR-84) | Seconde barrière, indépendante du service de clés | Rôle applicatif unique |
| Commande d'administration séparée pour créer et désactiver une clé (ADR-83) | Aucun service permanent ne peut détruire une clé | Droit donné au processus de personnalisation |
| Travaux de clé en table (`tag_key_job`), sans aucun secret (contrainte en base) | Une action approuvée dans l'API publique s'exécute là où le droit existe | Appel interne entre processus |
| Mot de passe jamais transmis en clair, y compris au poste (ADR-86) | Règle du contrat pour le terminal, étendue au poste | Réponse en clair sous TLS (écart de sécurité refusé) |
| Clé de données en mémoire 5 minutes au plus, tampons mis à zéro (ADR-86) | Le contrat prévoit un cache ; durée bornée et effacement | Aucun cache ; cache à vie |
| Une clé de données par session de personnalisation (ADR-86, décision n° 7) | La personnalisation n'a pas le droit de déchiffrer (§3.2) | Lui donner ce droit ; faire sceller par le processus des clés |
| Empreinte à clé des codes imprimés et de confirmation ; consultation anonyme par une fonction `SECURITY DEFINER` dédiée (ADR-87) | Un code court se retrouve par essais si la base fuit | Empreinte simple |
| Rôle dédié `PERSONALIZER` (ADR-85) | Moindre privilège sur l'opération la plus sensible | `OPERATOR_ADMIN` sur un poste d'atelier |
| Pas de compte de caisse avant la mission des caisses : espèces → `409` (ADR-89) | Aucun argent liquide sans session de caisse | Créer un compte de caisse ici |
| Rattachement : consultation réduite, lecture consommée par la demande (0016), activation depuis l'app (ADR-90) | Le contrat demandait plus que la base ne rend ; `consume_tap` exige une écriture | Garder le contrat d'origine |
| Guichet de retour sans enchaînement : `settle_balance`, `refund_deposit_by` → `422` provisoire (ADR-91, acceptée le 15/10/2026 : la mission 9 sert l'enchaînement) ; jeton sur place au-delà de `cash_refund_single_max`, conforme à §8.5 et ADR-53 | Le plan renvoie l'enchaînement à la mission 9 ; `openapi.yaml` le décrit | Réduire le contrat |
| Écritures sensibles uniquement par fonctions `SECURITY DEFINER` qui refont leurs contrôles de prestataire (ADR-94, cycles 3 à 8 de WP20) | Chaque relecture a trouvé un contournement par accès direct aux tables | Politiques RLS restrictives sur les accès directs (essayé au cycle 6, contourné) |
| Remise en stock par une route dédiée `reassignPoolMedia` (ADR-93) | Opération distincte de la restitution | La garder dans `releaseMedia` |
| Contrôle quotidien : alerte d'audit et code de sortie, pas d'anomalie (ADR-92) | La liste des sortes d'anomalie est fermée (§12.2) | Nouvelle sorte d'anomalie |
| Les fonctions de la base font les règles | §2.2 ; le schéma de référence les fournit déjà | Règles réécrites dans l'API |

## Dettes de sécurité ouvertes par cette mission
Consignées dans `docs/POINTS_OUVERTS.md` (lane t) et `docs/DECISIONS_ADR.md` (ADR-83 à ADR-97) :
- **Gardées par le refus de démarrer en production (et bloquant la production)** : OP-N41 (faux service de clés), OP-N42 (faux terminal, requêtes
  non signées ; mission 5), OP-N43 (faux festivalier ; mission 10).
- **Limites acceptées** : OP-N44 (`EXECUTE` hérité de `PUBLIC` par les rôles des processus des clés), OP-N50 (lecture
  liée à une demande encore utilisable par `consume_tap`, test pgTAP qui fige la limite).
- **Bloquent la production** : OP-N45 (aiguillage par chemin devant les processus), OP-N49 (pas de caisse), OP-N57
  (`offline_snapshot`, mission 7), OP-N58 (`offline_policy_history`, mission 7), OP-N59 (`search_path` sans `pg_temp`
  de 77 fonctions `SECURITY DEFINER`, mission 5), OP-N60 (droits de l'API sur `media_batch`, mission 11).
- **Levés avant l'acceptation** : OP-N52 (valideur d'une sortie de liste noire, migrations 0017-0018 ; limite résiduelle
  OP-N56 : une session de l'API compromise peut faire décider une demande au nom d'un vrai superviseur, mission 11),
  OP-N53 (`TRUST_PROXY_HOPS`).
- **Rattachés à une mission** : OP-N51 (enchaînement du guichet de retour, mission 9). **À trancher** : OP-N46, OP-N47,
  OP-N48, OP-N54, OP-N55.

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, domaine « Bracelets NFC » (tables « Composants par mission » et
« Décisions d'architecture notables »).

## Nécessaire pour cette mission ? Oui — nouveaux processus, nouveaux rôles de base, nouvelle bibliothèque en deux langages.
## Complet ? Oui, recalé sur l'implémentation. Reste à décrire le déploiement (aiguillage des routes vers les processus, OP-N45) quand l'exploitation l'aura arrêté.
## Validé par : Agent, par délégation du porteur (13/10/2026 ; recalage du 15/10/2026)
