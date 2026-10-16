# Correctif post-fusion n° 1 — mission bracelets-nfc-01M4TD3W (16/10/2026)

Source : `mission-review-report.md` (verdict FAIL, constat bloquant SEC-1). Décisions du porteur du 16/10/2026 ci-dessous. Le travail se fait directement sur `feat/bracelets-nfc` (mission déjà fusionnée).

## 1. SEC-1 : file des travaux de clé sans approbation (bloquant ; corriger dans la base ET dans les programmes)

**Constat.** `cashless_app` a le droit `INSERT` sur `tag_key_job`, alors que `post-roles.sql` ne borne que `UPDATE`. Aucun programme qui exécute les travaux (`key-admin.worker.ts`, `dek.worker.ts`) ne vérifie l'`approval_request`, et `disableKey` ne vérifie pas que la clé est `RETIRED`. Démonstration de la revue : depuis `cashless_app`, un INSERT direct d'un travail `DISABLE_KMS_KEY` sur une clé partagée ACTIVE, sans approbation, a été pris par `cashless_keyadmin`. `RETIRE_KEY` et `CREATE_KEY` passent de la même façon.

**Correction attendue.**

1. **Base.** Écrire une nouvelle migration (jamais de `.sql` généré). Deux choix possibles :
   - option a : retirer `INSERT` sur `tag_key_job` à `cashless_app` et faire créer les travaux par une fonction `SECURITY DEFINER` (`search_path = public, pg_temp`, `REVOKE ALL FROM PUBLIC`, `EXECUTE` aux seuls appelants légitimes) ;
   - option b : une politique ou un déclencheur sur l'insertion.

   Dans les deux cas, la base n'accepte un travail que si une `approval_request` existe avec ces propriétés :
   - statut APPROVED, ou EXECUTED selon le cycle de vie réel ;
   - même prestataire ;
   - même action, avec la correspondance `TAG_KEY_CREATE`→`CREATE_KEY`, `TAG_DEK_ROTATE`→`ROTATE_DEK`, `TAG_KEY_RETIRE`→`RETIRE_KEY` (à vérifier dans le code) ;
   - même objet visé et mêmes paramètres figés ;
   - auteur ≠ valideur ;
   - non déjà consommée par un autre travail.

   Pour le travail de désactivation dans le KMS : vérifier dans le code et la spécification comment il est produit. Il n'est accepté que pour une clé `RETIRED`, lorsqu'il suit un retrait approuvé.

   Les travaux internes légitimes, sans approbation, qui existent réellement (par exemple le rechiffrement après une rotation) doivent rester possibles. Ils sont créés par les fonctions qui en ont le droit, sans ouvrir un INSERT libre.
2. **Programmes.** `key-admin.worker.ts` et `dek.worker.ts`, ou tout autre programme qui exécute un `tag_key_job`, revérifient l'approbation concordante avant d'agir. `disableKey` refuse une clé qui n'est pas `RETIRED`. Un travail refusé passe en échec avec un motif et une alerte d'audit ; il n'est jamais exécuté.
3. **Tests pgTAP** depuis `cashless_app` :
   - INSERT direct d'un travail de chaque type sans approbation : refusé ;
   - travail avec une approbation d'une autre action, d'un autre objet ou d'un autre prestataire : refusé ;
   - réutilisation d'une approbation déjà consommée : refusée ;
   - désactivation KMS d'une clé ACTIVE : refusée ;
   - chemin nominal : accepté.
4. **Tests Jest** : un travail planté directement en base, en simulant une base qui l'aurait accepté (par exemple inséré par le propriétaire dans le test), est refusé par le programme d'exécution, qui ne fait aucun appel au KMS. Le chemin nominal reste vert.
5. **Contrôle du contrôle** : rétablir chaque droit ou chaque vérification, constater l'échec des tests, puis le retirer.
6. Chercher les autres files ou tables de travaux de la mission, où un processus exécute ce qu'une autre connexion dépose, et les traiter de la même façon, ou les signaler.
7. Documentation : un ADR (numéro suivant libre), compléter l'ADR-83 si besoin, une ligne dans `docs/POINTS_OUVERTS.md` si une limite reste.

## 2. RISK-3 : `NODE_ENV` obligatoire (renforcement)

La garde des faux ne dépend que de `NODE_ENV === 'production'`. Si `NODE_ENV` manque, les faux et le secret de test restent en service. Correction : tout processus refuse de démarrer si `NODE_ENV` n'est pas explicitement l'une des valeurs admises (`production`, `development`, `test`, à vérifier dans le dépôt). Ajouter un test. Mettre à jour la CI et `tools/dev-db/env.sh` si nécessaire.

## 3. RISK-4 : `TAG_WRAPPING_KEY_REF` exigée en production (renforcement)

En production, une référence de clé d'emballage vide n'est pas refusée au chargement. Correction : refus au chargement de la configuration, avec un test. Faire de même pour toute autre référence de clé ou secret de la mission qui serait encore acceptée vide en production.

## 4. Documentation manquante

- **DRIFT-2** : un ADR pour le changement de contrat de `activateMedia` et `replaceMedia`. La lecture du bracelet passe maintenant dans la requête (`tap`, `new_media_tap`) au lieu d'un `tap_id`. Donner la raison (contradiction avec le schéma) et l'impact sur l'app terminal (mission 12) ; reporter dans `PROMPTS-A-ENVOYER.md` (mission 12).
- **OP-N47** : mission de levée (rotation de `CLAIM_CODE_HMAC_KEY`). Proposer la mission la plus logique, avec la mention « proposé par l'agent, à confirmer par le porteur ». Faire les reports dans `PROMPTS-A-ENVOYER.md` et `PRD.md`.
- **ADR-99** : supprimer la contradiction de statut, entre « confirmée » et « mission à confirmer ». Les missions ont été confirmées par le porteur le 15/10/2026.

## Contraintes

- Ne jamais modifier les `.sql` générés de `packages/ledger-sql/`.
- Tout ce qui affaiblirait la sécurité est signalé, pas codé.
- Écrire des lignes de 100 caractères au plus ; `npm run format:check` doit passer.
- Tests : lint, typecheck, `check:generated`, `npm run check -w @cashless/contracts` si le contrat change, `reset-db` puis pgTAP, `reset-db` puis Jest complet.
