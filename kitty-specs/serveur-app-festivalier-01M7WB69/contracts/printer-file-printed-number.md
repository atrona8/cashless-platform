# Contrat — Numéro imprimé dans le fichier de l'imprimeur

Ajout rétrocompatible, validé par le porteur le 20/11/2026 ; inscrit dans `tools/contract-stability/contract-baseline.json`.

`POST /operators/{operator_id}/media-batches/{batch_id}/claim-code-associations` (`importClaimCodeAssociations`) :
description du corps `text/csv` étendue.

```
code,uid[,printed_number]
K7QM-4XH9RT,04A1B2C3D4E5F6,FS26-004812
```

- Troisième colonne facultative ; un fichier à deux colonnes reste valide (comportement inchangé).
- `printed_number` : 1 à 32 caractères `[A-Z0-9-]` (casse normalisée), unique par prestataire.
- Motifs de ligne refusée ajoutés : `BAD_PRINTED_NUMBER`, `PRINTED_NUMBER_TAKEN` (forme de la réponse inchangée).
- Lecture : `CustomerMedia.printed_number` (`listMyMedia`, `getMe`) ; `null` si inconnu.
