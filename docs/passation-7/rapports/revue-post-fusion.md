# Mission 7 (hors-ligne-snapshots-lots-01M645RN) : revue post-fusion (05/11/2026)

Relecteur indépendant (aucune ligne de la mission écrite). Branche `feat/hors-ligne-snapshots-lots`, squash `f3bef0c0`,
accept `2865183c`, correctif `a7bbd1f8`. Diff vs main : 481 fichiers. Aucun fichier modifié par cette revue hors ce rapport.
Tests : non relancés (pgTAP 4896/4896 et Jest 3239 verts annoncés par l'orchestrateur, SKIP_LATENCY=1) ; revue par lecture
du code, des migrations, de la matrice et des rapports de relecture WP19/20/21.

## Verdict : RELEASABLE AVEC RÉSERVES

Aucun constat bloquant. Les réserves sont des points à traiter avant la PR / la recette, sans changer le verdict.

## Constats bloquants

Aucun. Vérifié : chaque écart de sécurité repéré dans le code a une entrée OP + ADR + test de borne + report
(voir tableau des écarts).

## Constats non bloquants

1. **FR-024, preuve partielle** : le câblage `LEDGER_LOCKED` / `SYNC_DEADLINE_PASSED` depuis le lecteur de conformité n'est
   prouvé qu'en unitaire (`unit/offline/period.spec.ts`, `rules/period.ts`) ; l'intégration (`processing.spec.ts`) ne couvre
   que `PERIOD_CLOSED`. La réserve n'est consignée que dans `acceptance-matrix.json`, pas dans `POINTS_OUVERTS.md`. Le
   grand livre `LOCKED` reste refusé par la base (`CL003`) : pas d'écriture indue possible, mais l'anomalie
   `LATE_OFFLINE_SYNC` côté lot n'est pas prouvée de bout en bout. Recommandation : test d'intégration en mission 13, ou
   entrée OP (hors sécurité).
2. **Mémoire de référence par lot** (`6a9f18f2`, `configuration/sql-config-resolver.ts`) : contrat et profil de juridiction
   mémorisés (immuables par déclencheur `contract_immutable` / `jurisdiction_profile_immutable`, 0007 : justifié). La
   titulaire de `PLT_REDEV` (`platform-party:<ledger>`) est mémorisée sans déclencheur qui garantisse l'immuabilité de
   `account.owner_party_id` (le commentaire du code l'admet : « seule mémorisation fragile », suivi-lots). Effet limité à un
   lot, à la destination de la redevance, aucun contrôle ne s'y appuie : pas un affaiblissement de sécurité, mais non
   consigné nulle part dans `POINTS_OUVERTS.md` / ADR. Recommandation : une ligne dans ADR-152 ou OP-N94, ou un déclencheur.
3. **PRD.md ne cite pas « OP-N89 » par son numéro** (la ligne 139 porte la substance : faux KMS refusé en production, aucun
   snapshot servi avant 12b). Cosmétique ; ajouter le numéro pour les recherches.
4. **Lignes > 100 caractères** dans les lignes ajoutées : reformatage Prettier prévu à la fusion (décision du 14/10), pas
   encore fait. À faire avant la PR.
5. **OP-N98** : écart NFR-005 (60,9 à 62,2 s pour un changement ordinaire) consigné, borné (`it.failing`), non sécuritaire.
6. **Perf** : NFR-003 p95 42,8-43,4 s (seuil 60 s) et blocage max 4,1 s (seuil 5 s, marge faible 1 s) mesurés par la
   mission sur poste ; non remesurés ici (consigne). Marge réelle en production inconnue : à remesurer en recette.
7. Tests hors passe parallèle : `snapshot-keys/rotation`, `key-admin-worker` (SKIP_LATENCY / série en CI, `a7bbd1f8`) et
   `offline-isolation` rouge en parallèle seulement (état global) : vérifier que la CI les lance bien en série.
8. Relevé : les « mineurs » de WP18 ont été perdus avec une session (suivi-lots) ; non récupérables.

## Couverture des FR (44/44 pass dans la matrice, vérifiée par échantillon contre le code)

| Groupe | FR | Lots | Constat |
|---|---|---|---|
| Politique, plafonds, risque, historique, configs servies | 001-005, 027 | WP02, WP14, WP07 | Couvert (pgTAP `tests_offline_policy`, `policy.spec`) |
| Snapshots : version base, contenu, cadence, signature, chiffrement, distribution | 006-011 | WP03, WP04, WP11-13, WP15 | Couvert ; cadence 60 s : OP-N98 |
| Session vendeur | 012 | WP07, WP08 | Couvert |
| Lots : réception, chaînage, traitement, idempotence, empreinte | 013-018 | WP05, WP17, WP18, WP19 | Couvert |
| Vente, conflits, annulation, conformité, périodes, horloge, signature | 019-026 | WP17, WP19 | Couvert ; FR-024 réserve (n°1) |
| Espèces portées par lot | 028 | WP19 | Couvert (NFR-014) |
| Reprise, abandon, trous, levée à deux, hérités, alerte | 029-034 | WP05, WP06, WP18, WP20 | Couvert |
| Import de journal, sonde | 035-036 | WP20, WP21 | Couvert |
| Port de clés, droits, rôle de maintenance, bornage | 037-041 | WP08-WP10, WP13, WP21 | Couvert ; OP-N57/58/68/69/75 levées avec tests inversés |
| Contrat/types, audit, tests minimaux du protocole | 042-044 | WP01, WP21 | Couvert (042 par commande, pas test nommé) |

NFR : 001-002, 006-014 confirmées par tests ; 003-005 mesurées sur poste ; 015 par l'orchestrateur. Invariants négatifs NI-001 à
NI-005 confirmés (rejoués 76/76 ; `.sql` générés = sortie des générateurs ; aucune dépendance).

## Dérives par rapport au plan (toutes consignées)

Migrations hors plan : 0050 (ADR-146), 0051 (ADR-148, OP-N96), 0052-0057 (ADR-152, performance, sans changement de droit :
`CREATE OR REPLACE`, `SET search_path` présent sur chaque fonction DEFINER, `assert_tenant` en premier). Vérifié : aucun
`GRANT ... TO PUBLIC` ajouté ; toutes les fonctions DEFINER 0043-0057 portent `SET search_path` ; le droit par défaut global
(`post-roles.sql` §8a) est en place et testé (`tests_default_acl.sql`). `cash-topup.service.ts` passe par `lock_device`
(conséquence d'OP-N69, plus strict). Aucun `.sql` généré touché.

## Écarts de sécurité ouverts (règle 4)

| OP / ADR | Écart | Bloque la prod | Test de borne | Report PROMPTS/PRD | Consigné |
|---|---|---|---|---|---|
| OP-N89 / ADR-138 | Faux KMS (`SignPort`, `DataKeyPort`) pour les snapshots | Oui (démarrage refusé en production) | `production-guard.spec`, `production-start.spec`, `offline-production.spec`, `crypto-production.spec` | oui (PRD sans le numéro) | oui |
| OP-N90 / ADR-139 | Trace `RETRY` : numéro sans résultat final admis à la clôture | Non | `tests_offline_batches.sql` | oui | oui |
| OP-N91 / ADR-140 | `EXECUTE` en plus pour snapshsign/snapcontent ; lecture inter-prestataires `device_journal_imports_processing` | Non | `tests_execute_grants.sql`, `tests_offline_batches.sql` (colonnes figées) | oui | oui |
| OP-N92 / ADR-142-143 | Lectures de `snapshot_signing_key` par `cashless_keyadmin` ; rotation sans approbation à deux, acteur non vérifié | Non | `tests_offline_rights.sql`, `rotation.spec` | oui | oui |
| OP-N93 / ADR-144 | Limites du contenu/signature (clés par prestataire, entrée sans mot de passe, clé d'emballage sans référence…) | Non | `offline-bounds.spec`, `orphan-config.spec`, `crypto-encryptor.spec` | oui | oui |
| OP-N94 / ADR-145-146 | Choix de lots/import, `0050`, `lock_device`, acteurs non contrôlés par la base | Non | `offline-bounds.spec` (1-3) | oui | oui |
| OP-N95 / ADR-147 | `500` au lieu de `413`, corps d'import jusqu'à ~21 Mo, `DATABASE_URL_MAINT` (point 3 levé) | Non | `offline-bounds.spec`, `process-guard.spec` | oui | oui |
| OP-N96 / ADR-148 | Enveloppe DEFINER `event_device_sync_status_api` ouverte à `cashless_app` | Non | `tests_offline_rights.sql`, `tests_execute_grants.sql` | oui | oui |
| OP-N97 / ADR-150 | Exemption de `pwd_pack_enc` dans la garde de noms secrets | Non | `architecture.spec` (liste figée) | oui | oui |
| OP-N98 / ADR-151 | NFR-005 (non sécuritaire) | Non | `cadence-bounds`, `snapshot-latency` | oui | oui |
| ADR-141 (OP-N86) | `INSERT` direct sur `anomaly` gardé pour `cashless_app` | Non | tests de droits | rattaché à OP-N86 | oui |
| Non consigné (n°2) | Mémoire de lot de la titulaire `PLT_REDEV` | Non | aucun | non | non (non bloquant : pas un affaiblissement) |

Levées vérifiées : OP-N57, N58, N68, N69, N75 (lignes « levé » dans POINTS_OUVERTS, tests inversés, ADR-111/112/114/137).
Aucun faux sans garde : fakes de la mission (`FakeKms`, chiffreur d'entrées, `FakeOperationProcessor`) portent `isFake` et
`assertNoFakeInProduction` / `OfflineProcessorGuard` les refuse.

## Fichiers à faire relire par une personne (clés, droits de la base, cryptographie)

- Migrations `0043` à `0049` (fonctions DEFINER, droits, `lock_device`, plancher de numérotation) et `post-roles.sql`
  (§8a droit par défaut, §8g rôle `cashless_maint`, rôles `cashless_snapsign`, `cashless_snapcontent`, `cashless_keyadmin`).
- Migrations `0050`, `0051`, `0052`, `0054`, `0055`, `0057` (DEFINER, `offline_snapshot_source_rows`), `0056` (index).
- Cryptographie : `apps/api/src/snapshots-content/` (chiffrement des entrées, enveloppes de clés de contenu, `DekCache`),
  `apps/api/src/snapshots-signer/` (`snapshot-signer.worker.ts`, concurrence), `apps/api/src/kms/fake-kms.ts` et
  `kms.ports.ts`, rotation des clés de signature (`snapshot-keys`), vérification de signature de lot et empreinte RFC 8785.
- `batch-runner.ts` (garde sous verrou), `offline-operation.processor.ts`, `sql-config-resolver.ts` (périmètre de la mémoire).
- `apps/api/src/db/advisory-session.ts`, `MaintenanceDbModule` (garde de rôle au démarrage), garde des noms secrets
  (`architecture.spec.ts`).

## Avant PR / recette

Reformatage Prettier (100 car.) ; remesure NFR-003/004/005 hors poste de développement ; CI : lancer en série les suites à
état global ; décider du sort des réserves n°1 et n°2 ; relecture humaine ci-dessus.
