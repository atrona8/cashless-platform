# Relecture indépendante — correctif post-fusion n° 1 (bracelets-nfc-01M4TD3W)

- **Date** : 16/10/2026
- **Branche, commits** : `feat/bracelets-nfc`, `be8594e` (SEC-1), `38b3943` (RISK-3, RISK-4),
  `00fb6ae` (documentation)
- **Référentiel** : `post-merge-fix-1.md` ; section SEC-1 de `mission-review-report.md`
- **Relecteur** : agent indépendant. Il n'a pas écrit ce code, ne l'a pas modifié et n'a rien
  commité.

## Verdict : APPROUVÉ

SEC-1 est corrigé dans la base et dans les programmes. La démonstration de la revue ne passe plus,
et aucune des variantes essayées ne passe. RISK-3 et RISK-4 sont faits et testés. La documentation
est complète : ADR-102 à ADR-104, OP-N47, OP-N62, OP-N63 et leurs reports. Aucun `.sql` du kit n'a
été modifié.

Il reste des observations non bloquantes (§5). Le porteur doit en connaître deux :
- la garantie à deux reste bornée par OP-N56, démontré ci-dessous (P12) ;
- OP-N63 attend sa décision.

## 1. Base : migration 0020 et `post-roles.sql`

Lecture complète de `0020_tag_key_job_approval.sql` et du diff de `post-roles.sql`.

**Sondes rejouées depuis `cashless_app`** dans une transaction annulée, sur les données du test
pgTAP. Script : `scratchpad/review/probe.sql`.

| # | Tentative | Résultat |
|---|---|---|
| P1 | `INSERT` direct d'un travail `DISABLE_KMS_KEY` sur la clé partagée ACTIVE, puis `RETIRE_KEY`, puis `CREATE_KEY` | `permission denied for table tag_key_job` (×3) |
| P2 | `COPY` vers `tag_key_job` | refusé |
| P3 | `enqueue_tag_key_child_job` appelé par l'API | `permission denied for function` |
| P4 | `enqueue_tag_key_job` sur une demande PENDING, REJECTED, puis d'un autre prestataire | `CL023`, `CL023`, `Objet introuvable` |
| P5 | Table temporaire `approval_request` contenant une ligne APPROVED forgée, avec `search_path = pg_temp, public` | `Objet introuvable` : la fonction lit `public` |
| P6 | Chemin nominal (retrait de la clé dédiée), puis seconde consommation de la même demande | nominal accepté ; seconde consommation refusée (`déjà consommée`) |
| P7 | Retrait d'une clé partagée | `CL020` |
| P8 | `DELETE` du travail pour libérer la demande | `permission denied` |
| P9 | Demande EXECUTED remise en APPROVED | refusé par `approval_request_guard` |
| P10 | `UPDATE` de `key_index` d'un travail ; travail passé DONE | `permission denied` ; refusé par la contrainte `tag_key_job_finished` |
| P11 | `INSERT` d'une demande déjà APPROVED | `elle naît PENDING` (garde 0017) |
| P12 | `decide_approval_request` appelé par l'API au nom d'un second OPERATOR_ADMIN réel | **passe**. C'est OP-N56, limite connue et consignée (voir §5, O1) |

**Cas couverts par le test pgTAP** (lus et rejoués) :
- enfant sans parent RUNNING ;
- parent sans demande, ou dont la demande porte une autre action ;
- `DISABLE_KMS_KEY` sur une clé ACTIVE ;
- second enfant pour le même parent ;
- valideur sans attribution OPERATOR_ADMIN ;
- demande d'une action étrangère aux clés.

**Configuration des fonctions** (`pg_proc`) :

| Fonction | `prosecdef` | `search_path` | `EXECUTE` |
|---|---|---|---|
| `enqueue_tag_key_job` | oui | `public, pg_temp` | `postgres`, `cashless_app` |
| `enqueue_tag_key_child_job` | oui | `public, pg_temp` | `postgres`, `cashless_perso` |
| `tag_key_job_refusal` | oui | `public, pg_temp` | `postgres`, `cashless_tagkeys`, `cashless_perso`, `cashless_keyadmin` |
| `retire_dedicated_key` (kit) | oui | `public`, **sans `pg_temp`** | `postgres`, `cashless_perso` |

Pour `retire_dedicated_key`, voir O2 : l'absence de `pg_temp` est antérieure au correctif.

Aucun rôle applicatif n'a `INSERT`, `DELETE` ni `TRUNCATE` sur `tag_key_job`. `cashless_app` n'a
pas `CREATE` sur `public`.

