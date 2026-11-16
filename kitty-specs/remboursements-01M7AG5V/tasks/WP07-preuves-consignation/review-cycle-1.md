---
affected_files: []
cycle_number: 1
mission_slug: remboursements-01M7AG5V
reproduction_command:
reviewed_at: '2026-11-16T11:09:12Z'
reviewer_agent: claude
wp_id: WP07
---

# Retour de relecture WP07, cycle 1 -> cycle 2 (rejet pour traiter tout en un cycle)

Preuves relancees sur cashless_wp07 : Jest refunds + release-chaining + me-refund + debit-authority = 19 suites, 166 verts, 1 saute ;
refund-latency seul (sans SKIP_LATENCY) 4/4 (creation p95 422 ms, listes p95 75 et 116 ms) ; pgTAP tests_refund_requests 88/88 et
tests_replace_cash_due 39/39 ; typecheck propre. Aucun .sql, openapi ni code src modifie par WP07. ADR-189..195 et OP-N124..129 sans collision
avec main ni feat (feat s'arrete a ADR-188 / OP-N123).

## Mises a jour imposees par les decisions du porteur du 16/11
1. Decision 14 (OP-N129) : corrige en 9a (WP03 rouvert : l'envoyeur recoit refund_request_id et otp_request_id pour le lien du contrat).
   OP-N129 ne doit plus etre une dette : le consigner comme LEVE par la 9a (OP, ADR si utile, PROMPTS, PRD, note app festivalier) et
   remplacer la mention "a soumettre au porteur" ; ajouter un test qui prouve que l'envoyeur recoit les deux identifiants et qu'un
   parcours de bout en bout decide via ce lien (journey.spec.ts).
2. Decision 15 (C-001, OP-N127) : comportement strict conserve, spec amendee (branche "sans titulaire verifie -> REQUESTED" retiree de
   FR-012 et du scenario 5). Passer ADR-194 de "Proposee" a "Acceptee (decision du porteur du 16/11/2026)", fermer OP-N127, adapter
   le test journey-limits (OP-N127) en test de comportement strict (plus de "limite" a borner), reporter dans PROMPTS et PRD. FR-012 passe en "pass".
3. data-model.md l. 51 ("autre numero sans titulaire -> REQUESTED") : corrige par l'orchestrateur sur feat ; WP07 n'a rien a faire.

## Constats
4. (mineur) OP-N128 (b), cumul lu sous le verrou du bracelet : "non teste" ; le dire clairement dans l'ADR-195 (fait) et garder la mission de levee "a confirmer par le porteur".
5. (mineur) Les tests de borne OP-N124/125/126 echouent bien si la limite s'elargit (assertions lues : code consomme apres 409, 429 commun, 403 FAILED au proposant/executant) ; apres la levee d'OP-N129, verifier qu'ils restent vrais.
6. (info) Mesures : vraies requetes simultanees (Promise.all), p95 par percentile, aucune comparaison horloge Node / base ; l'horloge Node n'est qu'injectee dans runOnce.
7. OP-N51 / OP-N55 : preuves citees existent et passent.
Rien d'autre de bloquant ; aucun affaiblissement consigne comme accepte sans decision du porteur.
