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

6. **17/11/2026 (implémentation, phase 1)** :
   - **Suites générées** : les conditions nouvelles de WP02 sont gardées ; le scénario de référence est adapté
     par les générateurs (`gen_tests.py`, `gen_golden.py`, au besoin `scenario_reference.json`), `.sql`
     régénérés, jamais édités à la main ; `tests_event_ledger.sql` adapté. Fait par WP02 (nouveau cycle).
   - **Dart** : renommage des enums générés accepté (`Event.status` `Status4` → `Status5`,
     `TokenFamily.status` `Status5` → `Status6`) ; signalé dans la note aux équipes clientes (WP14).
   - **Versements (renforcements, WP03 nouveau cycle)** : `create_payout_batch` refuse une demande
     d'approbation non acceptée ou d'une autre action que `PAYOUT` ; une ligne `payout` exige
     `initiated_tx_id` à l'insertion et `settled_tx_id` au changement de statut.

7. **17/11/2026 (implémentation, constat de WP09)** — `import_statement_lines` (0083) rapprochait
   automatiquement sur la seule référence, sans comparer signe ni montant. Corrigé dans `0083` par un
   nouveau cycle de WP02 (pas de nouvelle migration) : rapprochement automatique seulement si le
   mouvement net de la transaction sur le compte égale le montant de la ligne. Renforcement, à consigner.
   Précisé après relecture (frais PSP portés par l'organisateur ou l'opérateur : +brut −frais sur le même
   compte) : même signe que le net, et montant égal au net **ou** au brut (somme des postings de ce signe).
8. **17/11/2026 (WP08)** — Droit disponible : `net_claim` = `party_position + pending_payouts`,
   `available` = `party_position` ; la formule du contrat devient exacte, `openapi.yaml` inchangé (seule la
   description de `net_claim` est à préciser).
9. **17/11/2026 (WP08)** — Export CSV des versements : msisdn en chiffres seuls, sans « + » ; la
   neutralisation des formules de `Csv.write` reste active partout.

## Héritages

- Mission 6 : OP-N82 (anomalies PSP dans le contrôle « grand livre = relevé »), refus de `RECONCILING` avec une caisse
  ouverte (A32).
- Mission 9a : OP-N123, réclamations tardives de `WALLET_REFUND`, OP-N124, OP-N126, OP-N128, OP-N130, `requested_by`.
