---
affected_files: []
cycle_number: 2
mission_slug: hors-ligne-snapshots-lots-01M645RN
reproduction_command:
reviewed_at: '2026-11-02T11:26:43Z'
reviewer_agent: claude
wp_id: WP11
---

# Relecture WP11 cycle 2 (b443defe) : REJET, 2 constats bloquants, 3 mineurs

Le scénario du cycle 1 est corrigé (mutant « réservation jamais levée » tué : 2 tests échouent). Droits OK.

## Bloquants
1. (haute, disponibilité/cohérence) Jet mutuel entre instances, délai de 60 s incohérent avec WP13.
   `process()` jette via `discardOrphans` TOUT brouillon OPEN/READY du grand livre dès que sa propre réservation a
   plus de 60 s, y compris celui qu'une autre instance vient d'écrire ; le balayage de démarrage fait de même.
   Reproduit (test temporaire, retiré) : instance A, instance B démarrée 10 s après, signataire muet, passages à
   30 s pendant 10 min : 15 brouillons écrits, 14 DISCARDED, alarme 2 permanente (écriture complète à chaque tour).
   Un signataire lent mais sain (> 60 s) voit ses brouillons jetés alors que WP13 n'alarme qu'à 5 min. Aucun
   singleton de processus (aucun verrou). Correction attendue : n'acquérir le jet que sur un brouillon plus vieux que
   le délai (âge lu en base : `created_at` via une fonction accordée, ou délai porté à > 5 min, cohérent avec WP13),
   ou verrou consultatif de processus par grand livre ; test à deux instances, signataire muet : au plus un jet par
   délai et par brouillon, jamais le brouillon d'un tiers de moins de N min. Le balayage de démarrage jette un READY
   que l'instance précédente vient de sceller : le signataire échoue proprement (DRAFT_NOT_READY), mais c'est le
   même défaut en cas de démarrages rapprochés. Documenter le choix (ADR/POINTS_OUVERTS).
2. (majeure, tests) Mutants survivants sur ce que le cycle devait prouver :
   - « backoff absent » (retrait de `mem.blockedUntil = …wait`) : 48/48 verts ; idem plafond de 5 min (60 min) et
     exponentiel (`BACKOFF_BASE_MS` constant) ; aucun test de temporisation, ni d'indépendance entre grands livres,
     ni de remise à zéro après succès.
   - conversion de l'interval : mutant `extract(minute …) * 60000` vert ; seul 5 min est testé : ajouter heures et
     jours (ex. 2 h, 3 jours) et le tiers de maintien.
   - le test du délai importe `ORPHAN_DELAY_MS` : mutant `ORPHAN_DELAY_MS = 0` vert (tautologique) ; écrire 59 s / 61 s
     en littéraux. (Le mutant littéral `<= 0` est tué.)

## Mineurs
- Isolation Jest : les tests de WP11 filtrent `targets()` sur leurs grands livres (ScopedRepo) et n'affirment rien de
  global ; `--maxWorkers=3` x2 sur cashless_wp11 : 20/20 verts les deux fois. OK. Mais les brouillons READY laissés
  committés par ces suites font échouer `tests_offline_rights.sql` test 87 (189 au lieu de 1) tant que la base n'est
  pas remise à zéro : à signaler au CI (reset-db avant pgTAP) ; sans effet après reset.
- Le jet journalise l'alarme 2 dès 60 s (« non signé depuis plus d'une minute ») alors que l'alarme 2 du signataire
  est à 5 min : un signataire lent déclenche l'alarme des deux côtés.
- `OWNED_FIELD_MISMATCH` : alarme au 3e testée (mutant tué) ; le journal du 3e est testé.

## Preuves relancées (cashless_wp11)
Jest runInBand : snapshots-content (unit + intégration), architecture, config : 150/150. tsc --noEmit propre.
pgTAP tests_offline_rights + tests_execute_grants : 272/272 après reset-db. Mutants tués : réservation jamais
levée (2), plafond constant 15 min (1), balayage retiré (1), races sans alarme (1), jet sans délai littéral (1).
