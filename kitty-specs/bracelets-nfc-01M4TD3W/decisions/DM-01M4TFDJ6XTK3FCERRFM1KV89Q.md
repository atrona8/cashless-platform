# Decision Moment `01M4TFDJ6XTK3FCERRFM1KV89Q`

- **Mission:** `bracelets-nfc-01M4TD3W`
- **Origin flow:** `plan`
- **Slot key:** `plan.architecture.kms-rights-separation`
- **Input key:** `kms_rights_separation`
- **Status:** `resolved`
- **Created:** `2026-10-13T11:12:30.941813+00:00`
- **Resolved:** `2026-10-13T11:20:33.771784+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

La spécification impose des droits KMS séparés entre quatre services (API publique : aucun ; clés de bracelet : Decrypt ; personnalisation : GenerateMac et GenerateDataKey ; contrôle quotidien : GenerateMac et Decrypt). Comment la mission 4 réalise-t-elle cette séparation ?

## Options

- A. Un seul code, quatre processus distincts (un point d entrée par service, chacun ne charge que ses modules et ses droits KMS)
- B. Un seul processus, séparation par modules et par ports KMS restreints, gardée par un test d architecture ; découpage en processus reporté
- C. Quatre applications séparées dans le dépôt
- Other

## Final answer

A. Un seul code, quatre processus distincts (un point d'entrée par service, chacun ne charge que ses modules et ses droits KMS)

## Rationale

_(none)_

## Change log

- `2026-10-13T11:12:30.941813+00:00` — opened
- `2026-10-13T11:20:33.771784+00:00` — resolved (final_answer="A. Un seul code, quatre processus distincts (un point d'entrée par service, chacun ne charge que ses modules et ses droits KMS)")
