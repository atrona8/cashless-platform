---
affected_files: []
cycle_number: 5
mission_slug: versements-rapprochements-cloture-01M7JT4G
reproduction_command:
reviewed_at: '2026-11-17T09:56:32Z'
reviewer_agent: claude
wp_id: WP02
---

# WP02 relecture du cycle a8e2e8c0 : constats

## Constat 1 (majeur, regression fonctionnelle, a trancher par le porteur)
Le filtre compare `sum(posting.amount)` de la transaction sur le compte de la ligne a `amount`. Le
constructeur reel de recharge (`apps/api/src/ledger/builders/festival/topup.ts`) avec
`pspFeeBearer` = ORGANIZER ou OPERATOR poste sur le meme compte A-PSP-* `+amount` puis `-pspFee` :
mouvement net = brut - frais. Une ligne de releve au brut (= `psp_topup.amount`, que
`psp_complete_core` impose comme somme des postings positifs) n'est plus rapprochee (verifie par
test jetable : transaction +1000/-30 sur le compte, ligne 1000 : matched=0). Les tests 3b n'utilisent
que des transactions synthetiques a deux lignes : ce cas reel n'est pas couvert.
Correction : decider si la ligne PSP est brute ou nette. Si brute (ou les deux possibles), comparer
aussi a la somme des postings > 0 sur le compte pour une recharge (ou accepter brut OU net) ; sinon
documenter que le releve est net. Ajouter un test avec la forme reelle du constructeur (frais sur le
meme compte).

## Mineur
Rien d'autre : signes verifies (posting + debit = entree ASSET ; recharge +, contestation -,
remboursement -(montant-frais), versement -), unicite apres filtre intacte, perf 10 000 lignes ~10 s.
