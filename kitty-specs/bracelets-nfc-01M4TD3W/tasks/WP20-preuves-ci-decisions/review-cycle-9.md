---
affected_files: []
cycle_number: 9
mission_slug: bracelets-nfc-01M4TD3W
reproduction_command:
reviewed_at: '2026-10-15T15:30:25Z'
reviewer_agent: user
wp_id: WP20
---

# WP20 — relecture du cycle 7 (15/10/2026) : changements demandés

Référentiel : `review-feedback-6.md`, section « Décisions du porteur » (option B ; OP-N58 bloque la production).
Commits relus : `72b68c9` (travail) et `a7b1e9c` (nettoyage de la lane, attendu). J'ai lu le code. J'ai rejoué les
scénarios en base depuis la lane, après `reset-db`, dans des transactions annulées. Les journaux sont dans
`scratchpad/wp20c7r/`.

## Ce qui est acquis

- **Option B appliquée.** `0019_personalization_definer.sql` : `register_personalized_media` et
  `associate_claim_code` sont en SECURITY DEFINER, avec `search_path = public, pg_temp`. Les deux fonctions gardent
  tous les contrôles de 0013 et de 0010, et chaque lecture nomme le prestataire de la session. Le lot est désormais
  verrouillé `FOR SHARE`, ce qui renforce la garantie.
- **`variants.sql` rejoué tel quel depuis `cashless_perso`.** V1 à V8 donnent `permission denied for table media`.
  V9, le chemin légitime, passe. V10 donne `UPDATE 0`, car il n'existe plus de bracelet planté.
- **Variantes testées par la fonction** (`fnvar.sql`) :
  - Sans prestataire de session : `Objet introuvable`.
  - Prestataire falsifié (uuid inconnu) : `Objet introuvable`.
  - Prestataire qui n'est pas un uuid : erreur de conversion.
  - Lot `ACTIVE` : `BATCH_NOT_IN_PREPARATION`.
  - Lot de B : `Objet introuvable`.
  - Clé de données de B ou inconnue : `TAG_DATA_KEY_NOT_ACTIVE`.
  - Lot plein : `BATCH_QUANTITY_REACHED`.
  - Session B avec un lot de A : introuvable.
  - Session B avec un lot de B et la clé de données de A : refusé.
  - Association : autre lot, code inconnu, code de B, bracelet qui a déjà un code, code déjà associé, croisement
    de prestataires. Tous sont refusés.
  - Écritures directes de `cashless_perso` et de `cashless_app` : 42501.
- **Tables temporaires.** Avec `SET search_path = pg_temp, public` chez l'appelant, les tables temporaires
  `media_batch`, `tag_data_key`, `media` et `claim_code` sont ignorées.
- **Concurrence, en SQL, avec deux sessions :**
  - Deux enregistrements sur un lot de quantité 1 : un passe, l'autre reçoit `BATCH_QUANTITY_REACHED`.
  - Un passage du lot pendant un enregistrement attend la fin de celui-ci.
  - Un passage à `DELIVERED` non validé, puis un enregistrement : l'enregistrement attend et reçoit
    `BATCH_NOT_IN_PREPARATION`.
- **Aucun élargissement de droits.** J'ai comparé le catalogue d'une base construite depuis `72b68c9^` avec la base
  après `reset-db` (`acl_before.txt` / `acl_after.txt`). Il n'y a que des retraits :
  - Les 13 `INSERT` par colonne de `cashless_perso` sur `media`.
  - `UPDATE (claim_code_hash)` sur `media` (perso, app).
  - `UPDATE (media_id, associated_at)` sur `claim_code` (perso, app).
  - La politique `perso_media_insert`.
  - `EXECUTE` à `PUBLIC` et à `cashless_app` sur l'enregistrement.

  Côté `EXECUTE` : `register_personalized_media` est accordé à `cashless_perso` seul, `associate_claim_code` à
  `cashless_perso` et `cashless_app`. `cashless_platform`, `tagkeys`, `tagcheck`, `keyadmin` et `PUBLIC` n'ont rien.
  Aucun rôle `cashless_*` n'est `SUPERUSER` ou `BYPASSRLS`, ni membre d'un autre rôle.
