---
affected_files: []
cycle_number: 2
mission_slug: routes-backoffice-01M86KT6
reproduction_command:
reviewed_at: '2026-11-25T10:18:09Z'
reviewer_agent: claude
wp_id: WP09
---

# WP09 — reprise après relecture (orchestrateur, 25/11/2026)

La relecture n'a trouvé aucun bloquant, mais la règle de la fiche (« chaque contrôle ajouté a une mutation vérifiée »)
n'est pas tenue sur deux contrôles du lot. Ce sont des manques de ce lot, donc à corriger (pas à consigner).
1. M1 survit : remplacer `platform(req)` par `reader(req, ['OPERATOR_ADMIN'])` au PUT /phone-models laisse les 7 tests
   verts (la base refuse 42501 → 403). Ajouter un test qui prouve le refus PAR L'API (p. ex. le corps/le code du 403
   de l'API diffère de celui traduit de 42501, ou la fonction SQL n'est pas appelée : espion/compteur, ou test unitaire
   du contrôleur). La mutation M1 doit alors faire échouer un test.
2. M2 survit : `throw` dans le `catch` de `declareDeviceModel` laisse les 6 tests verts. Ajouter un cas qui passe
   `parseDeviceModel` puis échoue en base (le relecteur a utilisé `model: 'a\u0000b'` → 201 sans mutation, échec avec M2).
3. Le `catch` avale l'erreur sans trace : ajouter un `warn` (Logger Nest) avec le seul SQLSTATE et le `deviceId`, jamais
   la valeur déclarée. Test ou mutation à l'appui si faisable.
4. Note de lane : écart de signature `nfcLevelFor` (asynchrone, `TxClient`) et commentaire de `withoutTenant` devenu
   inexact (à consigner en WP11).