**Contrôle du contrôle.** On rétablit `GRANT INSERT ON tag_key_job TO cashless_app` et `EXECUTE`
de `retire_dedicated_key` à `PUBLIC`, puis on relance pgTAP. Résultat : les tests 2, 3, 5 à 12 et
suivants échouent. Après `reset-db`, la suite repasse à 52/52.

## 2. Programmes

Fichiers lus : `job-gate.ts`, `key-admin.worker.ts`, `dek.worker.ts`, `reencrypt.worker.ts`,
`keys.service.ts`, `key-approval-actions.ts`.

**Revérification avant le KMS.** Dans les trois exécutants, `gate.admit(job, …)` est appelé juste
après la prise du travail. Il précède tout appel au port de clés :
- `createKey` et `disableKey` ;
- `generateDataKey` ;
- `decrypt`.

Les seuls consommateurs de `claimJobQuery` sont ces trois exécutants.

**Travail refusé.** Il passe FAILED avec son motif, une ligne d'audit `TAG_KEY_JOB_REFUSED` est
écrite, et le processus lève le code d'alerte 4. Une relance par l'API (`retry`) est refusée de
nouveau ; `keys.spec.ts` le vérifie.

**Garde fermée.** Si `tag_key_job_refusal` lève une erreur, l'exception remonte avant tout appel au
KMS, et le travail reste verrouillé.

**`disableKey`.** Il relit le statut de la clé et refuse une clé qui n'est pas `RETIRED` avant
d'appeler le KMS.

**Création des travaux.** L'API ne crée plus de travail que par `enqueue_tag_key_job(demande)` :
la sorte, l'index et les personnes sont fixés par la base. La personnalisation passe par
`enqueue_tag_key_child_job`.

**Concordance avec `tag_key_job_refusal`.** Le résultat écrit par l'API (`tagKeyJobDto`) contient
bien `job_id` et `key_index`, les deux champs que la fonction relit.

**Tests Jest des travaux plantés.** Ils vérifient l'absence d'appel au KMS :
- `calls.disableKey`, `calls.createKey`, `calls.generateDataKey` et `calls.decrypt` restent à 0 ;
- la clé partagée n'est pas désactivée dans le faux.

## 3. Démarrage

`loadConfig` refuse `NODE_ENV` absent ou hors de `production`, `development` et `test`. Le code ne
lit `NODE_ENV` nulle part ailleurs.

En production, `TAG_WRAPPING_KEY_REF` vide et `CLAIM_CODE_DOMAIN` vide sont refusés au chargement.
Aucune autre référence de clé ou de secret de la configuration n'est acceptée vide en production :
- `CLAIM_CODE_HMAC_KEY`, les URL de base et `TRUST_PROXY_HOPS` étaient déjà exigés ;
- les URL des processus des clés sont refusées vides par le processus qui s'en sert.

`processes.spec.ts` démarre réellement les cinq processus sans `NODE_ENV`, ou avec `prod`,
`staging` et `''` : tous refusent. La CI pose `NODE_ENV=test`, et `env.sh` pose `development` par
défaut.

## 4. Documentation et fichiers du kit

- **ADR-102** : complet (contexte, cycle de vie vérifié, décision, limites OP-N56 et OP-N62, autres
  files examinées, fichiers à faire relire). ADR-83 est complété par la réserve OP-N56.
- **ADR-103** (DRIFT-2) : raison et impact sur la mission 12, avec report.
- **ADR-104** et **OP-N47** : mission 10 « proposée par l'agent, à confirmer par le porteur ».
  Reports faits dans `PROMPTS-A-ENVOYER.md` et `PRD.md`.
- **ADR-99** : la contradiction de statut est supprimée.
- **OP-N62** : fiche complète (risque, ce qui est en place, mission, condition de levée), avec un
  test qui borne la limite (droit `EXECUTE` limité à la personnalisation, prouvé par le contrôle du
  contrôle). Reports faits pour la mission 5.
- **OP-N63** : signalé, décision du porteur attendue. Reports faits pour la mission 5.
- **Journal** de `06-docs-status.md` : renseigné.
- **Fichiers du kit** : `git diff main -- packages/ledger-sql/*.sql` ne touche que `post-roles.sql`,
  qui est un fichier de la mission. `roles.sql`, le schéma, `tests_grand_livre_cashless.sql` et
  `scenario_reference_test.sql` sont intacts. Ni les générateurs ni `scenario_reference.json` n'ont
  été modifiés.

Je n'ai trouvé aucun écart affaiblissant non consigné. L'`EXECUTE` de `retire_dedicated_key`
accordé nommément à `cashless_perso` n'élargit rien : ce rôle l'avait déjà par `PUBLIC`
(OP-N44). Le correctif le retire à tous les autres.

## 5. Observations (non bloquantes)

### Défauts antérieurs au correctif

