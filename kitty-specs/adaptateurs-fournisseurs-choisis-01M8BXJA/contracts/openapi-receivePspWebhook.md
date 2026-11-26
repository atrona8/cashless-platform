# Contrat — ajout rétrocompatible à `receivePspWebhook` (D9, IC-01)

Accepté par le porteur le 26/11/2026 (DM `01M8BYDCHFDWWS7A4QXBB85CRV`). Rien n'est retiré.

1. `requestBody.content` : ajout de `application/x-www-form-urlencoded` (schéma : objet libre ; utilisé par
   `paydunya` seulement ; refusé `400 VALIDATION_FAILED` pour les autres fournisseurs).
2. Description, point 1 : la phrase « L'en-tête dépend du PSP (Wave : `Wave-Signature: t=…,v1=…` ; autres :
   `X-Webhook-Signature`) » devient une liste par fournisseur :
   - `wave` : `Wave-Signature: t=…,v1=…` (HMAC-SHA256 de l'horodatage suivi du corps brut), tolérance ±300 s ;
   - `stripe` : `Stripe-Signature: t=…,v1=…` (HMAC-SHA256 de `horodatage.corps brut`), tolérance ±300 s ;
   - `paydunya` : corps en formulaire, preuve d'origine `data[hash]` ; la notification n'est qu'un signal : le
     paiement est relu auprès de PayDunya avant tout crédit (réponse `200`, aucune écriture à la réception) ;
   - `orange-money` : inchangé (adaptateur à venir).
3. `contract-baseline.json` : différences admises inscrites ; `node tools/contract-stability/check.mjs` sans refus.
4. Les types générés de `packages/contracts` sont régénérés.
