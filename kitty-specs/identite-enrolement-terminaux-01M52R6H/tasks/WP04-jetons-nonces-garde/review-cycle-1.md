---
affected_files: []
cycle_number: 1
mission_slug: identite-enrolement-terminaux-01M52R6H
reproduction_command:
reviewed_at: '2026-10-20T09:43:56Z'
reviewer_agent: claude
wp_id: WP04
---

# Relecture WP04 — cycle 1 : REJETÉ

Relecteur indépendant (claude). Diff relu : `fadb41a..1bc65c4` (lane-d), soit
`packages/ledger-sql/migrations/0023_device_tokens_nonces.sql` et `packages/ledger-sql/tests/tests_device_tokens.sql`.
Aucun fichier généré de `packages/ledger-sql` touché (`check-generated.sh` : à jour). pgTAP non relancé (base partagée) ;
l'orchestrateur l'a constaté vert (125 assertions dans cette suite).

## Constat bloquant

### B1 — Une révocation de famille peut manquer le successeur créé par un échange concurrent (FR-011)

- **Où** : `0023_device_tokens_nonces.sql:131-137` (étape 5, autre certificat), `:169-174` (étape 8, réutilisation),
  `:197-198` (`revoke_device_token_family`).
- **Défaut** : la révocation de famille est un seul `UPDATE … WHERE family_id = … AND revoked_at IS NULL`, sans
  verrou de famille. Deux échanges sur la même famille ne sont pas sérialisés : chacun prend le terminal en
  `FOR SHARE` (les deux sont compatibles), et chacun verrouille seulement **son** jeton. En READ COMMITTED, l'`UPDATE`
  part d'une image prise au début de l'instruction. Il attend bien le jeton vivant `s` verrouillé par l'échange
  concurrent, puis le relit, mais il ne voit pas la ligne `s'` que cet échange vient d'insérer.
- **Scénario d'échec** : un terminal cloné (clé et jeton copiés). L'attaquant fait tourner son jeton en continu
  (`s → s'`, un échange toutes les quelques ms : son échange est presque toujours en cours). Le terminal légitime
  présente son ancien jeton, consommé depuis plus de 60 s. L'étape 8 rend `REUSED` et l'audit `DEVICE_TOKEN_REUSE`
  part, mais `s'` reste vivant. `device_token_family_active` reste vrai, et les jetons d'appareil de la famille restent
  donc acceptés. Le jeton volé garde l'accès, alors que FR-011 et `data-model.md` exigent que « toute autre
  représentation révoque la famille ». Même course pour `revoke_device_token_family` face à un échange en cours.
- **Correction attendue** : sérialiser tous les écrivains d'une famille. Par exemple, un verrou consultatif de
  transaction sur la famille (`pg_advisory_xact_lock(hashtextextended('device-token-family:' || family_id, 0))`),
  pris après la lecture du jeton :
  - dans `rotate_device_refresh_token`, sous forme d'essai (`pg_try_advisory_xact_lock`), dont l'échec rend
    `IN_PROGRESS` : on garde ainsi « 1 gagnant, les autres 409 » ;
  - dans `revoke_device_token_family`, sous forme bloquante.
  
  Les `UPDATE` de révocation qui suivent le verrou voient alors tous les successeurs validés. Une autre solution
  est acceptable si elle prouve la même propriété. Mettre à jour le commentaire d'ordre des verrous (l. 75-76).
  **Preuve** : un test de concurrence sur une vraie base (deux connexions). Un échange de `s` est tenu ouvert pendant
  qu'une réutilisation de l'ancien jeton s'exécute, puis on valide. Résultat attendu : aucun jeton vivant dans la
  famille, et `device_token_family_active` est faux. Une seule session pgTAP ne suffit pas : faire le test en
  intégration (Jest, vraie base) ou demander à l'orchestrateur de le confier à WP15, avec une ligne dans le compte
  rendu. En pgTAP, au minimum : un test qui vérifie la présence du verrou de famille dans les deux fonctions.

## Constats mineurs (à traiter dans ce cycle sauf mention)

- **M1 — Interblocage possible entre `assert_device_active` et les fonctions de référence**
  (`0023:281-298`). `assert_device_active` prend le terminal en `FOR SHARE`. `record_device_seq` (schéma l. 2048),
  `waive_seq_gap` (l. 2095) et `open_offline_batch` (l. 2192) le prennent ensuite en `FOR UPDATE` dans la même
  transaction. Avec deux requêtes simultanées du même terminal, chacune tient le `FOR SHARE`, puis chacune attend
  l'autre pour monter en `FOR UPDATE` : interblocage (`40P01`). Correction attendue : écrire dans le commentaire de
  la fonction l'ordre d'appel imposé, c'est-à-dire après la fonction qui prend `FOR UPDATE` sur le terminal, ou pas
  du tout quand cette fonction contrôle déjà le statut. À transmettre à WP12 et WP15.
