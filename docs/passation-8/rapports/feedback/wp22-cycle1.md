# Relecture WP22 (commit 9706e17d), cycle 1 : a corriger

1. [MAJEUR] Mutations de `staff-token.guard.ts` qui survivent (aucun test n'échoue) :
   - condition 3 (`session.device_id !== ctx.device.deviceId` remplacé par `false`) ;
   - condition 4, parties `status !== 'OPEN'` et `closed_at !== null` retirées séparément ;
   - `ALGORITHMS` élargi à `HS256` ;
   - garde de route `TOLERANCE_ROUTES.has(ctx.route)` retirée (défense en profondeur, à tester par un
     appel direct de `StaffAuthorizer.authorize` avec une route hors liste).
   Le test `tolerance-bounds.spec.ts:145` « autre terminal » passe sans la condition 3 : il ne prouve pas
   ce qu'il dit (le 401 vient d'ailleurs). Correction : un test par condition qui échoue SEULE, appelant
   `authorize` (ou le garde) avec session du bon prêteur, bon `sub`, bonne session, terminal différent ;
   idem `status`/`closed_at` avec `usable_on_edge` vrai ; un jeton signé HS256 avec la clé publique
   comme secret, dont `kid` est connu, refusé par l'allowlist. Les 15 autres mutations sont tuées.
2. [MAJEUR, à signaler au porteur] Décision 21 « réglable, même réglage que la base » : le plafond lit
   `wallet_limits.max_cash_topup` de l'état répliqué, clé qui n'existe dans aucun contrat de
   réplication ni dans la base (`edge_setting_value`, WP09/0064). Seul le test l'écrit. En pratique le
   plafond est toujours 500 000 : non réglable, et un réglage central ne se propage pas. Défaut
   fermé plus strict, pas un affaiblissement, mais c'est un écart à la décision. Correction : le
   signaler dans le compte rendu avec options (ajout facultatif au flux `/edge/*`, soumis au porteur)
   et consigner la dette (POINTS_OUVERTS, report PROMPTS-A-ENVOYER/PRD) ; corriger le commentaire qui
   cite `replay_max_per_cash_topup` comme s'il était répliqué.
3. [MINEUR] `cash-topup.spec.ts:107` : test nommé « sans session OPEN : 409 » mais attend 401 avec
   `staff: null` ; il teste l'absence de jeton. Renommer, et ajouter le vrai cas (jeton valide,
   terminal sans session : 409 `NO_REPLICATED_CASH_SESSION`, rien d'écrit).
4. [INFO] Un rejeu idempotent d'une requête au jeton toléré n'écrit pas de seconde ligne d'audit
   (l'effet n'existe qu'une fois, l'audit initial reste) : acceptable, à consigner.
