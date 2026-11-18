---
affected_files: []
cycle_number: 4
mission_slug: versements-rapprochements-cloture-01M7JT4G
reproduction_command:
reviewed_at: '2026-11-17T09:50:19Z'
reviewer_agent: claude
wp_id: WP02
---

# WP02 — nouveau cycle (constat de la relecture de WP09, décision du porteur du 17/11/2026)

## Constat 1 (bloquant, exactitude/sécurité)
`import_statement_lines` (migration `0083_statements.sql`, CTE `valid`) rapproche automatiquement une ligne
de relevé à une transaction sur la seule référence externe et la présence d'un `posting` sur le compte,
**sans comparer ni le signe ni le montant**. Une ligne de signe contraire (ou d'un autre montant) est donc
rapprochée automatiquement, contre la règle « un montant de signe contraire à la transaction n'est jamais
rapproché automatiquement » (WP09, critère « Signe » et cas 7 du relecteur).

## Correction demandée (porteur : corriger dans 0083, pas de nouvelle migration)
- Dans `0083_statements.sql`, le rapprochement **automatique** n'a lieu que si le mouvement net de la
  transaction sur le compte de la ligne (somme des `posting` de cette transaction sur ce compte, exprimée
  dans la convention de signe de `external_statement_line.amount` : positif = entrée sur le compte
  d'argent, voir WP02 l. 93) est **égal** à `amount` de la ligne (même signe et même valeur absolue).
  Vérifie la convention de signe réelle de `posting` dans le schéma avant d'écrire la comparaison.
- Sinon la ligne reste non rapprochée (rapprochement manuel ou anomalie). Ne change pas
  `match_statement_line` (manuel) sauf si le prompt WP02 l'exige déjà.
- Garder l'unicité (`count(DISTINCT tx_id) = 1`) **après** le filtre montant/signe.
- Tests pgTAP (dans la suite de WP02 sur les relevés) : signe contraire → non rapproché ; même signe mais
  montant différent → non rapproché ; recharge positive et remboursement négatif corrects → rapprochés.
- NFR-003 : vérifier que l'import de 10 000 lignes reste sous 60 s (le filtre ne doit pas casser le plan).
- Signaler dans la note de lane : renforcement (à consigner), lanes f/g/h/i à refusionner.
