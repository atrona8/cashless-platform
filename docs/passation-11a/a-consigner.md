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
   production). **Décision du porteur (19/11/2026) : cache de signatures vues, rejeu refusé en 401**, confié à WP07
   (retouche hors carte autorisée de `vendor-pin-call.guard.ts`), avec le refus d'un corps sans `rawBody` (point 12).
12. **Corps brut absent (WP06, mineur).** La garde signe `req.rawBody ?? Buffer.alloc(0)` : sans `rawBody`, le corps
   n'est plus couvert (fail-open latent, non exploitable : `rawBody: true` partout). Durcissement proposé : 401 si un
   corps est présent sans `rawBody`.
13. **Tests faibles WP06.** Cas concurrent 23505→409 `CONCURRENT` non testé ; « route non marquée refusée » accepte
   401 ou 404.
14. **App Attest, vecteurs locaux (WP13, R1).** Les vecteurs d'assertion sont générés localement : une erreur de double
   hachage ECDSA y serait invisible. Un vecteur réel d'Apple est exigé avant la mission 12. Déni de service : une API
   compromise peut faire avancer le compteur d'un appareil (le bloquer) ; test de borne à écrire par WP14.
   Relecture du 19/11/2026 : code conforme à la procédure Apple (lu contre la spécification) ; le vérificateur n'a aucun
   appelant en production (voulu, gardé par un test d'architecture).
15. **Versements (WP10).** Export illisible (enveloppe altérée, autre prestataire, clair ancien) : 500 sans CSV ni
   valeur. `canSee` montre encore un lot mixte à un détenteur d'une seule classe (lecture seule). Contradiction
   prompt/`interfaces.md` sur `guardDecision` : `interfaces.md` suivi. Renforcement FR-014 : le refus exige aussi la
   classe de bénéficiaire.
16. **Scénario de clôture et matrice d'authentification (diagnostic du 19/11/2026).** `closing-journey.spec.ts` échoue
   (5/8) dans toute lane qui a WP02 sans WP10 : `0093` (`payout_iban_sealed`) refuse l'IBAN en clair que l'API écrit
   avant WP10 (23514 dans `create_payout_batch`). État intermédiaire voulu ; 8/8 dans la lane j (WP10). Pas une
   régression. Défaut de rapport : 23514 classé `VALIDATION_FAILED` sans motif (`payout-action.ts`, `SQL_FAILURES`),
   amélioration possible. `device-auth-matrix` et les tests qui ouvrent une session par `POST /vendor-sessions`
   (`payments-*`, `payment-journey`, `payment-isolation`, `offline-secrets`) : 403 depuis WP03 (OP-N76, voulu), levée
   attendue par WP07 ; ces fichiers ne sont dans aucun `owned_files` : à relancer en série après WP07.
17. **Lots de bracelets (WP05, relecture cycle 2 du 19/11/2026).** Le verrou consultatif (`hashtextextended('media-batch:'
   || id)`) est pris avant le contrôle RLS : un prestataire qui connaît l'UUID d'un lot d'un autre peut retarder son PATCH
   le temps de sa propre transaction (aucun accès aux données). Renforcement d'audit : l'historique `→ORDERED` porte le
   motif « Création du lot » (au lieu de NULL), non noté dans une note de lane.
18. **`checkSealed` à l'exécution d'un versement non prouvé (WP10, relecture du 19/11/2026).** La mutation qui retire
   l'ouverture de l'enveloppe dans `execute` laisse les 39 tests verts : aucun test ne forge une enveloppe altérée ou
   d'un autre prestataire avant l'approbation (le seul test de forge, en clair, est arrêté par `validatePayload`).
   Risque faible (l'export échoue fermé). Correction : un test dans `payout-batch.spec.ts`. **Décision du porteur
   (19/11/2026) : ajouter le test** (correctif court dans la lane j, sans nouveau cycle). **Levé** : commit `414e35f2` (enveloppe altérée et
   d'un autre prestataire forgées en base → `FAILED`, rien au grand livre ; mutation `checkSealed` retiré → rouge).
