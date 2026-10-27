# Review WP01 (relecteur) - verdict : changements demandés

## 1. [BLOQUANT, moyen] Charge utile `PSP_CONFIGURATION` non conforme à la migration 0037
`openapi.yaml` (requestPspConfigurationChange ~l.3450, ApprovalAction ~l.14309) documente la charge
`{psp_config_id, compliance_ref}` / `{psp_config_id, status: SUSPENDED}`.
`activate_psp_configuration` (0037, lane-c) exige `payload.psp_configuration_id` (texte = id de la
configuration), `payload.version` (= version de la configuration), lit `payload.status`
(ACTIVE|SUSPENDED, absent = ACTIVE) et `payload.compliance_ref` (obligatoire pour ACTIVE).
Correction : décrire la charge `{psp_configuration_id, version, status, compliance_ref}` (compliance_ref
requis si ACTIVE), dans les deux endroits (et exemples), en précisant que l'API la compose depuis le
chemin et la version lue en base (le corps de la requête reste `{status, compliance_ref}`). Signaler
l'écart de nom `psp_config_id` (HTTP) / `psp_configuration_id` (charge, colonne). Même vérification pour
les charges CASH_DEPOSIT/WALLET_UNBLOCK/LATE_CHARGEBACK contre les migrations de WP02 à leur relecture.

## 2. [mineur] `secret_ref` : motif du contrat plus large que la base
`PspConfigurationCreate.secret_ref` accepte `[0-9a-fA-F-]{36}` et un nom sans borne ; 0037 impose
`^psp/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$`. Aligner (minuscules, `{1,100}`) pour que le refus soit 400/422
et non une erreur de base.

## 3. [info] Hors défaut du lot
- Les 12 nouvelles opérations n'ont pas `x-process` : seul `media-isolation.spec.ts` le lit (routes
  bracelets) ; aucune suite ne casse. Mais `device-auth-matrix.spec.ts` ne vérifie que garde -> contrat
  (pas contrat -> garde) : les opérations de terminal non servies (open/count/close/get cash-session,
  createCashTopup, initiatePspTopup, getPspTopup, cancelPspTopup) ne sont pas détectées ; WP08/WP09/WP11
  doivent ajouter leur cas à la matrice.
