# Contexte de la mission 9a (remboursements-01M7AG5V) : décisions du porteur

Branche de planification et de fusion : `feat/remboursements`. Sources de la mission : `kitty-specs/remboursements-01M7AG5V/`
(`spec.md`, `plan.md`, `research.md` R-01 à R-12, `data-model.md`, `contracts/served-operations.md`,
`contracts/interfaces.md`).

1. (13/11, découpage) La mission 9 est coupée en 9a (remboursements) et 9b (versements, rapprochements, clôture).
2. (13/11) Services externes simulés jusqu'à la 12b ; aucun faux en production.
3. (13/11, specify) Paiement manuel : demande, approbation à deux, paiement hors système, confirmation `PAID`/`FAILED`.
   Aucun port de versement.
4. (13/11, specify) Demande créée par le back-office (virement `BANK_TRANSFER`) reportée en 9b (OP-N123) ; en 9a,
   `BANK_TRANSFER` à la création → `422 REFUND_NOT_ALLOWED`.
5. (13/11, plan) `REVERSAL` d'un `WALLET_REFUND` (source back-office) accepté par la base partout où `WALLET_REFUND`
   l'est ; rien d'autre n'est élargi ; test négatif ; ADR-189.
6. (13/11, plan) Portefeuille bloqué remboursable seulement si le blocage vient d'un bracelet déclaré perdu ; refus
   pour contestation, fraude, `other_block`, bracelet `BLACKLISTED`, portefeuille `CLOSED`.
7. (13/11, plan) Rôles qui proposent et approuvent : `OPERATOR_ADMIN` ou `ORGANIZER_ADMIN`, portée de l'événement.
8. (13/11, plan) Règle de frais de remboursement obligatoire : sans règle, refus `422` (comportement actuel du résolveur).
9. (05/11, toujours valable) Contrat stable : aucune route, aucun champ, aucun code d'erreur ajouté.
10. (13/10, règle du porteur, CLAUDE.md) Tout écart qui affaiblit la sécurité est soumis avant d'être codé ; un
    renforcement se fait puis se consigne.
