---
affected_files: []
cycle_number: 3
mission_slug: remboursements-01M7AG5V
reproduction_command:
reviewed_at: '2026-11-16T11:41:26Z'
reviewer_agent: claude
wp_id: WP06
---

# WP06, cycle 3 : borne SC-007 à ajuster (batterie complète du 16/11/2026)

La batterie complète a tourné sur le code intégré (lane-g, tête 71ecc58d, base `cashless_test`). pgTAP : 72 fichiers,
6180 tests, tout passe. tsc passe. Jest : 3635 tests passés, 1 échec :

```
FAIL test/integration/end-to-end/media-port-swap.spec.ts
  ● SC-007 : aucune ligne des contrôleurs de la mission 4 n'a bougé, hormis la borne iOS
```

Cause : ce test compare les contrôleurs de `apps/api/src/media` à la fin de la mission 4 (`89d46518`).
`release.controller.ts` n'y est toléré que pour la mission 6 : 40 lignes ajoutées au plus, 15 retirées au plus, et
chaque ligne ajoutée doit parler de la session de caisse. WP06 l'a modifié comme prévu au plan (`@RequiresOnsiteApproval`
pour `releaseMedia`, construction de l'enchaînement, retrait de `release.no_chaining`). La borne ne connaît pas la 9a.

## Correction attendue (BLOQUANT)

Retouche hors carte autorisée : `apps/api/test/integration/end-to-end/media-port-swap.spec.ts`. Ne touche à aucun
code de production.

- Ajoute une tolérance propre à la mission 9a pour `apps/api/src/media/lifecycle/release.controller.ts`, aussi étroite
  que celle de la mission 6 : nombre maximal de lignes ajoutées et retirées tiré de la diff réelle, et motif des
  lignes substantielles admises (approbation sur place, `settle_balance`, `refund_deposit_by`, enchaînement, lignes
  d'import et de fermeture). Mets un commentaire qui cite la mission 9a, WP06 et la décision 11.
- Ce que SC-007 protège ne doit PAS s'affaiblir. Un changement de décorateur d'authentification (`@DeviceAuth`,
  `@CounterAuth`, `@CustomerAuth`…) sur un contrôleur de la mission 4 doit toujours faire échouer le test, hormis la
  borne iOS déjà admise. Si la tolérance de la mission 6 ou celle de la 9a pouvait laisser passer un tel changement,
  ajoute une assertion explicite qui l'interdit.
- Aucun autre contrôleur de `src/media` ne doit être toléré.
- Preuves à fournir :
  - `media-port-swap.spec.ts` passe sur le code intégré ;
  - une mutation volontaire, NON commitée (par exemple retirer `@CounterAuth()` de `release.controller.ts`), le fait
    échouer : donne la sortie, puis annule la mutation.

Le test lit l'historique git depuis la racine du dépôt : lance-le depuis lane-f, après avoir fusionné la branche de
mission si la diff doit refléter le code intégré. Sinon, explique dans le compte rendu sur quelle tête tu l'as fait
passer.
