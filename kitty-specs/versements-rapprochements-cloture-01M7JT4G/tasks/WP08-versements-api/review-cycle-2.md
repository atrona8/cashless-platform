---
affected_files: []
cycle_number: 2
mission_slug: versements-rapprochements-cloture-01M7JT4G
reproduction_command:
reviewed_at: '2026-11-17T10:11:37Z'
reviewer_agent: claude
wp_id: WP08
---

# WP08 — nouveau cycle (décisions du porteur du 17/11/2026, après relecture approuvée)

## 1. Droit disponible (décision 8)
`party_position` baisse déjà quand un versement passe `INITIATED`. Pour que la formule du contrat
(`available = net_claim − pending_payouts`) soit vraie sans double déduction :
- `net_claim` = droit avant versements en cours = `party_position + pending_payouts` ;
- `pending_payouts` = versements `INITIATED` non réglés (inchangé) ;
- `available` = `party_position` (plafond d'un nouveau versement, inchangé en valeur).
`openapi.yaml` n'est pas modifié ; la note de lane signale que la description « Droit net
(`party_position`) » de `net_claim` est à préciser (consignation WP14). Tests : un versement INITIATED
laisse `net_claim` inchangé, augmente `pending_payouts` et baisse `available` d'autant ; après
CONFIRMED, `net_claim` et `pending_payouts` baissent, `available` inchangé ; après FAILED, retour à l'état
initial.

## 2. Export CSV, numéro mobile (décision 9)
La colonne destination sort le msisdn en chiffres seuls, sans « + » (ex. `221771234567`). La
neutralisation de `Csv.write` reste active partout (ne pas la contourner). Test : msisdn `+221…` exporté
en `221…` sans apostrophe ; un nom commençant par `=` ou `+` reste neutralisé.
