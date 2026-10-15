# WP20 — relecture du cycle 6 (15/10/2026) : changements demandés

Référentiel : `review-feedback-5.md` et sa section « Décision de l'orchestrateur ». Commits relus : `b1b87f9` (travail)
et `9ddf691` (nettoyage de la lane). Le code a été lu, les scénarios ont été rejoués en base par le relecteur
(`scratchpad/wp20c6r/variants.sql`, transaction annulée) après `reset-db` depuis la lane.

## Ce qui est acquis

- **Scénario `perso.sql` de la relecture 5 fermé.** Rejoué tel quel depuis `cashless_perso` :
  `ERROR: permission denied for table media` (le `GRANT INSERT` par colonne exclut `wallet_id`).
- **Variantes « statut / portefeuille / colonnes par défaut » fermées** (rejouées par le relecteur) :
  - `kind = 'QR'` avec les colonnes de `register_personalized_media` : refusé par `perso_media_insert` ;
  - `BLACKLISTED` : refusé par `check_media_transition` (et par la politique) ;
  - `operator_id` d'un autre prestataire : refusé par `tenant_isolation` ;
  - les colonnes influentes laissées à leur défaut (`deposit_*`, `claim_*`, `last_counter`, `chip_type`, `format_*`,
    `flags`) ne sont ni accordées ni modifiables, et la politique les redit ;
  - `UPDATE` ultérieur : `cashless_perso` n'a que `UPDATE (claim_code_hash)`, qui ne déclenche pas
    `media_status_log` (`UPDATE OF status`) ; `INSERT … ON CONFLICT DO UPDATE SET claim_code_hash` ne fait rien de plus
    que ce droit.
- **Combinaison des politiques.** `perso_media_insert` est `RESTRICTIVE`, `FOR INSERT TO cashless_perso` ;
  `tenant_isolation` reste `PERMISSIVE` `TO public` (vérifié dans `pg_policies`). La politique restrictive ne devient
  pas la seule applicable : l'`operator_id` d'un autre prestataire est refusé par `tenant_isolation`.
- **Chemin légitime intact** : `register_personalized_media` passe, avec son historique, sans rattachement (pgTAP).
- **Relevé des rôles exact.** Contrôlé dans `pg_class.relacl` et `pg_attribute.attacl` après `reset-db` : aucun droit
  de table sur `media` hors propriétaire ; droits par colonne conformes au complément d'ADR-94 ; `media_batch` :
  `cashless_app=arw`, `cashless_perso=r`. Aucun rôle `cashless_*` n'est `SUPERUSER` ni `BYPASSRLS`, aucun n'est
  membre d'un autre.
- **Contrôle du contrôle refait** sur `tests_definer_trigger_writers.sql` :

  | Changement appliqué                                      | Résultat                               |
  |----------------------------------------------------------|----------------------------------------|
  | `DROP POLICY perso_media_insert`                         | tests 5, 6, 9, 14, 15 en échec          |
  | `GRANT INSERT ON media` + politique retirée              | tests 1-7, 9-10, 14-16, 18 en échec      |
  | Base propre                                              | `ok`                                    |

- **OP-N57, OP-N58** : fiches complètes (risque, mesures en place, mission 7, condition de levée, test qui borne),
  lignes du tableau, report dans `PROMPTS-A-ENVOYER.md` (mission 7) et `PRD.md`, renvoi depuis ADR-94. Droits figés
  par les tests 19 à 22.
- **OP-N56** : la phrase sur l'attribution de l'historique est ajoutée.
- Aucun `.sql` généré modifié (`b1b87f9` ne touche que `post-roles.sql` et un nouveau test) ; `check:generated` à jour.

## Constat 1 (important, sécurité ; préexistant au cycle 6, non consigné) : l'insertion directe de `cashless_perso` contourne tous les contrôles de `register_personalized_media`

La politique et le commentaire de `post-roles.sql` disent : « La personnalisation n'insère que des bracelets neufs, en
stock […] ». C'est vrai pour le statut et les valeurs initiales, mais pas pour **le lot ni la clé de données** :
`register_personalized_media` vérifie le lot (même prestataire, statut `ORDERED`/`PERSONALIZED`, quantité non
atteinte, verrou consultatif), la clé du lot `ACTIVE` et la clé de données (même prestataire, même index, `ACTIVE`).
L'`INSERT` direct, toujours accordé à `cashless_perso`, ne vérifie rien de tout cela.

