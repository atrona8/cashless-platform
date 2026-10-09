# Decision Moment `01M4DNGS77DS2DX1QEMX68HPT7`

- **Mission:** `identite-roles-double-validation-01M4DNDN`
- **Origin flow:** `specify`
- **Slot key:** `specify.auth.identity-provider`
- **Input key:** `identity_provider`
- **Status:** `resolved`
- **Created:** `2026-10-08T11:49:00.263952+00:00`
- **Resolved:** `2026-10-08T11:49:10.158738+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Quel serveur d'identité pour les personnes (back-office, guichet) ?

## Options

- Serveur OIDC standard derrière une interface, faux fournisseur en test, choix du produit différé
- Choisir maintenant un produit (Cognito, Keycloak)
- Comptes et mots de passe gérés par l'API
- Other

## Final answer

Serveur OIDC standard derrière une interface (vérification des JWT par clés publiques, émetteur et audience configurés) ; faux fournisseur qui signe ses jetons en test ; le jeton de rafraîchissement et la connexion restent chez le serveur d'identité ; choix du produit différé (non bloquant, consigné). Raison : contrat humanBearer = JWT OIDC ; aucune ADR n'a choisi de produit. (décidé par l'agent, délégation du porteur du projet)

## Rationale

_(none)_

## Change log

- `2026-10-08T11:49:00.263952+00:00` — opened
- `2026-10-08T11:49:10.158738+00:00` — resolved (final_answer="Serveur OIDC standard derrière une interface (vérification des JWT par clés publiques, émetteur et audience configurés) ; faux fournisseur qui signe ses jetons en test ; le jeton de rafraîchissement et la connexion restent chez le serveur d'identité ; choix du produit différé (non bloquant, consigné). Raison : contrat humanBearer = JWT OIDC ; aucune ADR n'a choisi de produit. (décidé par l'agent, délégation du porteur du projet)")
