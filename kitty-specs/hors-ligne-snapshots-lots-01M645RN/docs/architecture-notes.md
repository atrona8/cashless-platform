# Notes d'architecture — mission hors-ligne-snapshots-lots-01M645RN

> État : **implémentée, relue et approuvée le 04/11/2026** (21 lots sur 21, WP21 au cycle 2) ; en attente d'acceptation
> et de fusion. Recalé sur le code de la lane `u`. Plan : `plan.md`, `research.md` R-02 à R-21 et R-30, `data-model.md`,
> `contracts/`. En cas d'écart, le code et `contracts/interfaces.md` (migrations définitives) font foi.

## Composant(s) introduit(s) ou modifié(s) par cette mission
- **API publique** (`apps/api`, NestJS) : dossier `offline/` avec `policy/` (politique, plafond, risque), `snapshots/`
  (service et accusé, lecture seule), `batches/` (contrôleur, contrôles d'entrée, `body-gate` : identité vérifiée avant
  la lecture du corps, signature, chaîne, verrous de lot sur un pool dédié), `processing/` (processeur d'opération,
  écrivains de vente et d'annulation, conformité, part non couverte), `rules/` (fonctions pures : conformité, conflit,
  période, porteur de la perte), `anomalies/`, `seq/` (trou, `seq-status`, `device-sync-status`) et `journal/` (import).
  Elle ne détient aucun secret.
- **Processus `snapshot-content`** (rôle `cashless_snapcontent` ; ports `DecryptPort` et `DataKeyPort`) : calcule
  l'artefact, chiffre les mots de passe sous une clé par version, enveloppe cette clé pour chaque terminal, écrit un
  brouillon non signé. Aucun droit sur `offline_snapshot`.
- **Processus `snapshot-signer`** (rôle `cashless_snapsign` ; port `SignPort` seul) : relit le brouillon, recalcule
  l'empreinte, signe l'en-tête, **vérifie sa signature contre la clé publique du `key_id`** (lecture de
  `snapshot_public_keys`, droit accordé par le porteur le 02/11/2026, ADR-142), publie par `publish_offline_snapshot`.
  Un brouillon qui ne se vérifie pas est jeté, jamais signé (alarme). **Un signataire par grand livre** : les
  brouillons d'un grand livre sont traités en série et dans l'ordre, les grands livres en parallèle ; un FULL d'un
  grand livre ne retarde plus le DELTA d'un autre. Aucun droit sur les mots de passe ni sur `tag_data_key`.
- **Processus `key-admin`** (existant, rôle `cashless_keyadmin`) : nouveau travailleur `snapshot-key-admin` qui fait
  tourner la clé de signature des snapshots (`--once` avec `SNAPSHOT_KEY_ROTATE_ACTOR`, sans approbation à deux,
  ADR-143) ; `KeyAdminPort` élargi d'un `publicKey(ref)` en lecture seule, sans `sign`.
- **Processus `maintenance`** (rôle `cashless_maint`) : purge des nonces et des tentatives d'enrôlement. En production,
  un `DATABASE_URL_MAINT` qui vise le propriétaire ou un superutilisateur est refusé au démarrage (`maintenance-role-guard`).
- **Tranches coopératives** (`processes/cooperative.ts`) : empreinte, chiffrement et vérification du signataire se
  découpent pour ne pas bloquer la boucle d'événements (NFR-005).
- **Ports et faux** : `SignPort` (nouveau) avec faux KMS ; le faux est refusé au démarrage en production
  (`createKms`, `assertProcessIsSafe`), un test le prouve.
- **Base** (`packages/ledger-sql`, migrations `0043` à `0057`, `post-roles.sql`). Numérotation définitive (celle du
  plan, `0043` à `0048`, était décalée) : `0043` politique, `0044` snapshots (brouillon, contenu, état, journal des
  changements), `0045` enveloppes par terminal, lecture pour le terminal, clés de signature, `0046` lots (ouverture et
  clôture remplacées, canal `IMPORT`, import de journal, `offline_batch_retry`, `offline_op_result`), `0047` anomalies et
  `wallet_status_history`, `0048` accusé, vendeur daté, configuration en vigueur, nom de station, `0049` durcissement
  (`lock_device`, audit des clés de signature, exposition renforcée). **Hors plan** : `0050` annulation d'un import
  resté `PENDING` ; `0051` enveloppe `event_device_sync_status_api` ; `0052` exposition bornée par la fenêtre de
  tolérance (+ 4 index) ; `0053`, `0054`, `0055`, `0057` lecture des changements de snapshot (`offline_snapshot_source_rows`
  : sans matérialisation, par candidats indexés, retraits en `EXCEPT`, lecture latérale par candidat) ; `0056` trois
  index sur les historiques de bracelet. Équivalence prouvée par pgTAP, aucun droit changé par 0052 à 0057. Dix tables
  nouvelles, fermées et cloisonnées par `operator_id` ; écritures par fonctions seulement ; nouveaux rôles
  `cashless_snapcontent`, `cashless_snapsign`, `cashless_maint` ; défaut global pour le rôle propriétaire de `migrate.ts`.
