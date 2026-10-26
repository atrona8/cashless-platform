# Relecture WP14, cycle 1 : APPROUVÉ

Base 0ddc4b7e (lane-n). Base de test cashless_wp14r (supprimée). Aucun constat bloquant ni majeur.

## Vérifications
- Suites du lot + media-isolation + device-key + merchant-qr + argon2 + configuration + reversals : 8 puis 12 suites vertes (96 et 149 tests).
- Mutations de l'intercepteur (device-key + media-isolation) : keyUuid 'without-device' jamais appliqué -> 1 échec ; appliqué aussi au terminal -> 1 échec ; deviceSeq 'when-device' toujours actif -> 3 échecs ; désactivé -> 1 échec ; deviceSeq true désactivé -> 4 échecs. Toutes tuées. Les routes `deviceSeq: true` (payments, création de demande QR) restent terminal seul ; reversePayment : UUID exigé pour la personne, terminal inchangé ; chemin festivalier de WP13 (annulation QR, 'when-device' sans keyUuid) inchangé.
- sql-config-resolver : même ensemble de requêtes, même ordre logique, mêmes erreurs (seul l'ordre de remontée si deux requêtes échouaient ensemble change, sans effet). Suite configuration verte ; le journey espionne le chevauchement.
- Isolation : opérations lues du contrat (tags + createCustomerQrToken), cas par opération et test d'orphelins ; objets de A valides (jeton, vente, portefeuille) ; snapshot avant/après ; 13 tables avec contrôle que A en a. Mutation RLS désactivée sur payment_request : le test des tables échoue. media-isolation : 47 opérations, cas QR avec jeton connu de A (nonceHash réel) depuis un festivalier de B, reversePayment présent.
- Secrets : contrôle positif présent pour les tables (empreintes, audit, idempotence non vides) et pour le journal (journal non vide) ; jetons vus une seule fois dans les réponses (positif). 
- Concurrence : Promise.all de 20 vraies requêtes HTTPS ; invariants (une vente, solde, pas de 5xx, pas d'écriture partielle) ; croisés sur 3 tours.
- Journey : une seule écriture directe après amorçage (ageSale, déclarée, triggers réactivés en finally).
- Latence : mesure autour de PaymentsService.create, 200 paiements en série ; CI : étape après la passe parallèle, en --runInBand, cohérente avec SKIP_LATENCY et CI.md.
- Consignation : OP-N74/ADR-120 levés avec migration 0035 et test pgTAP nommés ; OP-N80/ADR-130 conformes à la décision du porteur ; OP-N76/77/78/79, ADR-121/124 à 129 présents ; reports PROMPTS (missions 7, 11, 13) et PRD présents ; liste T072 complète (0031, 0033, 0034, 0035, post-roles.sql, vendor-pin, config, vendors, approval/onsite, qr-token, intercepteur, resolver).

## Constats (tous mineurs, non bloquants)
1. payment-secrets : le balayage n'a pas de contrôle positif de sa propre fonction de recherche (une valeur plantée connue, retrouvée). Il a des contrôles de couverture (tables, journal non vide, empreintes) mais pas de « canari » ; je n'ai pas pu y plaquer une fuite réelle sans modifier le code. Ajouter, à la mission 7 ou en passant, un secret planté dans une table temporaire et dans le journal, attendu trouvé.
2. media-isolation.spec.ts : la note du cas getPaymentRequest dit encore « sans le jeton » alors que le cas envoie maintenant le jeton valide ; texte à corriger. Le cas isolation de payment-isolation admet 401/403/404/409/422 pour toute opération : un 422 de validation pourrait masquer un défaut d'isolation sur un cas mal formé (les corps utilisés sont valides, vérifiés à la lecture) ; resserrer par cas à l'occasion. De même getCatalogVersion/1 : confirmer que la version 1 de A existe, sinon le 404 est trivial.
3. Garde `written.replayed` : mutant équivalent confirmé (la confirmation SQL refuse par le même 409 ; le test merchant-qr « report WP13 » prouve l'issue, pas laquelle des deux barrières agit). Avis : la garder (défense en profondeur, coût nul, empêche une confirmation de demande sur une vente que le service n'a pas écrite si la barrière SQL change) ; le commentaire du test devrait dire qu'il prouve l'issue et non la garde.
4. Lignes de commentaires et titres it(...) > 100 caractères dans les nouveaux fichiers : à reformater à la fusion (décision du 14/10).

## Hors lot (antérieur)
- contracts/vendors.md non aligné et propriétaire des fonctions de purge : déjà consignés comme ouverts.
- OP-N80 : aucun test de bornage (décision du porteur, disponibilité seulement) ; à lever mission 13.

Fichiers à faire relire par une personne : la liste T072 du compte rendu est complète ; j'y ajoute `apps/api/src/idempotency/idempotency.interceptor.ts` pour l'ordre (UUID puis numéro de terminal puis réservation), déjà cité.
