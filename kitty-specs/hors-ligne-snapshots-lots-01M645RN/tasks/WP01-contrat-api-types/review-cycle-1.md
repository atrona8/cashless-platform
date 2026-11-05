---
affected_files: []
cycle_number: 1
mission_slug: hors-ligne-snapshots-lots-01M645RN
reproduction_command:
reviewed_at: '2026-10-30T11:39:29Z'
reviewer_agent: claude
wp_id: WP01
---

# Relecture WP01 - rejet (2 constats bloquants)

1. BLOQUANT - Route `getDeviceJournalImport` absente. `grep getDeviceJournalImport|DeviceJournalImportResult packages/contracts/openapi.yaml`
   ne trouve que `POST /devices/{device_id}/journal-imports` (importDeviceJournal, l.1103) et le schema
   `DeviceJournalImportResult` (l.14969). Correction : ajouter `GET /devices/{device_id}/journal-imports/{import_id}`,
   operationId `getDeviceJournalImport`, tag Hors ligne, humanBearer, roles SUPERVISOR et ORGANIZER_ADMIN, `404` neutre hors prestataire
   (jamais 403), reponse 200 `DeviceJournalImportResult` (status PROCESSING|APPLIED|FAILED, verifier l'enum du schema),
   parametres DeviceId + `import_id` (uuid). Mettre a jour la description de importDeviceJournal (« se lit ensuite par l'etat de l'import
   ou des lots » -> renvoyer a getDeviceJournalImport). Regenerer TS et Dart (`npm run generate` / `generate:dart`), verifier `check`.
   Messages fr/en : aucune cle nouvelle si NOT_FOUND suffit, le confirmer.
2. BLOQUANT - `pwd_pack_sha256` (SnapshotEntry, l.13968-13974) est decrit « SHA-256 du chiffre `pwd_pack_enc` » : trop vague.
   `pwd_pack_enc` reste l'objet `EncryptedBlob`. Correction : preciser que `pwd_pack_sha256` = SHA-256 de nonce || ciphertext || tag
   (octets bruts decodes, concatenes, 34 octets : 12 + 2 + 16... selon contracts/snapshots.md a jour), et le repercuter dans la
   description de `pwd_pack_enc` (l.13965-13967) et celle de getOfflineSnapshot (l.4310). Regenerer.

Mineurs (non bloquants) :
- m1. `OfflinePolicy.cash_topup_offline` (l.12364) reste `boolean` decrit « toujours false » : conforme a l'annonce, accepte. Les trois PUT passent par OfflinePolicyLevel `const: false` : le schema refuse bien `true`.
- m2. Message fr/en : seuls 2 details ajoutes ; tous les codes de ProblemCode ont une cle fr/en (verifie, aucun manquant).
