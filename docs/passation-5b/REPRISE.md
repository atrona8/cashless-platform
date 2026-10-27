# Reprise de la mission 5b — `terminaux-paiement-en-ligne-01M52QB9`

État au 27/10/2026 : mission acceptée, mergée sur feat, revue post-fusion faite ; reste la PR. Ce dossier garde ce qui vivait dans le scratchpad de la session (effacé à
chaque nouvelle session) : fiche de contexte des agents, comptes rendus d'implémentation et de relecture, scripts de
test, générateur du document Word.

## Où en est la mission

| Lot | Objet | État | Lane |
|---|---|---|---|
| WP01 | Contrat d'API et types | Approuvé | lane-a |
| WP02 | Vendeurs, sessions, `set_device_status` (0031) | Approuvé (cycle 2) | lane-b |
| WP03 | Catalogue versionné, lignes de vente (0032) | Approuvé (cycle 2) | lane-c |
| WP04 | Paiement, annulation, approbation sur place (0033) | Approuvé (cycle 1, `f46a5d2b`) | lane-d |
| WP05 | Demandes de paiement QR (0034) | Approuvé (cycle 2, `2ec3dee3`) | lane-e |
| WP06 | OP-N74 : enrôlement et état de l'événement (0035) | Approuvé | lane-f |
| WP07 | Droits de la base | Approuvé (cycle 1, `2d665284`, 26/10) | lane-g |
| WP08 | Socle applicatif | Approuvé (cycle 1, `38faf72a`) | lane-h |
| WP09, WP10 | Vendeurs ; catalogue (API) | WP10 approuvé (cycle 1, `d7ae89bd`) ; WP09 **approuvé** (cycle 3, `69dc4908`) (26/10 ; lanes g et h fusionnées à la main dans i et j, conflits kitty-specs résolus sur feat) | lane-i, lane-j |
| WP11 | Paiement par bracelet | Approuvé (cycle 2, `2a6d13b7` ; ADR-128) (26/10 ; lane-k = fusion de i et j, conflit `audit.service.ts` réglé à la main, `node_modules` copié de lane-i) | lane-k |
| WP12, WP13 | Annulation ; paiement QR | Approuvés (cycle 1, 26/10). WP12 : lane-l `d87ec992`, ADR-129. WP13 : lane-m `ee6d78ce`, 2 mineurs de test reportés à WP14 | lane-l, lane-m |
| WP14 | Preuves, CI, consignation | Approuvé (cycle 1, 26/10 ; lane-n `0ddc4b7e` = fusion manuelle de l et m + lot ; ADR-130/OP-N80 acceptés par le porteur). Mineurs pour la revue post-fusion : canari dans `payment-secrets`, note périmée de `media-isolation` et refus admis larges (422) dans `payment-isolation`, test de `written.replayed` (mutant équivalent, garde conservée), lignes > 100 car. | lane-n |

Vérifier l'état réel : `spec-kitty agent tasks status --mission terminaux-paiement-en-ligne-01M52QB9`.

## Point d'arrêt du 27/10/2026

- **Fusion faite** le 26/10 (squash `870bd3f4` sur feat ; `d3d2762e` transitions done ; `a953d4ec` rétrospective ;
  `0d20837a` `contracts/vendors.md` aligné).
- **Rejeu sur feat** : pgTAP 39 fichiers, 2931 tests verts. Jest (comme la CI) : passe `SKIP_LATENCY=1` verte sauf
  `transverse/idempotency.spec.ts` (422 : configuration `PLATFORM` globale + horloge Docker) et `media/claims.spec.ts`
  (collision de sous-chaîne dans une base grossie), toutes deux vertes seules (2 fois) ; `claim-code-order` vert seul ;
  latence en série : `device-latency` vert, mais les mesures NFR-009 de `devices/config.spec.ts` et
  `devices/heartbeat.spec.ts` dépassent le délai Jest de 5 s (200 appels à ~45 ms sous Docker macOS). Le test de
  heartbeat est identique dans main, dont la CI est verte ; `config.spec` sert désormais le catalogue (WP10) :
  **à surveiller dans la CI de la PR** (correctif possible : délai explicite sur ces deux tests).
