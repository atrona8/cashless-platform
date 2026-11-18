# Limites et écarts à consigner par WP14 (tenu par l'orchestrateur)

1. **Distinction du secret du PIN entre processus (WP04, relecture du 18/11/2026).** Une fois l'API sans
   `VENDOR_PIN_SECRET`, un secret du PIN réutilisé comme autre secret dans un autre processus ou sur une autre machine
   n'est détecté nulle part ; `vendorPinSettings` ne compare qu'avec son propre environnement. Inhérent à la séparation
   voulue (OP-N76). À consigner : OP, ADR, test de borne, report PROMPTS/PRD.
2. **`CHECK` IBAN `NOT VALID` (WP02).** Une ligne ancienne de `refund_request` ou `payout` avec un IBAN en clair ne peut
   plus changer d'état (le `CHECK` est réévalué à l'`UPDATE`). Sans effet en pré-production (aucune donnée réelle,
   bases de développement recréées). À consigner dans la fiche d'OP-N140.
3. **Déclencheur d'insertion de `refund_request` (WP02).** Les superutilisateurs sont exclus de la garde (fixtures en
   propriétaire) ; un superutilisateur pouvait déjà désactiver le déclencheur. Neutre.
4. **Historique de création des lots (WP01).** `create_media_batch` exige un acteur (renforcement d'audit).
5. **Déploiement (WP04).** En production, tout processus qui appelle `loadConfig` exige `VENDOR_PIN_CALL_KEY`,
   `IBAN_KEYRING` et `IBAN_ACTIVE_KID`.
6. **Masque d'IBAN en texte libre (WP08, relecture).** Non masqués en texte libre : IBAN à tirets (`FR76-3000-…`),
   espaces insécables, deux IBAN collés. Les champs `iban` (JSON, `iban=`) restent masqués par nom. Correction légère
   possible (séparateur `[  -]?`). Le numéro de mobile money (`msisdn`) n'est pas masqué : question posée au
   porteur le 18/11/2026.