**O1 — OP-N56, connu et consigné.** P12 montre qu'une session de l'API compromise peut encore :
1. créer une demande `TAG_KEY_RETIRE` ;
2. la faire décider par `decide_approval_request` au nom d'un second OPERATOR_ADMIN réel ;
3. inscrire le travail par `enqueue_tag_key_job`.

Le travail obtenu est alors indiscernable d'un travail légitime, pour la base comme pour les
exécutants. Le correctif ferme la file libre, mais la garantie « deux personnes » face à une API
compromise dépend encore de la mission 11. ADR-83 et ADR-102 le disent explicitement.

**O2 — OP-N59, connu et consigné.** `retire_dedicated_key` (kit) a `search_path=public` sans
`pg_temp`, et `cashless_perso` a le droit `TEMP`. Le point relève d'OP-N59 et d'ADR-96 (mission 5,
bloque la production). L'exposition ne s'élargit pas : l'API et `PUBLIC` perdent ce droit.

### Défaut du correctif (mineur)

**O3 — Pas de borne de temps entre la décision et l'inscription.** `enqueue_tag_key_job` ne borne
pas le délai entre `decided_at` et l'inscription. Une demande restée APPROVED (cas anormal :
l'exécution se fait dans la transaction de la décision) peut produire son travail plus tard.

Risque faible : la demande a bien été approuvée à deux, et elle reste consommable une seule fois.
Suggestion facultative : refuser au-delà de `expires_at`.

## 6. Avis sur OP-N62 et OP-N63

### OP-N62 — gravité faible ; pas de correction immédiate

L'attaque suppose un processus de personnalisation compromis. Ce processus détient déjà les ports
`mac` et `dataKey`, c'est-à-dire de quoi calculer les mots de passe des bracelets : il est bien
plus dangereux par ailleurs.

L'effet est destructif mais borné. `retire_dedicated_key` exige que tous les lots soient clos. La
désactivation dans le KMS reste soumise à une demande approuvée.

La mission 5 (avec OP-N44) convient. « Bloque la production : Non » est cohérent. À confirmer par
le porteur.

### OP-N63 — gravité moyenne ; pas de correction immédiate, mais il faut une décision

Le défaut est antérieur au correctif : `roles.sql` du kit accorde `UPDATE (agreement_public_key)`
à `cashless_app`. La mission 4 a ajouté le consommateur de cette clé (`POST /media/auth-keys`).

Effets possibles :
- un déni de service immédiat : le terminal ne peut plus déchiffrer ;
- la lecture d'un mot de passe de bracelet, si l'attaquant intercepte la réponse.

Aujourd'hui, OP-N42 domine : l'identité du terminal est un faux qui croit des en-têtes, ce qui
permet déjà d'appeler la route.

La correction naturelle accompagne l'enrôlement réel (mission 5). Je recommande au porteur :
- de trancher maintenant la mission de levée ;
- de classer OP-N63 « bloque la production : Oui », comme OP-N42 ;
- d'écrire alors l'ADR et le test qui fige `UPDATE (agreement_public_key)` (règle 3).

Le porteur ne l'a pas encore accepté ; l'absence d'ADR est donc conforme à la règle 1 en attendant.

## 7. Tests lancés par le relecteur (sortie réelle)

```
$ npm run reset-db -w @cashless/ledger-sql
[migrate] appliquée : 0020_tag_key_job_approval
[migrate] roles.sql rejoué
[migrate] post-roles.sql rejoué
$ pg_prove tests/tests_tag_key_job_approval.sql
tests/tests_tag_key_job_approval.sql .. ok
All tests successful.
Files=1, Tests=52,  0 wallclock secs
Result: PASS

$ npx jest test/integration/media/keys.spec.ts test/integration/media/data-keys.spec.ts \
    test/unit/production-guard.spec.ts test/unit/config.spec.ts test/unit/processes.spec.ts
Test Suites: 5 passed, 5 total
Tests:       104 passed, 104 total

$ npm run lint
> eslint .
(aucune erreur)
```

Contrôle du contrôle (droits rétablis) : `Failed test 2, 3, 5, 6, 7, 8, 9, 10, 11, 12…`. Après
`reset-db` : `Tests=52 … Result: PASS`. La base est remise à zéro à la fin.

## 8. Fichiers à faire relire par une personne (règle 4)

- `packages/ledger-sql/migrations/0020_tag_key_job_approval.sql`
- `packages/ledger-sql/post-roles.sql` (bloc `tag_key_job` et droits `EXECUTE`)
- `apps/api/src/media/keys/job-gate.ts`, `key-admin.worker.ts`, `dek.worker.ts`,
  `reencrypt.worker.ts`
- `apps/api/src/config/config.ts`

L'agent qui a écrit ce code et ce relecteur ne valent pas relecture humaine indépendante.
