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

3. **17/11/2026 (specify)** — Relevés importés en CSV, rapprochement automatique puis manuel ; lot préparé par un
   administrateur et validé par un second ; étapes de clôture par action avec aperçu ; copie externe des scellements
   simulée jusqu'à la 12b (refusée en production) ; relevés par API et CSV.
4. **17/11/2026 (plan)** — Rôle du versement selon le bénéficiaire (SPECIFICATION §3.2 à amender) ; transactions longues
   par fonction dédiée sans texte de requête ; alertes par audit, journal et notification, envoi réel en 12b ;
   `postLateClaim` plus `ADJUSTMENT` ajouté au contrat.
5. **17/11/2026 (plan)** — Ajouts au contrat de `contracts/contract-additions.md` validés tels quels (20 opérations,
   3 valeurs de condition, code `PAYOUT_EXCEEDS_ENTITLEMENT`).

## Héritages

- Mission 6 : OP-N82 (anomalies PSP dans le contrôle « grand livre = relevé »), refus de `RECONCILING` avec une caisse
  ouverte (A32).
- Mission 9a : OP-N123, réclamations tardives de `WALLET_REFUND`, OP-N124, OP-N126, OP-N128, OP-N130, `requested_by`.