**Démonstration** (`scratchpad/wp20c6r/variants.sql`, transaction annulée, depuis `cashless_perso`, `app.operator_id`
= A, avec exactement les treize colonnes accordées) :

| Variante                                                        | `register_personalized_media` | `INSERT` direct |
|-----------------------------------------------------------------|-------------------------------|-----------------|
| V1 : lot de A au statut `ACTIVE`                                | `BATCH_NOT_IN_PREPARATION`    | `INSERT 0 1`    |
| V2 : lot du prestataire B (`batch_id` d'un autre prestataire)   | `Objet introuvable`           | `INSERT 0 1`    |
| V3 : `pwd_pack_dek_id` = clé de données du prestataire B        | `TAG_DATA_KEY_NOT_ACTIVE`     | `INSERT 0 1`    |
| V4 : lot de quantité 1 déjà plein                               | `BATCH_QUANTITY_REACHED`      | `INSERT 0 1`    |

Pour V2, `check_media_batch_key` ne voit pas le lot de B (RLS), compare `key_index` à NULL et laisse passer ; la clé
étrangère ignore la RLS. Suite de V1 : `cashless_app` passe ensuite ce bracelet planté `PERSONALIZED → ISSUED` dans le
lot actif (V10, `UPDATE 1`). Un processus de personnalisation compromis peut donc ajouter, au-delà de la quantité
commandée et après la livraison, des bracelets d'identité choisie dans un lot en circulation, ou mêler les lots et
les clés de données de deux prestataires.

Ce n'est **pas** un élargissement dû à 0018 ni au cycle 6 : ces insertions passaient déjà avant (droit `INSERT` sur toute
la table). Mais c'est une faiblesse du code de la mission 4 (`post-roles.sql`, droit posé pour `0013`), consignée
nulle part (ni OP-N, ni ADR), et le complément d'ADR-94 comme le commentaire de la politique affirment une borne plus
forte que la réalité. Règle 4 de `CLAUDE.md` : un écart de sécurité non consigné est bloquant.

**Correction attendue** (renforcement, à faire puis consigner), au choix de l'orchestrateur :

- **A (recommandée, petite)** : compléter `perso_media_insert` par
  `EXISTS (SELECT 1 FROM media_batch b WHERE b.id = batch_id AND b.operator_id = media.operator_id AND b.status IN
  ('ORDERED','PERSONALIZED') AND b.key_index = media.key_index)` et
  `EXISTS (SELECT 1 FROM tag_data_key d WHERE d.id = pwd_pack_dek_id AND d.operator_id = media.operator_id AND
  d.key_index = media.key_index AND d.status = 'ACTIVE')` (vérifier que `cashless_perso` lit les colonnes nécessaires
  de `tag_data_key`). La quantité, elle, reste contournable (une politique ne prend pas le verrou consultatif) :
  la consigner (OP-N59) ou passer à B.