- **Contrat** (`packages/contracts`) : 10 opérations ajoutées (neuf prévues plus `getDeviceJournalImport`), 167 chemins et
  202 opérations au total ; corrections d'`openapi.yaml` (signatures DER, enveloppe de clé, `409` de lot, bornes 2^53-1,
  `vendor_session_id` des opérations) ; types TS et Dart régénérés ; `packages/tag-format` : enveloppe de snapshot et
  vecteurs.

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
| **Ajoutées à l'implémentation (review du 04/11/2026)** | | |
| Signataire par grand livre, vérification de la signature par la clé publique (02/11 et 04/11) | NFR-005 : un FULL n'en retarde pas un autre ; aucune signature publiée sans contrôle | Signataire en série ; vérifier seulement l'en-tête |
| 404 neutre sans le rôle voulu (ADR-149) | Pas de fuite d'existence d'un terminal ou d'un import | `403` (existence révélée dans un même prestataire) |
| Exemption étroite de la garde des noms secrets pour `pwd_pack_enc`, dans `offline-snapshots.service.ts` seul (ADR-150, OP-N97) | L'API publique relaie le mot de passe chiffré pour le terminal appelant ; les autres noms et `SELECT * FROM media` restent interdits | Retirer la garde ; déplacer la lecture |
| Enveloppes DEFINER étroites : `event_device_sync_status_api` (0051), `lock_device` (0049) | Servir `device-sync-status` sans rouvrir les fonctions sous-jacentes | Accorder les fonctions de la mission 5a à `cashless_app` |
| Mémoire de référence limitée à un lot ; état du lot relu dans la transaction de l'opération, après `lock_device` (partie J) | NFR-003 : 48,5 puis 39,5 requêtes par opération ; plus strict (sous le verrou du terminal) | Mémoriser statuts, configuration datée ou soldes : écarté |
| Lecture des changements de snapshot par candidats indexés (0053 à 0057) | NFR-005 : un DELTA ne relit plus les 50 000 jetons ; robuste sans statistiques | `enable_nestloop = off` sur la fonction : écarté |
| Changement ordinaire visible en 60 s plus la boucle (OP-N98, ADR-151) | Seuls les changements bloquants tiennent 5 s ; dette nommée avec test de borne | Abaisser `DELTA_AFTER_MS` : écarté |
| Trace `RETRY` en base pour le rejet réessayable (R-30.11, 30/10) | Un numéro sans résultat final n'est admis que s'il a une trace | Aucune trace (perte silencieuse) |
| Pool dédié aux verrous de lot, `503` si plein (R-30.7) | Le pool de l'API n'est pas épuisé par les lots | Verrous sur le pool commun |

## Dettes nommées (règle 3 de `CLAUDE.md`)
- **Faux KMS jusqu'à la mission 12b** : le faux `SignPort` et les clés de contenu simulées sont refusés au démarrage
  en production ; aucun snapshot n'est servi en production avant 12b. Entrée `POINTS_OUVERTS`, ADR, test de borne,
  reports `PROMPTS-A-ENVOYER.md` et `PRD.md`. OP-N41 et OP-N73 restent ouverts.
- **Trace `RETRY`** : écart accepté à l'invariant I2 (un numéro sans résultat final admis à la clôture d'un lot).
  ADR, entrée `POINTS_OUVERTS`, test qui échoue si un numéro sans trace est admis, alerte du travailleur `seq-gap-age`
  à 24 h.

- **Autres dettes nommées à la review** : OP-N91 (droits ajoutés), OP-N92 (clés de signature, rotation sans approbation à
  deux), OP-N93 (limites des processus de contenu et de signature ; clés publiques par prestataire en 12b), OP-N94
  (choix classés neutres dans les lots), OP-N95 (limites de corps ; `DATABASE_URL_MAINT` levé), OP-N96 (0051), OP-N97
  (exemption `pwd_pack_enc`), OP-N98 (60 s). Les écarts qui affaiblissent la sécurité (ADR-140 à 144, 146, 148, 150) ont
  été soumis au porteur avant d'être codés.

## Fichiers à faire relire par une personne (règle 4)
`post-roles.sql` ; migrations `0044`, `0045`, `0046`, `0048`, `0049`, `0050`, `0051` et `0054`, `0055`, `0057`
(`offline_snapshot_source_rows`, DEFINER) ; `kms/` (`SignPort`, faux) ; `snapshot-content` (chiffrement, enveloppes,
`device-envelope.ts`, `snapshot-draft.repository.ts`, `advisory-session.ts`) ; `snapshot-signer` (`header-signer.ts`,
`draft-verifier.ts`, `snapshot-signer.worker.ts`) ; `wrap_offline_snapshot_key` ; `complete_offline_batch` et
`offline_batch_retry` ; fonction d'import du journal et `journal-import.action.ts` ; `ledger-engine.service.ts`
(somme `SUSPENSE`), `money/spend.ts`, `offline-sale.writer.ts`, `shortfall-reduction.ts` ; `batch-runner.ts`,
`offline-operation.processor.ts`, `sql-config-resolver.ts` (périmètre de la mémoire) ; `authentication.guard.ts`,
`body-gate.ts` ; `maintenance-role-guard.ts`. L'agent qui a écrit le code ne vaut pas relecture indépendante.

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » (deux processus de snapshots dont un
signataire par grand livre, KMS simulé jusqu'à 12b, recharge espèces hors ligne retirée, trace `RETRY`, 404 neutre) et
conteneurs (processus `snapshot-content`, `snapshot-signer`, `maintenance`).

## Nécessaire pour cette mission ? Oui — nouveaux processus, nouveaux rôles de base, nouveau port, quinze migrations (dont neuf hors plan) et des décisions de sécurité à garder visibles.
## Complet ? Oui, recalé à la review (05/11/2026) sur le code livré : migrations 0043 à 0057, routes servies, écarts au plan. Les limites de mesure (NFR-003 p95 43,4 s et 42,8 s pour un seuil de 60 s ; NFR-004 FULL de 50 000 en 27,6 s ; DELTA servi p95 60 ms ; NFR-005 blocage au plus 4,1 s) sont au suivi de la mission, pas dupliquées ici.
## Validé par : proposition de l'Agent, à confirmer par le porteur, le 05/11/2026
