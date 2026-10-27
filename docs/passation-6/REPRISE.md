# Reprise de la mission 6 — `recharges-caisses-psp-01M5YEBA`

État au 27/10/2026. Branche `feat/recharges-caisses-psp` (partie de `main` à `2adf0dca`, après les PR #6 et #7 de la
5b) ; coordination `kitty/mission-recharges-caisses-psp-01M5YEBA` ; PR vers `main` prévue (`pr_bound`), branches et
worktrees gardés après la fusion.

## Où en est la mission

| Étape | État | Commits |
|---|---|---|
| Spécification | Faite (discovery réduite à la demande du porteur, « ne m'attends pas ») ; 31 FR, 10 NFR, 10 C | `ab31d7e`, `6729bb4`, `c1bf43a` |
| Décisions du porteur | Adaptateurs PSP réels et coffre AWS **reportés** (mission 6b) ; OP-N81, ADR-131 | `c1bf43a` |
| Plan | Fait : plan, research (R-20 fait foi), data-model, contrats, quickstart | `52bdf27`, `c3519af` |
| Passe contradictoire du plan | 34 constats (4 bloquants) : 31 corrigés, 3 reportés avec raison | `c3519af` |
| Addendum documentaire post-plan | Fait (journal de `06-docs-status.md` écrit) | `202d027`, `cb01670` |
| Tâches (`/spec-kitty.tasks`) | Faites : 14 lots (T001-T074), prompts mis en cohérence (signatures SQL, ports, routes), 13 lanes, matrice d'acceptation créée | `de274f5` |

## Ce qui est consigné

- Décision du porteur du 27/10/2026 (tâches) : comptes `A-PSP-*` créés par une fonction dédiée `open_psp_accounts`
  (`SECURITY DEFINER`, comptes PSP seulement) ; `open_event_ledger` inchangée. ADR à écrire par WP14 ; `0037` à faire
  relire par une personne.
- Arbitrages des tâches : `WALLET_BLOCKED` reste 422 (écart avec `contracts/psp.md` signalé) ; routes de demande
  ajoutées pour `CASH_DEPOSIT`, `WALLET_UNBLOCK`, `LATE_CHARGEBACK` ; `account_purpose_guard` en `SECURITY INVOKER`
  (renforcement).

- OP-N81 (PSP et coffre en faux, bloque les recharges en ligne en production), OP-N82 (remboursement au payeur d'un
  paiement non crédité hors plateforme) ; ADR-131 (report), ADR-132 (contrôle des caisses renforcé), ADR-133 (frais
  par configuration, anomalie `PSP_TOPUP_NOT_CREDITED`, actions `WALLET_UNBLOCK` et `CASH_DEPOSIT`, `A-PSP-*`
  négatif).
- Mission 6b « Adaptateurs PSP réels et coffre des secrets » ajoutée à `PROMPTS-A-ENVOYER.md` et `PRD.md`.
- Reports nommés à d'autres missions : session d'une recharge espèces hors ligne (mission 7, A17) ; rapprochement qui
  exclut les anomalies de paiements non crédités et contrôle « aucune session ouverte » avant `RECONCILING`
  (mission 9, A16, A32) : reportés dans PROMPTS (missions 7 et 9) et PRD le 27/10/2026.

## Prochaines actions

0. (27/10, en cours) Analyse enregistrée (prête). Implémentation lancée : WP01 (lane-a), WP02 (lane-b), WP03 (lane-c) ;
   fiche des agents : `docs/passation-6/fiche-implementation.md` ; bases `cashless_wpXX`, `cashless_test` à
   l'orchestrateur ; `--force` sur le garde kitty-specs autorisé pour cette mission (artefacts du runtime seuls).
   14:50 : WP01 rejeté au cycle 1 (charge `PSP_CONFIGURATION` contre 0037, motif `secret_ref`) → correction
   cycle 2 relancée ; relectures WP02/WP03 abandonnées sans verdict (session effacée) → relancées.
   WP02 **approuvé** (pgTAP 174/174, mutations des gardes détectées). WP01 cycle 2 (`0d87b69e`) en relecture.
   WP06 lancé (lane-f). Points de la relecture de WP02 à reprendre :
   - WP05 doit fermer `EXECUTE` sur `cash_actor_allowed`, `cash_session_usable`, `cash_session_attach_own` et
     les écritures directes sur `cash_desk`/`cash_session` (aujourd'hui ouvertes par `roles.sql`).
   - WP09 : contrôler côté API que l'acteur a un rôle sur l'événement (`…_for_session`, `attach_cash_tx`,
     `refund_cash_due`) et prouver le rattachement des recharges (test 147 de 0036 seulement descriptif).
   - Relecture humaine de 0036 : `posting_cash_desk_guard` laisse passer si la recherche dans `cash_desk` ne
     voit rien ; sûr tant que le propriétaire des fonctions contourne la RLS (superutilisateur), échec
     ouvert sinon. `attach_cash_tx` n'impose pas une transaction postérieure à l'ouverture.
   - `LATE_CHARGEBACK` : déjà en base (0009/0011/0033) ; `data-model.md` l.116 est exact (relecture WP01 c2).
   WP01, WP03 **approuvés**. WP04 : lane-d réparée à la main (fusion de lane-c, conflit de prompt seul),
   implémentation relancée. WP06 (`ee906623`) en relecture. Points :
   - `open_cash_due_anomaly` (0036) ne vérifie que le grand livre du bracelet, pas qu'il est celui du
     portefeuille crédité (conforme au prompt de WP02, plus faible que ce que supposait WP06) :
     renforcement possible, à garantir au moins côté API (WP09 : portefeuille déduit du bracelet).
   - WP07 : `secret_ref` dont le nom commence par un point refusé par le coffre (ajout au prompt).
   - WP05 : `REVOKE EXECUTE` explicite sur les fonctions internes (précision au prompt) ; ses droits
     directs (INSERT d'une configuration ACTIVE, lecture de `secret_ref`) sont bloquants à sa revue.
   WP06 **approuvé** (124 tests moteur, 2 mutations détectées). Reports dans le prompt de WP09 : `source`
   fixée par le serveur, portefeuille déduit du bracelet, rôle de l'acteur, rattachement prouvé.
   WP08 et WP11 : ajouter leurs opérations de terminal à `device-auth-matrix.spec.ts` (à vérifier à leur revue).
   Échecs du Jest complet vus par le relecteur de WP06 (claim-code-order, personalization, platform,
   migrate-rights) : à confirmer sur la batterie de l'orchestrateur.
   - `cashless_test` a reçu des fixtures d'un Jest mal aiguillé (WP06) : `reset-db` avant la batterie.

1. (Fait) addendum post-plan.
2. (Fait) reports A16, A17, A32.
3. (Fait) `/spec-kitty.tasks` ; matrice d'acceptation à tenir au fil des lots matrice d'acceptation tenue au fil des lots (mémoire « Suivre le modèle Spec Kitty »).
4. Créer `docs/Mission-06-Recharges-caisses-PSP.docx` (gabarit de la 5b : `docs/passation-5b/scripts/gen_5b_doc.py`).
5. Implémentation : un implémenteur et un relecteur distincts par lot (sous-agents sur Sonnet ;
   `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` réglé dans `.claude/settings.local.json`), tests en série par l'orchestrateur.

## Fichiers à faire relire par une personne (prévus)

Migrations `0036` à `0038` (garde de caisse, `account_purpose_guard`, droits), `post-roles.sql`, réception et
vérification des notifications (`apps/api/src/webhooks/`), ports PSP et coffre (`apps/api/src/psp/`), contestations
et blocage de portefeuille.

## Rapports

`contexte-m6.md` (sources normatives extraites, 24 questions ouvertes) ; `rapports/plan-adversarial.md`.
Environnement de test : voir `docs/passation-5b/REPRISE.md` (« Environnement de test ») ; `pg_prove` par
`docs/passation-5b/scripts/pg_prove-docker`.
