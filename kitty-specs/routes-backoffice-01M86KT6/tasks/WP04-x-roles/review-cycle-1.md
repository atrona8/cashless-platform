---
affected_files: []
cycle_number: 1
mission_slug: routes-backoffice-01M86KT6
reproduction_command:
reviewed_at: '2026-11-25T10:07:53Z'
reviewer_agent: claude
wp_id: WP04
---

# WP04 — retour de relecture (cycle 1) et décisions du porteur du 25/11/2026

Relecture : aucun bloquant sur la table ni la garde (28 lignes de roles.json vérifiées contre le code, 5 mutations rejouées).
À faire au cycle 2 (décisions du porteur, voir la fiche commune « Décisions du porteur (25/11/2026) ») :
1. Retouche hors carte de `apps/api/test/unit/contracts/contract-additions-9b.spec.ts` au plus juste : ignorer les
   pointeurs `/x-roles` dans `violations()` ; la ligne qui attend `x-roles` indéfini sur les 11 opérations de la mission
   devient une vérification de présence. Mutation : un autre champ modifié dans une opération existante doit toujours
   faire échouer le test. Le test doit être vert.
2. Ajouter `node --test tools/contract-stability/x-roles/x-roles.test.mjs` à `check:stability` (package.json) et à
   `.github/workflows/ledger-tests.yml` à côté de `check.test.mjs` (renforcement : check.mjs ne détecte pas la perte
   d'un x-roles).
3. Les 8 opérations sans route restent sans x-roles dans DOUBTS_ACCEPTED (décision du porteur) : rien à changer.
4. Note de lane : corriger le décompte d'empreintes (32 remplacées : 28 chemins, 3 schémas, 2 opérations) et lister les
   nouvelles retouches hors carte.