- **B** : `register_personalized_media` en `SECURITY DEFINER SET search_path = public`, `EXECUTE` à `cashless_perso`
  seul, et retrait de tout `INSERT` sur `media` à ce rôle. Ferme tout, mais change le modèle de 0013 (à soumettre au
  porteur si retenu, la fonction s'exécutant alors hors RLS avec un propriétaire superutilisateur en local).
- **C** : ne rien changer et ouvrir OP-N59 (risque, garde en place, mission de levée, condition, test qui fige), avec
  report dans `PROMPTS-A-ENVOYER.md` et `PRD.md` — décision du porteur requise (règle 1, c'est une limite gardée).

Dans tous les cas : tests pgTAP joués depuis `cashless_perso` pour V1 à V4 (refus ou limite figée), contrôle du
contrôle, et correction de la phrase du complément d'ADR-94 / du commentaire de `post-roles.sql`.

## Remarque 1 (non bloquante) : classement d'OP-N58

OP-N57 est classé « bloque la production : Oui » ; c'est justifié (déni de service du paiement hors ligne par une
session de l'API compromise, levée prévue avant la production avec la mission 7). Mais la fiche d'OP-N58 décrit aussi un
déni de service (« une version plantée en avance […] fait échouer la modification légitime suivante de cette
politique ») et reste « Non ». Soit aligner OP-N58 sur « Oui », soit dire pourquoi ce blocage-là est acceptable en
production.

## Grille anti-motifs

1. Code mort : sans objet (SQL de droits et tests).
2. Faux de test : PASS (vraie base, vrais rôles, contrôle du contrôle refait).
3. Retour vide silencieux : sans objet.
4. Couverture FR-035 : PASS pour le constat 1 du cycle 5 ; FAIL partiel pour la garantie d'ensemble « la
   personnalisation n'insère que des bracelets neufs de son lot en préparation » (constat 1).
5. Surface figée : PASS (aucun `.sql` généré modifié).
6. Décision verrouillée : FAIL (règle 4 de `CLAUDE.md` : faiblesse de sécurité non consignée, constat 1).
7. Fichiers partagés : `post-roles.sql`, `docs/POINTS_OUVERTS.md`, `PROMPTS-A-ENVOYER.md`, `PRD.md` hors carte,
   retouches demandées par `review-feedback-5`.
8. Fragilité en production : PASS.

## Tests du relecteur (sortie réelle)

- `reset-db` puis pgTAP : `Files=20, Tests=1340 … Result: PASS`.
- `reset-db` puis Jest complet : `Test Suites: 75 passed, 75 total` ; `Tests: 1244 passed, 1244 total` ; second
  projet : `Test Suites: 1 skipped, 5 passed, 5 of 6 total` ; `Tests: 1 skipped, 38 passed, 39 total` ; code de sortie 0.
- `typecheck` : code de sortie 0. `lint` : code de sortie 0. `check:generated` : `suites pgTAP à jour`.

## Fichiers à faire relire par une personne

- `packages/ledger-sql/post-roles.sql` (droits de `cashless_perso` sur `media`, politique `perso_media_insert`)
- `packages/ledger-sql/migrations/0013_media_api.sql` (`register_personalized_media`)
- `packages/ledger-sql/migrations/0018_status_history_definer.sql`
- `packages/ledger-sql/migrations/0017_media_reinstate_approval.sql`
- `packages/ledger-sql/src/migrate.ts`

## Décisions du porteur (15/10/2026)

- **Constat 1 : option B.**
  - Nouvelle migration (numéro suivant libre) : `register_personalized_media` passe en `SECURITY DEFINER SET search_path = public`, avec `REVOKE ALL ... FROM PUBLIC`. `GRANT EXECUTE` est donné aux seuls rôles qui l'appellent légitimement.
  - La fonction doit garder tous ses contrôles. Elle doit aussi faire elle-même les vérifications que la RLS faisait pour l'appelant : le lot et la clé de données appartiennent au prestataire de la session (`app.operator_id`), le statut du lot est compatible, la clé de données est `ACTIVE` avec le même index, et la quantité du lot n'est pas dépassée. Avec un propriétaire superutilisateur, la RLS ne s'applique plus dans la fonction. Elle ne doit donc dépendre de la RLS pour aucun contrôle.
  - Dans `post-roles.sql`, `cashless_perso` perd tout `INSERT` sur `media`. La politique `perso_media_insert` et les droits par colonne deviennent inutiles : retire-les, sauf s'ils servent encore à autre chose.
  - Recherche les autres fonctions qui contrôlent ce qu'un rôle de processus pourrait aussi faire par un accès direct à la table. Applique-leur le même traitement, ou signale-les.
  - Tests pgTAP : les quatre variantes de `scratchpad/wp20c6r/variants.sql` sont refusées, aussi bien par un accès direct (42501) que par la fonction (lot d'un autre prestataire, lot plein, clé de données d'un autre prestataire, lot `ACTIVE`). Le chemin légitime passe. Fais le contrôle du contrôle.
  - Corrige le complément de l'ADR-94 et le commentaire de `post-roles.sql`, qui annonçaient une borne plus forte que la réalité.
- **Remarque 1** : OP-N58 est classé « bloque la production : Oui », comme OP-N57. Mets à jour la fiche et le tableau.
