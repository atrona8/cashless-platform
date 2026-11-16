# Mission 9b — contexte et décisions du porteur

Mission : versements, rapprochements et clôture (`PROMPTS-A-ENVOYER.md`, section « Mission 9b »). Branche cible :
`feat/versements-rapprochements-cloture`, partie de `main` après la PR #17 (`b537c16d`, 9a close).

## Décisions du porteur

1. **17/11/2026 — Une seule mission.** Le périmètre de la section « Mission 9b » n'est pas découpé (proposition 9b/9c
   écartée par le porteur).
2. **17/11/2026 — Ajouts au contrat autorisés, listés au plan.** La mission peut ajouter à `openapi.yaml` les
   opérations absentes (versements, rapprochements, relevés, export, virement créé par le back-office), sans modifier
   l'existant. Le plan liste chaque route, champ et code d'erreur ajouté ; le porteur valide cette liste avant
   l'implémentation (exception à la consigne du 05/11/2026 pour cette mission seulement).

## Héritages

- Mission 6 : OP-N82 (anomalies PSP dans le contrôle « grand livre = relevé »), refus de `RECONCILING` avec une caisse
  ouverte (A32).
- Mission 9a : OP-N123, réclamations tardives de `WALLET_REFUND`, OP-N124, OP-N126, OP-N128, OP-N130, `requested_by`.