- **Contrôle du contrôle** sur `tests_personalization_definer.sql` :

  | Mutation                                                       | Résultat                     |
  |----------------------------------------------------------------|------------------------------|
  | `register_personalized_media` avec `search_path = public`      | tests 1, 2, 31 en échec       |
  | filtre prestataire retiré sur le lot                           | tests 9, 13, 28 en échec      |
  | filtre prestataire retiré sur la clé de données                | tests 2, 10, 28 en échec      |
  | `GRANT INSERT ON media TO cashless_perso`                      | tests 3-5, 7, 28, 33 en échec |
  | `GRANT EXECUTE … associate_claim_code TO PUBLIC`               | test 32 en échec              |
  | filtre prestataire retiré sur `claim_code` (association)       | **suite verte** (voir remarque 3) |
  | base propre                                                     | `ok`                         |

- **OP-N58** : bloque la production, Oui, dans la fiche et dans le tableau. Le report est fait dans `PRD.md` et
  `PROMPTS-A-ENVOYER.md`.
- Aucun `.sql` généré n'est modifié. `check:generated` : `suites pgTAP à jour`.

## Constat 1 (bloquant : défaut du correctif lui-même) : le motif d'un refus concurrent est faux dans l'audit

`personalization.service.ts`, méthode `associate()`. Toute erreur `CL020` (ou `23505`) levée par
`associate_claim_code` est rendue comme `CLAIM_CODE_ALREADY_ASSOCIATED`. Le commentaire de la méthode dit pourtant
« le motif est rendu ». Avant ce cycle, `refusal()` lisait le code `FOR UPDATE`. Il attendait donc l'écriture
concurrente et rendait le bon motif. Le `FOR UPDATE` est retiré (à raison : il exigeait un droit `UPDATE`), mais la
lecture sans verrou ne voit pas une invalidation en cours.

**Démonstration** (`scratchpad/wp20c7r/c4a.log`, `c4b.log`) :

1. `cashless_app` invalide le code `c2` dans une transaction ouverte, l'équivalent de `invalidate_unassociated_codes`
   à la clôture.
2. `cashless_perso` lit `c2` sans verrou et voit `invalidated_at` vide : `refusal()` rend `null`.
3. `associate_claim_code` attend, puis lève `CL020: CLAIM_CODE_INVALIDATED`.
4. Le service enregistre `CLAIM_CODE_ASSOCIATION_REFUSED` avec `reason = CLAIM_CODE_ALREADY_ASSOCIATED`.

L'état reste cohérent : rien n'est associé, et la réponse HTTP reste 422. Mais la trace d'audit est fausse, alors
qu'elle était juste au cycle 6. C'est un défaut du correctif, introduit par ce cycle.

**Correction attendue (petite).** Après `ROLLBACK TO SAVEPOINT`, recalculer le motif par `this.refusal(client, hash,
batchId)`. En READ COMMITTED, la nouvelle instruction voit l'écriture validée. Autre option : lire le préfixe du
message, qui commence par le motif. Dans les deux cas, garder `CLAIM_CODE_ALREADY_ASSOCIATED` en dernier recours, et
ajouter un test qui fixe le motif d'un refus levé par la fonction après un contrôle préalable passé.

Même défaut, **antérieur** (WP12), dans `claim-codes.service.ts` (import du fichier de l'imprimeur, même
correspondance `CL020 → CLAIM_CODE_ALREADY_ASSOCIATED`). Il n'est pas bloquant ici. Le corriger dans le même geste
coûte une ligne ; sinon, le consigner.

## Constat 2 (à corriger dans ce cycle, non bloquant seul) : les fiches OP-N59 et OP-N60 sont inexactes ou incomplètes

**OP-N59**

- On compte **77** fonctions SECURITY DEFINER sans `pg_temp` (81 au total, dont 4 corrigées par 0019). La fiche dit
  « une soixantaine ».
- La fiche cite `assert_tenant` parmi les fonctions SECURITY DEFINER. Or `assert_tenant` est en SECURITY INVOKER.
  Ce sont les `tenant_of_ledger`, `tenant_of_media`, `tenant_of_wallet`, `tenant_of_batch`, `tenant_of_event`,
  `tenant_of_device` et `tenant_of_gateway` qui sont SECURITY DEFINER et lisent une table.
