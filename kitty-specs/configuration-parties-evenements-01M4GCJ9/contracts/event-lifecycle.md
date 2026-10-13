# Contrat — Cycle de vie d'un événement

1. **Création** (`createEvent`) : une transaction écrit `event` (`DRAFT`), appelle `open_event_ledger`, écrit la
   version 1 de configuration `EVENT` et la ligne d'audit. Détenteur des fonds obligatoire ; `THIRD_PARTY` exige
   `funds_holder_party_id`. Réponse : l'événement avec `ledger_id`.
2. **Conditions** (`getEventStatusConditions?to=<statut>`, défaut : statut suivant) : conditions `DATABASE`
   (`event_transition_conditions`), `CONFIGURATION` (pour `LIVE` : `FUNDS_HOLDER_SET`, `CONTRACT_IN_FORCE`,
   `JURISDICTION_SET`, `LEDGER_OPEN`) et `EXTERNAL` (`met = null`, ex. `CASH_DESKS_COUNTED` → mission « Recharges,
   caisses et PSP », `PSP_RECONCILED`, `DEVICES_REPORTED` → mission « Terminaux »).
3. **Passage** (`transitionEventStatus`) :
   - `DRAFT → LIVE` : conditions `CONFIGURATION` toutes remplies (sinon `409 CLOSING_CONDITION_NOT_MET`, condition
     nommée), puis demande `EVENT_GO_LIVE` (`202`). À l'approbation : nouvelle vérification, `set_event_status`
     (auteur = demandeur) ; échec ⇒ `FAILED`.
   - autres passages : `set_event_status(événement, statut, personne connectée)` ; `CL018` ⇒ `409
     EVENT_TRANSITION_INVALID` ; `CL019` ⇒ `409 CLOSING_CONDITION_NOT_MET` (le `detail` nomme la condition, traduit,
     sans texte SQL).
   - chaque passage réussi : ligne d'audit `EVENT_STATUS_CHANGED` (avant, après, valideur s'il y en a un).
4. **Modification** (`updateEvent`) : `DRAFT` ⇒ immédiate ; `LIVE` ⇒ `202` (`EVENT_SETTINGS_CHANGE` ou
   `EVENT_OPERATOR_SETTINGS_CHANGE`) ; à partir de `CLOSING` ⇒ seules les clés permises par §12.1 (aucune dans cette
   mission : `409 CONFLICT_STATE`).
