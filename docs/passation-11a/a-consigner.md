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
7. **Audit de `cashless_pin` (WP03, relecture).** `INSERT` sur `audit_log` borné par le prestataire (RLS), non restreint
   aux actions `VENDOR_*` par une politique dédiée (comme `cashless_tagkeys`). Réduction de surface possible.
8. **Mot de passe de `cashless_pin` (WP03).** Absent en production : rôle sans mot de passe, comme les autres rôles de
   processus (seuls les rôles de la passerelle refusent) ; comportement existant.
9. **`--ledger` refusé par `edge-admin register` (WP12, relecture du 19/11/2026).** Le grand livre est rendu par la base
   (`register_edge_gateway`), l'option est refusée même vide ou identique. Un script de site qui la passe encore casse
   volontairement (procédure §2 à jour). `CL058` prouvé côté SQL par le seul pgTAP de WP02 ; côté outil sur le faux.
   Écart de périmètre accepté : 5 lignes de `commands-other.spec.ts` au lieu de 3 (signature de `registerReal`), plus
   l'assertion « grand livre écrit = `identify_edge_gateway` » (T047 §5).
10. **Casse de compilation WP06 → WP07.** Après WP06, `tsc` échoue dans `src/vendors/` tant que WP07 n'est pas fusionné
   (l'API n'a plus `hash`/`verify`) ; `config.ts` lit encore `VENDOR_PIN_SECRET` côté API jusqu'à WP07 (exemption
   nommée du test d'architecture). WP06 et WP07 se fusionnent ensemble. Cas concurrent 23505→409 de vendor-pin non testé.
11. **Rejeu de l'appel signé vendor-pin (WP06, relecture du 19/11/2026).** Ni nonce ni cache de signatures : un appel
   signé rejoué dans la fenêtre de ±30 s est accepté ; `interfaces.md` ne l'exige pas. Le corps porte le PIN en clair
   (limite connue d'OP-N76). Sécurité de l'appel = secret partagé + écoute loopback (TLS 1.3 exigé hors loopback en
   production). Question posée au porteur le 19/11/2026.
12. **Corps brut absent (WP06, mineur).** La garde signe `req.rawBody ?? Buffer.alloc(0)` : sans `rawBody`, le corps
   n'est plus couvert (fail-open latent, non exploitable : `rawBody: true` partout). Durcissement proposé : 401 si un
   corps est présent sans `rawBody`.
13. **Tests faibles WP06.** Cas concurrent 23505→409 `CONCURRENT` non testé ; « route non marquée refusée » accepte
   401 ou 404.