- **Revue post-fusion** (agent distinct) : `rapports/mission-review-5b.md`, publiable avec réserves, aucun bloquant,
  aucun écart de sécurité non consigné. Constats documentaires traités : OP-N69 (réduit à quatre colonnes par WP07),
  ADR-121 (essai compté avant vérification : 4 faux puis le bon bloquent), spec.md FR-004 et FR-017 (ADR-122).
  Restent (mission 7 ou en passant) : canari de `payment-secrets`, note de `media-isolation` et refus admis larges de
  `payment-isolation`, commentaire du test de `written.replayed` ; OP-N80 sans test de borne (accepté) ;
  `acceptance-matrix.json` garde `overall_verdict: pending` et des notes périmées (artefact du runtime, non touché).
- **Prettier** : `format:check` propre ; les lignes > 100 restantes sont des commentaires/chaînes (décision du 16/10).
- **Docs** : `spec-kitty-docs-maintain` passé (statut « mergée » dans 01, 02, 04, 05, 06, 07, spec-index,
  docs-state) ; `Mission-05b-Encaissement-en-ligne.docx` régénéré (état final).
- **Reste à faire** :
  - retirer `.worktrees/tmp-combo-5a` et `.worktrees/tmp-combo-5b-wp08` (refusé à l'agent par le contrôle de
    permissions : à faire par le porteur, `git worktree remove --force …`) ;
  - ~~pousser feat et ouvrir la PR~~ : fait le 27/10 avec l'accord du porteur, **PR #6**. CI verte (runs
    40484677544 et 40484741738) : Jest 2188 réussis / 7 ignorés ; latence en série verte (configuration p95 18,6 ms,
    battement 17,4 ms, paiement par bracelet p95 28,7 ms / p99 32,3 ms). **NFR-010 confirmé par la CI.** Marge
    faible : `devices/config.spec.ts` dure 5,2 s pour un délai Jest de 5 s par test, à surveiller. Fusion dans main
    à la décision du porteur ;
  - relecture humaine des fichiers listés en fin de ce document et dans le rapport de revue.

## Point d'arrêt du 26/10/2026 (fin de session, à la demande du porteur)

- Les 14 lots sont approuvés. L'addendum documentaire post-relecture est fait (`5f624ce2`, réponses confirmées par le
  porteur `68d2c003`). La matrice d'acceptation est remplie (`b429661a` sur feat, recopiée sur la branche de
  coordination `0caa8351`, car `accept` lit cette branche). Décisions du porteur : FR-021 à FR-023 retirés de la
  matrice (reportés à la mission 10) ; NFR-010 en pass sur preuve locale, à confirmer par la CI de la PR avant main.
