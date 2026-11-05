# Decision Moment `01M667XBV66NBKA5DEFFXY15HM`

- **Mission:** `hors-ligne-snapshots-lots-01M645RN`
- **Origin flow:** `plan`
- **Slot key:** `plan.security.signer-rights`
- **Input key:** `signer_rights`
- **Status:** `resolved`
- **Created:** `2026-10-30T11:07:55.110627+00:00`
- **Resolved:** `2026-10-30T11:08:09.952871+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Rôle cashless_snapsign : rejet d'un brouillon altéré, marque des alertes RETRY de plus de 24 h, audit SNAPSHOT_PUBLISHED ?

## Options

- Deux EXECUTE + audit en base
- Aucun droit ajouté
- Discard seulement

## Final answer

EXECUTE de discard_offline_snapshot_draft et de mark_offline_retry_alerted (colonne offline_batch_retry.alerted_at) accordés à cashless_snapsign ; audit SNAPSHOT_PUBLISHED écrit par publish_offline_snapshot (DEFINER), aucun droit d'audit au rôle ; ADR-140.

## Rationale

_(none)_

## Change log

- `2026-10-30T11:07:55.110627+00:00` — opened
- `2026-10-30T11:08:09.952871+00:00` — resolved (final_answer="EXECUTE de discard_offline_snapshot_draft et de mark_offline_retry_alerted (colonne offline_batch_retry.alerted_at) accordés à cashless_snapsign ; audit SNAPSHOT_PUBLISHED écrit par publish_offline_snapshot (DEFINER), aucun droit d'audit au rôle ; ADR-140.")
