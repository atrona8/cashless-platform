# Notes d'architecture — mission hors-ligne-snapshots-lots-01M645RN

> État : **plan finalisé le 30/10/2026** (`plan.md`, `research.md` R-02 à R-21 et R-30, `data-model.md`, `contracts/`).
> Composants **prévus**, pas encore implémentés.

## Composant(s) introduit(s) ou modifié(s) par cette mission
- **API publique** (`apps/api`, NestJS) : dossier `offline/` avec `policy/` (politique, plafond, risque), `snapshots/`
  (service et accusé, lecture seule) et `batches/` (contrôleur, contrôles d'entrée, signature, chaîne, processeur
  d'opération, reprise, trou, import). Elle ne détient aucun secret.
- **Processus `snapshot-content`** (rôle `cashless_snapcontent` ; ports `DecryptPort` et `DataKeyPort`) : calcule
  l'artefact, chiffre les mots de passe sous une clé par version, enveloppe cette clé pour chaque terminal, écrit un
  brouillon non signé. Aucun droit sur `offline_snapshot`.
- **Processus `snapshot-signer`** (rôle `cashless_snapsign` ; port `SignPort` seul) : relit le brouillon, recalcule
  l'empreinte, signe l'en-tête, publie par `publish_offline_snapshot`. Aucun droit sur les mots de passe ni sur `tag_data_key`.
- **Processus `maintenance`** (rôle `cashless_maint`) : purge des nonces et des tentatives d'enrôlement.
- **Ports et faux** : `SignPort` (nouveau) avec faux KMS ; le faux est refusé au démarrage en production
  (`createKms`, `assertProcessIsSafe`), un test le prouve.
- **Base** (`packages/ledger-sql`, migrations `0043` à `0048`, `post-roles.sql`) : `0043` politique, `0044` snapshots
  (publication, contenu, état, journal, clés de signature), `0045` lots (ouverture et clôture remplacées, canal `IMPORT`,
  import de journal, `offline_batch_retry`), `0046` anomalies et `wallet_status_history`, `0047` accusé, station et
  session de vendeur datée, `0048` droits. Tables nouvelles fermées et cloisonnées par `operator_id` ; écritures par
  fonctions seulement ; nouveaux rôles `cashless_snapcontent`, `cashless_snapsign`, `cashless_maint` ; défaut global
  pour le rôle propriétaire de `migrate.ts`.
- **Contrat** (`packages/contracts`) : routes de politique et de risque ajoutées, corrections d'`openapi.yaml`
  (signatures DER, enveloppe de clé, `409` de lot, bornes 2^53-1) ; types TS et Dart régénérés.

## Décisions d'architecture prises dans cette mission
| Décision | Justification | Alternative envisagée |
|---|---|---|
| Aucune recharge espèces hors ligne (R-02, 30/10) ; `CHECK (cash_topup_offline IS NOT TRUE)` | Ferme tout chemin d'espèces sans contrôle de caisse ; garde de caisse inchangée | Refus du lot entier : écarté, le terminal ne pourrait pas retirer l'opération sans trou |
| Politique écrite par fonction, historique par la base (R-03) | Écritures contrôlées, lève OP-N58 | Écriture directe avec déclencheur de portée |
| Deux processus de snapshots (R-04, R-30.8, 30/10) | Celui qui lit les secrets ne peut pas publier ; celui qui signe ne lit aucun secret ; l'API publique reste sans secret | Un seul processus ; production dans l'API publique : élargit l'API aux secrets |
| Une version = un artefact : `FULL` ou `DELTA` de la version précédente (R-05) | Une signature par version sans port de signature dans l'API ; fidèle au schéma | Composer les `DELTA` à la demande (latence) ; `FULL` à chaque version (50 000 lignes par minute) |
| Version calculée par la base à la publication (R-05, OP-N57) | Rien à planter côté appelant | Version fournie par le producteur |
| Cadence : boucle de 1 s, 60 s après un changement, 5 s après un blocage ; version de maintien (R-06) | Tient les seuils du porteur (DELTA 2 s p95) | `LISTEN/NOTIFY` : aucun usage existant, perte à la reconnexion |
| Signature ECDSA P-256 en DER sur `JCS(header)`, deux clés au plus (R-07) | Exemple existant en DER ; rotation possible | Format brut (r‖s) |
| Mots de passe chiffrés sous une clé par version, enveloppée pour chaque terminal `ACTIVE` (R-08) | Propre à un terminal ; rien pour un terminal révoqué | Une clé par grand livre renouvelée à la révocation |
| Accusé idempotent, jamais en recul (R-09, OP-N69) | Le serveur sait quelle version le terminal détient | Pas d'accusé |
| Contrôles d'entrée complets avant tout traitement ; empreintes et chaîne recalculées (R-10) | Aucune confiance dans les valeurs déclarées | Vérifier seulement la signature |
| Une transaction par opération, dans l'ordre ; reprise sous verrou de session (R-11) | Une panne ne perd ni ne double aucune opération | Une transaction pour tout le lot |
| Conformité sur la configuration détenue ; exposition « ventes non acquittées », strict (R-12, 30/10) | Juge le terminal sur ce qu'il savait | Cumul de toutes les ventes sans acquittement |
| Numéros refusés au-delà de 2^53-1 (R-14) | Inatteignables avec la borne de +10 000 ; plus sûr de refuser | Accepter en texte |
| Table de conflit en fonction pure ; manque en `S-ATTENTE` (R-16) | Le commerçant conforme est crédité du total | Débit partiel sans compte d'attente |
| Anomalies et clés de signature écrites par fonctions seulement (R-17) | Pas d'écriture directe par l'API | Écriture directe |
| Levée de trou à deux (R-18) ; trou de plus de 24 h : alerte seule | Décision à deux ; rien d'automatique | Levée automatique |
| Import de journal à deux, empreinte portée par la demande (R-19, R-30.10) | Journal d'un terminal révoqué non fiable sans contrôle humain | Import direct |
| Dettes de droits OP-N57, OP-N58, OP-N68, OP-N69, OP-N75 levées (R-20) | Chacune avec un test de borne | Report à la mission suivante |
| Aucune nouvelle dépendance (R-22) | `node:crypto`, `canonicalize` suffisent | Bibliothèque de signature tierce |
| Trace `RETRY` en base pour le rejet réessayable (R-30.11, 30/10) | Un numéro sans résultat final n'est admis que s'il a une trace | Aucune trace (perte silencieuse) |
| Pool dédié aux verrous de lot, `503` si plein (R-30.7) | Le pool de l'API n'est pas épuisé par les lots | Verrous sur le pool commun |

## Dettes nommées (règle 3 de `CLAUDE.md`)
- **Faux KMS jusqu'à la mission 12b** : le faux `SignPort` et les clés de contenu simulées sont refusés au démarrage
  en production ; aucun snapshot n'est servi en production avant 12b. Entrée `POINTS_OUVERTS`, ADR, test de borne,
  reports `PROMPTS-A-ENVOYER.md` et `PRD.md`. OP-N41 et OP-N73 restent ouverts.
- **Trace `RETRY`** : écart accepté à l'invariant I2 (un numéro sans résultat final admis à la clôture d'un lot).
  ADR, entrée `POINTS_OUVERTS`, test qui échoue si un numéro sans trace est admis, alerte du travailleur `seq-gap-age`
  à 24 h.

## Fichiers à faire relire par une personne (règle 4)
`post-roles.sql` ; migrations `0044`, `0045` et `0048` ; `kms/` (`SignPort`, faux) ; `snapshot-content` (chiffrement,
enveloppes) ; `snapshot-signer` ; `wrap_offline_snapshot_key` ; `complete_offline_batch` et `offline_batch_retry` ;
fonction d'import du journal. L'agent qui a écrit le code ne vaut pas relecture indépendante.

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » (deux processus de snapshots, KMS simulé
jusqu'à 12b, recharge espèces hors ligne retirée, trace `RETRY`) et conteneurs (processus `snapshot-content`,
`snapshot-signer`, `maintenance`).

## Nécessaire pour cette mission ? Oui — nouveaux processus, nouveaux rôles de base, nouveau port, six migrations et des décisions de sécurité à garder visibles.
## Complet ? Oui pour le plan du 30/10/2026 ; à recaler à la review sur le code livré (noms de fonctions et de fichiers, écarts au plan).
## Validé par : proposition de l'Agent, à confirmer par le porteur, le 30/10/2026
