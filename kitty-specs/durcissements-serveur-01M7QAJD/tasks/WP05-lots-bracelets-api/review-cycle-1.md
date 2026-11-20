---
affected_files: []
cycle_number: 1
mission_slug: durcissements-serveur-01M7QAJD
reproduction_command:
reviewed_at: '2026-11-19T09:43:09Z'
reviewer_agent: claude
wp_id: WP05
---

# Retours de relecture WP05 (cycle 1)

Contexte : Docker (colima) etait arrete pendant la relecture ; aucune preuve sur base n'a pu etre relancee
(batches.spec, blacklist.spec, mutations NFR-004, seed-demo). Constats issus de la lecture du diff d85a74eb,
de `tsc`, du test unitaire sqlstate-map (148 verts) et de `check.mjs` (0 refus).

**Constat 1 (bloquant)** : `npx tsc -p tsconfig.json --noEmit` (validation de T018) echoue, 2 erreurs TS2339
introduites par le lot : `test/integration/media/batches.spec.ts:364` (`const [{ quantity }] = ...`) et
`test/integration/media/blacklist.spec.ts:471` (`const [{ batch_id: batchId }] = ...`) ; le premier element de
tableau est `possibly undefined` (noUncheckedIndexedAccess). Correction : `const row = (await rows(...))[0]!`
puis lecture du champ.

**Constat 2 (mineur)** : lignes de plus de 100 caracteres ajoutees (regle du projet, Prettier) :
`batches.service.ts` l. 50 (`client.query("SELECT pg_advisory_xact_lock(...`), commentaire de `sqlstate-map.ts`
(CL056), noms de tests de `batches.spec.ts` et `blacklist.spec.ts`. Lancer Prettier sur ces fichiers.

**Constat 3 (mineur)** : le test des deux PATCH concurrents n'affirme que 200/200 et une valeur parmi deux ; il
ne prouve pas la serialisation par le verrou consultatif. Pas de mutation consignee (retirer le verrou) : en
ajouter une ou documenter la limite.

**Constat 4 (a consigner)** : la ligne d'historique `->ORDERED` change de `reason` (NULL -> 'Creation du lot')
en plus de l'auteur ; le prompt ne parle que de l'auteur. A signaler dans la note de lane (renforcement d'audit).

A refaire par le lot apres correction : jest batches + blacklist sur cashless_wp05, les deux mutations NFR-004
(`GRANT UPDATE (status) ON media`, `GRANT INSERT ON media_batch`), seed-demo.
