---
affected_files: []
cycle_number: 2
mission_slug: versements-rapprochements-cloture-01M7JT4G
reproduction_command:
reviewed_at: '2026-11-17T07:36:01Z'
reviewer_agent: claude
wp_id: WP03
---

# WP03 : retour de l'orchestrateur (renforcements choisis par le porteur le 17/11/2026, décision 6)

Relecture approuvée ; deux renforcements demandés par le porteur, à coder dans `0085_payouts.sql` avec tests.

1. **`create_payout_batch` exige une approbation acceptée** : refuser (`CL029` ou code existant adapté, à
   justifier) une demande d'approbation dont le statut n'est pas celui d'une demande acceptée au moment de
   l'exécution (lis `apps/api/src/approval/` et la table des demandes : quel statut porte la demande quand
   l'action `PAYOUT` s'exécute ? `APPROVED`, `EXECUTING`… ; ne bloque pas le chemin réel), ou dont l'action
   n'est pas `PAYOUT`, ou d'un autre prestataire (déjà fait). Le valideur passé doit être celui de la demande
   (`approved_by` / décideur enregistré) et l'auteur son demandeur : sinon refus.
2. **Ligne `payout` liée à sa transaction** : `initiated_tx_id` NOT NULL exigé à l'insertion (garde ou CHECK
   `NOT VALID` pour l'existant), `settled_tx_id` NOT NULL exigé quand le statut passe à `CONFIRMED` ou
   `FAILED` ; la transaction doit appartenir au même grand livre.
3. Tests : une assertion par refus (demande PENDING, REJECTED, action autre, valideur différent de la
   demande, insertion sans transaction, règlement sans transaction, transaction d'un autre grand livre) ; les
   107 tests existants restent verts ; suites générées vertes.
