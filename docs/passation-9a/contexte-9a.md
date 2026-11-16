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
11. (16/11, implémentation de WP06) **Seuil de la seconde personne au guichet sur le cumul** : `cash_refund_single_max`
    est comparé (`>`) au TOTAL des espèces sorties pour une restitution (caution rendue en espèces `SEPARATE` + brut du
    `WALLET_REFUND` + espèces dues), et non au seul `WALLET_REFUND`. Renforcement, même `403 APPROVAL_REQUIRED`, contrat
    inchangé. À consigner par WP07 (ADR, section « Renforcements »).
12. (16/11, relecture de WP03) **Deux limites acceptées et consignées, sans nouveau cycle sur WP03** ; WP07 en fait
    chacune un point ouvert, un ADR, un test qui échoue si la limite s'élargit, et un report dans `PROMPTS-A-ENVOYER.md`
    et `PRD.md` (mission qui la lève à proposer au porteur) :
    a. le code du titulaire est consommé avant l'écriture de sa décision : si cette écriture échoue (panne, 409), il ne
       peut pas réessayer, et un `BLOCK` perdu laisse la demande passer `REQUESTED` à l'échéance ;
    b. le quota et le blocage de 30 min par numéro sont communs à tous les usages (R-05) : un tiers peut épuiser le quota
       d'un numéro par des demandes de connexion publiques et gêner `createMyRefundRequest` (429) ou le `BLOCK` du
       titulaire. L'alerte de `BLOCK` réduite à une ligne d'audit est à nommer dans la même entrée.
13. (16/11, relecture de WP05) **Confirmation `FAILED` par une personne étrangère au remboursement** : `confirmRefundRequest`
    avec `outcome = FAILED` est refusé si l'appelant a proposé (auteur de l'approbation) ou exécuté (`approved_by`) le
    remboursement, avec un code déjà au contrat (`403`, réponse `Forbidden`) ; `PAID` reste ouvert à toute personne
    habilitée. Contrat inchangé. Une seule personne habilitée suffit encore pour recréditer : dette à consigner par WP07
    (OP + ADR + test qui borne la limite), levée par les rapprochements avec les relevés Wave/Orange Money (mission 9b).
14. (16/11, constat de WP07, OP-N129) **Lien du titulaire corrigé en 9a** : pour l'usage « titulaire », l'envoyeur de
    codes (port `OtpSender`) reçoit aussi `refund_request_id` et `otp_request_id` pour construire le lien du contrat
    (`decideRefundRequestAsHolder`). Aucune route ni champ ajouté à `openapi.yaml` ; faux envoyeur toujours interdit en
    production ; test de bout en bout sans lecture en base. Correction portée par WP03 rouvert ; OP-N129 levé par la 9a.
15. (16/11, C-001, OP-N127) **FR-012 amendée, comportement strict gardé** : la branche « sans titulaire vérifié →
    `REQUESTED` directement » est retirée de FR-012 et du scénario 5 (`spec.md`) ; un compte sans identité vérifiée est
    refusé (`422 REFUND_NOT_ALLOWED`). OP-N127 clos par ADR-194.
