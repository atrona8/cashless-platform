# Constats de relecture WP05 (Wave), commit 08a46341

## Bloquants
1. `searchSessions` (wave-adapter.ts, ~l.206) ne filtre pas sur `client_reference === reference`. Conséquences :
   - `initiate` après délai/5xx/429 rend la première session `open` renvoyée, même d'une autre recharge
     (le payeur serait redirigé vers la session d'un autre montant/recharge) ;
   - `getStatus` par recherche prend `found[0]` sans contrôle ; `cancel` par recherche peut expirer la session
     d'une autre recharge (aucun contrôle aval pour cancel).
   Correction : ne garder que les sessions dont `client_reference` égale la référence demandée ; dans `initiate`,
   exiger aussi `amount` et `currency` égaux à la demande ; test + mutation (retirer le filtre -> test rouge).
2. Extension « recherche aussi sur 5xx/429 à la création » (l.171-177) sans aucun test : seul `hangCreate` est
   couvert. Ajouter des tests 500 et 429 (une seule création, recherche, session rendue ; aucune session -> erreur)
   et leur mutation.

## Mineurs
- `getStatus` par `providerPaymentRef` ne contrôle pas que `session.id` correspond (défense en profondeur).
- `readStatement` : aucune borne sur le nombre de jours de la période (100 pages/jour seulement).
- Relevé : devise non contrôlée (XOF) ; sans effet tant que le rapprochement compare.

## Conformes (vérifié sur docs.wave.com le 26/11/2026)
Chemins, méthode, Bearer, corps de création ; signature webhook `t=,v1=` sur t+corps sans séparateur, plusieurs v1,
5 min ; signature des requêtes t+corps (GET corps vide, doc silencieuse sur chemin : à confirmer à l'essai) ;
search `{result:[…]}` ; expire ; transactions `items`/`page_info`/`after` ; borne 100 pages ; point Stripe refusé ;
entrée inconnue refusée ; montant décimal -> BODY_MALFORMED ; `payment_status` exigé ; aucun secret dans erreurs
(code Wave seul, journal sans en-tête) ; création `idempotent:false` ; aucun réseau externe (faux serveur local).
Tests relancés : test/unit/psp + architecture.spec.ts = 9 suites, 228 tests verts.
