---
affected_files: []
cycle_number: 2
mission_slug: routes-backoffice-01M86KT6
reproduction_command:
reviewed_at: '2026-11-25T15:27:54Z'
reviewer_agent: claude
wp_id: WP11
---

# WP11, cycle 2 : correctif d'intégration avant fusion (décision du porteur du 25/11)

WP11 a été approuvé au cycle 1 ; il est rouvert pour porter, dans la lane k (qui réunit tous les lots), le correctif
d'intégration décidé par le porteur. Retouches hors carte autorisées : fichiers de test listés ci-dessous.

1. Lever OP-N194 (tests seulement, aucun code de production) :
   a. Ventes (WP06) : test à deux événements du même prestataire qui échoue si `t.event_id = $1` disparaît de la CTE de
      `reversedQuery` (mutation à rejouer).
   b. Ventes (WP06) : dans le test « hors portée : 404 » de la liste sans filtre, assertion « aucun identifiant de A
      dans le corps ».
   c. Recherche (WP08) : cas PLATFORM_ADMIN AVEC un prestataire attribué → 403 sans audit (prouve le retrait du rôle
      indépendamment de l'absence de prestataire). Mutation : ajouter PLATFORM_ADMIN aux rôles → rouge.
   d. `consignation.spec.ts` étendu aux OP-N185 à OP-N198 (même forme que les entrées existantes).
2. Docs : OP-N194 levé (POINTS_OUVERTS + ADR-236) ; mission 11c validée par le porteur et OP-N185 « bloque la
   production : Oui » confirmé (POINTS_OUVERTS, PROMPTS-A-ENVOYER, PRD) ; décompte des empreintes de preuves.md et
   ADR-235 corrigé (32/33/31 incohérents : recompter dans contract-baseline.json et donner la source) ; consigner F3
   (anomalie `ledger_id IS NULL` lisible par OPERATOR_ADMIN seul) dans l'OP adapté.