- Elles alimentent `assert_tenant` dans les fonctions qui déplacent de l'argent ou changent un bracelet, par exemple
  `post_transaction` (`assert_tenant(tenant_of_ledger(p_ledger))`). La conséquence à écrire pour le porteur est donc
  le **contournement du cloisonnement entre prestataires** dans ces fonctions, pas seulement un historique détourné.
  Je n'ai pas fait de démonstration de bout en bout. À écrire comme risque probable, avec cette réserve.

**OP-N60**

- `cashless_app` a aussi `INSERT` sur toutes les colonnes de `media_batch`. J'ai vérifié : un lot inséré
  directement au statut `ACTIVE` passe (`INSERT 0 1`), sans `ORDERED → PERSONALIZED → DELIVERED`. Le même `INSERT`
  au statut `CLOSED` passe aussi (vérifié).
- La ligne « l'API n'écrit `media_batch` que par `set_media_batch_status` et `close_batch` » est inexacte : la
  création se fait par `INSERT` direct (`batches.service.ts:68`).
- Il manque le test qui fige la limite actuelle (règle 3 de `CLAUDE.md`). Il est exigible dès que l'écart est
  accepté. À écrire au moins comme condition dans la fiche.

## Remarques (non bloquantes)

1. Le message de `72b68c9` annonce un report d'OP-N59 et d'OP-N60 dans `PROMPTS-A-ENVOYER.md` et `PRD.md`. Seul
   OP-N58 y figure. Ce report est acceptable tant que le porteur n'a pas choisi la mission de levée. Mettre une ligne
   « à affecter par le porteur », ou le faire après sa décision.
2. Le prestataire de session (`app.operator_id`) est posé par le processus lui-même. Une session compromise peut donc
   agir au nom d'un autre prestataire. C'est le modèle de confiance existant de la RLS, sans changement dans ce cycle.
3. Retirer le filtre prestataire sur `claim_code` dans `associate_claim_code` n'est détecté par aucun test. Ce n'est
   pas exploitable, car le contrôle du lot refuse quand même (`CLAIM_CODE_OTHER_BATCH`). Mais le message distingue
   alors l'existence d'un code d'un autre prestataire. Ajouter : « code d'un autre prestataire : `CLAIM_CODE_UNKNOWN` ».

## Grille anti-motifs

1. Code mort : PASS (`associate()` appelée par `associateClaimCode`).
2. Faux de test : PASS (vraie base, vrais rôles, contrôle du contrôle refait).
3. Retour vide silencieux : FAIL partiel (constat 1 : un refus concurrent est rendu avec un motif fixe, faux pour
   une invalidation).
4. Couverture FR-035 : PASS.
5. Surface figée : PASS (aucun `.sql` généré modifié).
6. Décision verrouillée : PASS (option B respectée ; `pg_temp` est un renforcement consigné dans ADR-94).
7. Fichiers partagés : `post-roles.sql`, `personalization.service.ts`, `docs/POINTS_OUVERTS.md`, `PRD.md` et
   `PROMPTS-A-ENVOYER.md` sont hors carte, retouches demandées par `review-feedback-6`.
8. Fragilité en production : PASS (les erreurs autres que `CL020` et `23505` sont relancées).

## Tests du relecteur (sortie réelle)

- `reset-db` puis pgTAP : `Files=21, Tests=1376 … Result: PASS`.
- `reset-db` puis Jest complet :
  - premier projet : `Test Suites: 75 passed, 75 total` ; `Tests: 1244 passed, 1244 total` ;
  - second projet : `Test Suites: 1 skipped, 5 passed, 5 of 6 total` ; `Tests: 1 skipped, 38 passed, 39 total` ;
  - code de sortie 0.
- `typecheck` : code de sortie 0. `lint` : code de sortie 0. `check:generated` : `suites pgTAP à jour`.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/migrations/0019_personalization_definer.sql`
- `packages/ledger-sql/post-roles.sql` (EXECUTE et droits de `cashless_perso` et de `cashless_app`)
- `apps/api/src/media/personalization/personalization.service.ts` (`refusal` et `associate`)
- `packages/ledger-sql/migrations/0018_status_history_definer.sql`