- **Mission acceptée** : `4922ef83` (puis `7bca781d`, `a9d004fb`).
- **Fusion NON faite** : `spec-kitty merge --mission terminaux-paiement-en-ligne-01M52QB9 --keep-branch
  --keep-worktree` s'arrête sur « Lane lane-j must incorporate mission changes before merging. Run: cd
  .worktrees/*-lane-j && git merge kitty/mission-terminaux-paiement-en-ligne-01M52QB9 ». feat est resté propre.
  Reprendre : faire ce merge dans lane-j (puis les lanes suivantes si le même message revient), relancer le merge,
  puis rejouer pgTAP + Jest sur feat, et enfin :
  - mettre à jour `docs/Mission-05b-Encaissement-en-ligne.docx` (générateur `scripts/gen_5b_doc.py`, état final) ;
  - lancer `spec-kitty-docs-maintain` (statut « mergée » dans 01, 06, spec-index, docs-state) ;
  - faire la revue post-fusion (`spec-kitty-mission-review`), qui doit lister les écarts de sécurité ouverts et les
    mineurs de WP14 (ligne WP14 ci-dessus) ;
  - lancer Prettier sur les lignes de plus de 100 caractères ;
  - aligner `contracts/vendors.md` (422, 409 au renvoi, liste sans vendeurs bloqués) ;
  - retirer les worktrees temporaires `tmp-combo-5b-wp08` et `tmp-combo-5a` ;
  - pousser et ouvrir la PR (CI = preuve de NFR-010), avec l'accord du porteur.

## Prochaines actions, dans l'ordre

1. **WP05** : approuvé au cycle 2 (le 23/10).
2. **WP07** (droits de la base), en cours : si `rapports/WP07-implementation.md` manque, regarder `git log`/`status` de lane-g ; puis rejeu en série, relecture distincte. Le runtime signalait « 1 pre-existing test failure » à la ligne de base. Son prompt contient les reports de la relecture WP04
   (`REVOKE INSERT, UPDATE ON sale_attribution`, tests manquants).
3. **WP09 et WP10** en parallèle après WP07 ; puis WP11 ; puis WP12 et WP13 ; WP14 ferme la mission.
4. Après la dernière relecture : `spec-kitty-docs-maintain` (addendum post-relecture), avant `accept`/`merge`
   (règle de CLAUDE.md). Mettre à jour `docs/Mission-05b-Encaissement-en-ligne.docx` (générateur :
   `scripts/gen_5b_doc.py <docx 5a> <sortie>`, puis `updateFields` dans `word/settings.xml` avant `footnotePr`).

## Procédure établie (à suivre)

- Un implémenteur puis un relecteur **distincts** par lot, chacun avec `fiche-mission-5b.md` (remplacer `<SCRATCHPAD>`
  par le scratchpad de la nouvelle session et y recopier `rapports/`). Les agents testent sur leur propre base
  (`cashless_wpXX`) ; `cashless_test` reste à l'orchestrateur, qui rejoue les tests en série.
- **Garde kitty-specs** au `move-task` : les lanes prennent du retard sur les corrections de planification de feat.
  Lister `git diff --name-status feat/terminaux-paiement-en-ligne -- kitty-specs/` dans la lane ; vérifier qu'aucun
  commit de la lane n'a modifié ces fichiers (`git log feat..HEAD -- <fichiers>`) ; `git checkout feat -- <fichiers>`
  (hors `status.*`, `review-cycle-*.md`, `baseline-tests.json`), commit `chore: align planning artifacts…` ; puis
  `move-task … --force` avec une note (autorisation du porteur, mémoire « --force sur le garde kitty-specs »). Les
  relecteurs ne peuvent pas forcer : l'orchestrateur enregistre leur verdict en leur nom.
- Après chaque approbation : commit sur feat des `review-cycle-*.md` et de l'en-tête posés par le runtime ; preuves
  dans `acceptance-matrix.json` ; reports des constats dans les prompts des lots suivants (« Reports de
  l'orchestrateur ») ; ADR/point ouvert/PROMPTS/PRD pour toute décision du porteur.
- **Combinaison de lanes pour Jest** : un test peut exiger une migration d'une autre lane (CL031 de WP08 exige 0035 de
  WP06). Worktree temporaire détaché, fusion des lanes, copie du `node_modules` d'une lane qui a `argon2`
  (`cp -cR`), puis `jest-lane.sh`. Worktree laissé : `.worktrees/tmp-combo-5b-wp08` (à retirer).

## Environnement de test (poste macOS)

- `colima start` puis `docker start cashless-platform-pg17` si la base ne répond pas (`pg_isready -h 127.0.0.1 -p 5433`).
- `pg_prove` : à refaire à chaque session (CPAN `TAP-Parser-SourceHandler-pgTAP-3.37`, petit script `bin/pg_prove`
  qui fait `exec perl -I<dossier>/lib <dossier>/bin/pg_prove "$@"`), voir `scripts/env.sh`.
  Variante sans téléchargement (26/10) : copier `scripts/pg_prove-docker` en `<SCRATCHPAD>/bin/pg_prove` ; il copie
  le dossier courant dans le conteneur et y lance son `pg_prove`.
- Résultats de référence au 23/10 : pgTAP 36 fichiers / 2521 tests (lane-d) ; Jest 107 suites, 1833 réussis,
  6 ignorés (WP08 + WP06).

## Décisions du porteur (26/10/2026)

- Relecture WP09 cycle 2 : cycle 3, secret distinct `VENDOR_PIN_IDEMPOTENCY_SECRET`, verrou avant le dérivé (ADR-126).
- Relecture WP07 : purge de `vendor_pin_check` → OP-N78 (mission 13) ; `vendor_id` dans la clé de session → OP-N79
  (reporté, mission 11 proposée) ; ADR-127.
- Tous les sous-agents sur sonnet.

## Décisions du porteur prises pendant cette session (23/10/2026)

- `@epic-web/invariant@1.0.0` acceptée (R-01 de `research.md`, commit `20bddde4`).
- ADR-124 : refus `DEBIT_AUTHORITY_*` → clé relâchée sur toutes les routes ; SPECIFICATION §10.2 mise à jour.
- ADR-125 / OP-N77 : secrets exigés par tous les processus, lecture par processus à la mission 13.

## Fichiers à faire relire par une personne

`packages/ledger-sql/migrations/0031_vendors.sql`, `0033_payments.sql` (`assert_reversible`, clé de
`sale_attribution`), `apps/api/src/vendor-pin/`, `apps/api/src/config/config.ts`,
`apps/api/src/device-identity/device-or-caller.guard.ts`, `apps/api/src/idempotency/idempotency.interceptor.ts`.
