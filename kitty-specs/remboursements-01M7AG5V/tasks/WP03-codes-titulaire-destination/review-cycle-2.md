---
affected_files: []
cycle_number: 2
mission_slug: remboursements-01M7AG5V
reproduction_command:
reviewed_at: '2026-11-16T11:08:58Z'
reviewer_agent: claude
wp_id: WP03
---

# WP03, réouverture du 16/11/2026 : le titulaire ne peut pas construire son lien (OP-N129, décision 14 du porteur)

Constat de WP07 : `decideRefundRequestAsHolder` exige `otp_request_id` et `code`. Le contrat prévoit que le titulaire
les reçoit par « un lien reçu sur le numéro vérifié du titulaire ». Or `startHolderChallenge` jette l'`otp_request_id`,
et le port `OtpSender.send(phone, code, channel)` ne reçoit ni l'identifiant de la demande ni celui du défi. Le
titulaire ne peut donc ni confirmer ni bloquer ; les tests contournent le problème en lisant la base.

Décision 14 du porteur (`docs/passation-9a/contexte-9a.md`) : corriger en 9a.

## 1. BLOQUANT : le lien du titulaire

- Étendre le port `OtpSender` (`apps/api/src/customer-auth/otp-sender.ts`, retouche hors carte autorisée par cette
  décision) pour qu'un envoi d'usage « titulaire » reçoive aussi `refundRequestId` et `otpRequestId`. Par exemple, un
  argument optionnel `link?: { refundRequestId: string; otpRequestId: string }`, ou un `purpose` explicite.
  L'adaptateur réel (mission 12b) construira le lien.
- Garder la signature pour la connexion : `otp.spec.ts`, `attempts.spec.ts` et `tokens.spec.ts` doivent rester
  inchangés et verts.
- `startHolderChallenge` passe ces deux identifiants à l'envoyeur, dans la même transaction que la création du défi.
  Si un envoi échoue, rien ne doit rester incohérent : suis le comportement actuel de `requestOtp`.
- SÉCURITÉ (OP-N120) : le faux envoyeur rend le code dans l'en-tête `X-Test-Otp-Code` de la réponse de connexion. Le
  code du TITULAIRE ne doit JAMAIS apparaître dans la réponse de `createMyRefundRequest`, ni dans aucune autre
  réponse adressée au demandeur, en-têtes de test compris, ni dans les journaux. Pour les tests, le faux garde en
  mémoire le dernier envoi (numéro, code, `refundRequestId`, `otpRequestId`), lisible par les tests seulement via
  l'injection Nest du provider. Aucune route ajoutée.
- Faux toujours refusé en production : `createOtpSender` est inchangé, un test le prouve déjà.
- Aucune route, aucun champ ni code d'erreur ajouté à `openapi.yaml`.
- Test de bout en bout SANS lecture en base :
  1. création vers un autre numéro ;
  2. le faux reçoit `otpRequestId` et le code ;
  3. `POST /refund-requests/{id}/holder-decision` avec ces valeurs → `BLOCK` → `BLOCKED` ;
  4. idem pour `CONFIRM` → `REQUESTED`.
  Ajouter un test qui prouve que la réponse de `createMyRefundRequest` ne contient pas le code du titulaire (corps
  et en-têtes).
- Si `createMyRefundRequest` (WP04, `refund-requests.service.ts`) appelle `startHolderChallenge` sans changement de
  signature, ne touche pas au fichier de WP04. S'il faut y toucher, limite-toi à l'appel et signale-le.

## 2. Ce qui ne change pas

Le reste du lot est approuvé (cycle 1). Ne modifie rien d'autre.