- **M2 — Contradiction entre le prompt et le schéma, à consigner dans le compte rendu.** T019 suppose que
  `register_tap` et `post_transaction` refusent déjà un terminal révoqué (`42501`). Ce n'est pas le cas : seul
  `open_offline_batch` le fait (schéma l. 2192), et `register_tap` ne contrôle que le prestataire du terminal. La
  migration cite à juste titre `open_offline_batch`, mais le compte rendu demandé par T019 doit le dire. Conséquence
  pour WP12 et WP15 : `assert_device_active` est **obligatoire** avant `register_tap` et `post_transaction`.
- **M3 — `purge_device_request_nonces` n'a aucun appelant prévu** (`0023:257-274`). T018 dit « appelée par le
  travailleur existant », mais aucun lot (WP07, WP12, WP15…) ne la branche sur `WorkerRegistry`, et le lot n'en a pas
  la propriété. Sans branchement, la table grossit sans limite. Correction attendue : signaler le point à
  l'orchestrateur pour qu'il désigne le lot qui la branche, et le consigner dans le compte rendu. Pas de code dans
  ce lot.
- **M4 — Hypothèse « propriétaire qui ignore la RLS » étendue** (`0023:19-25`). `rotate_device_refresh_token`, quand
  la session n'a pas de prestataire, et `purge_device_request_nonces` reposent sur l'hypothèse acceptée en R3 pour
  WP03. Le prompt de WP07 ne cite que les fonctions de WP03. Correction attendue : l'écrire dans le compte rendu et
  demander à l'orchestrateur d'ajouter ces deux fonctions au test de WP07 (« échoue si le propriétaire perd cette
  capacité »).
- **M5 (facultatif, renforcement)** : `0023:123-137`. Le statut `SUSPENDED` ou `REVOKED` est rendu avant le contrôle
  du certificat. Un jeton présenté avec un certificat étranger pour un terminal suspendu ne révoque donc pas la
  famille, et le jeton reste valable après la réactivation. On peut faire passer l'étape 5 avant l'étape 4. C'est un
  renforcement : à consigner si fait.
- **M6 — Écart de signature à aligner** : `data-model.md` écrit `revoke_device_token_family(device, reason)`, le prompt
  et le code écrivent `(p_device, p_family, p_reason)`. Le code suit le prompt, ce qui est correct. Signaler l'écart
  pour que `data-model.md` soit corrigé.

## Point à soumettre au porteur (pas une faute du lot)

- **NFR-008 contre FR-011/ADR-108** : NFR-008 demande « 20 rafraîchissements simultanés du même jeton : exactement 1
  réussite, la famille reste valide ». Avec la grâce, une requête qui arrive juste après la validation du gagnant (et
  non pendant son verrou) obtient `GRACE`, ce qui fait une deuxième réussite. La suivante obtient `REUSED` et la
  famille est révoquée. Vingt requêtes HTTPS lancées ensemble s'étalent sur des dizaines de ms, alors qu'un échange
  dure quelques ms : le test de WP15 échouera, ou sera instable. Il faut une décision du porteur sur la façon de
  concilier les deux exigences, par exemple en reformulant NFR-008 ou en définissant ce qu'est « simultané ».

## Ce qui est conforme

Grâce de 60 s en constante (l. 84), utilisée une fois (`grace_used_at`), même certificat, successeur jamais utilisé.
Tests aux bornes de 59 s et 61 s, qui échouent si la grâce s'élargit. `NOWAIT` sur le jeton et sur le successeur.
Ordre de verrouillage terminal puis jeton, cohérent avec `set_device_status`. Les cas inconnu, expiré, révoqué ou
d'un autre prestataire rendent `INVALID` sans rien révéler. Seuls des condensats sont stockés (32 octets), jamais un
jeton en clair. Nonce : heure de la base seule, tolérance bornée de 1 à 300 s, rien n'est écrit hors tolérance, rejeu
détecté par la clé primaire (`ON CONFLICT DO NOTHING`), conservation suffisante (created + 2 × tolérance + 300 s) même
si la tolérance est relevée. Purge sans heure fournie, par lots, avec `SKIP LOCKED`. RLS activée et forcée, `WITH
CHECK`, ajout seul. Six fonctions en `SECURITY DEFINER` avec `search_path = public, pg_temp`, `EXECUTE` retiré à
`PUBLIC` (tous deux prouvés), aucun `GRANT` dans la migration. Isolation à deux prestataires prouvée en lecture et en
écriture.
