# Contrat — identité du terminal et du festivalier

## `DeviceIdentityPort`

`identify(requête) → { deviceId, operatorId, eventId, posId, agreementPublicKey }` ou refus `401`.

- Le terminal rendu doit exister dans `device`, appartenir au prestataire annoncé et être `ACTIVE` ; `SUSPENDED` et
  `REVOKED` sont refusés (`DEVICE_REVOKED` pour le second, comme au contrat).
- Le prestataire de la transaction (`app.operator_id`) vient de cette identité, jamais du corps de la requête.
- Faux : lit `X-Test-Device-Id`. Mission 5 : jeton d'appareil, mTLS et signature de la requête.

## `CustomerIdentityPort`

`identify(requête) → { customerId, operatorId, deviceRef }` ou refus `401`. `deviceRef` sert aux limites d'essais.
Faux : lit `X-Test-Customer-Id` et `X-Test-Customer-Device`.

## Opérateur humain au guichet

Les routes de guichet du contrat acceptent un terminal et une personne (`humanBearer`). La personne (rôle `CASHIER` ou
`SUPERVISOR` sur l'événement ou son organisateur) est identifiée par le mécanisme de la mission 2 ; son identifiant
sert à l'audit et à l'historique des statuts.

## Dettes de sécurité (C-012)

| Dette | Risque en production | Garde | Levée par |
|---|---|---|---|
| Faux terminal | quiconque se dit terminal | refus de démarrer en production | mission 5 |
| Requêtes de terminal non signées | rejeu, falsification d'une lecture | même garde ; le port prévoit la vérification | mission 5 |
| Faux festivalier | rattachement par un tiers | refus de démarrer en production | mission de l'app festivalier (10) |
| Faux KMS | clés dans le code | refus de démarrer en production | adaptateur AWS, après OP-N11 |
