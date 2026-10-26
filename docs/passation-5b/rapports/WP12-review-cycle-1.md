# Relecture WP12 (Annulation), cycle 1 — VERDICT : APPROUVÉ

Commits 1de01c23, 6ee53903, d87ec992 (lane-l). Base de relecture cashless_wp12r (supprimée).
Rejeu : reversals (3 suites + unitaire), approval (unit + intégration), cash-due, idempotency, matrice des preuves :
90+ tests verts ; tsc propre. Aucun constat bloquant ni majeur.

## Points de sécurité examinés
1. Intercepteur d'idempotence : seules deux routes portent `deviceSeq` : `POST /payments` (`@DeviceAuth`, la garde pose
   `req.device` ou refuse) et `reversePayment` (garde exclusive). Aucune route réservée aux terminaux n'est donc
   atteignable sans terminal. Ordre garde -> intercepteur tenu (les gardes précèdent les intercepteurs). Mutation
   (contrôle de terminal forcé) : 5 tests échouent. OK.
2. `DeviceOnsiteApprovalGuard` sans terminal : pose `none`, aucun jeton lu ; le chemin personne ne peut ni lever les
   contrôles vendeur/fenêtre ni exécuter sans seconde personne (il ne fait que créer une demande, rien au grand
   livre). Avec terminal, la vérification est la MÊME fonction que la garde existante. OK.
3. Chemin 202 : rôles `SUPERVISOR`/`ORGANIZER_ADMIN`, portée = événement de la vente lu en base (jamais du corps),
   `assert_reversible` BACKOFFICE relit demande APPROVED, auteur != valideur, deux rôles actifs. Mutation (rôle
   élargi à OPERATOR_ADMIN) : 2 tests échouent. OK.
4. Jeton sur place : `act_hash` (méthode, chemin avec l'id de vente, corps JCS) ; mutations « sans act_hash » (3 échecs),
   « sans act » (1), « sans rôle » (3) détectées. Usage unique par clé primaire `jti` (+ test de 3 requêtes
   simultanées), consommé avant `assert_reversible` qui exige la ligne `approval_token_use` (appelant, session, vente).
   Fenêtre en dernier dans la base (CL040 après CL036), conforme ADR-123.
5. Garde de session et reports WP09/WP11 : conformes (verrous terminal -> session, époque, heure bornée, numéro dans la
   même transaction, refus définitif rangé hors transaction).
6. Refactor `onsite-approval.ts` : sans régression (approval, cash-due, idempotency verts, garde existante inchangée).

## Constats
- M1 (mineur) `idempotency.interceptor.ts` : le chemin « personne » est déduit de l'ABSENCE de `req.device`. Sûr
  aujourd'hui, mais un futur `deviceSeq` posé sur une route sans garde de terminal accepterait un UUID. Option
  explicite recommandée (ex. `deviceSeq: 'or-person'`) pour échouer fermé par défaut. À consigner, non bloquant.
- M2 (mineur, information) : la mutation `ON CONFLICT (jti) DO NOTHING` -> `ON CONFLICT DO NOTHING` est équivalente
  (jti clé primaire) ; aucun test à ajouter.
- Non rejouable ici : ordre fenêtre/vendeur/terminal en base (couvert par pgTAP, rejoué par l'orchestrateur : OK).

## À faire relire par une personne
`apps/api/src/approval/onsite/onsite-approval.ts` (refactor), `device-onsite-approval.ts`, `idempotency.interceptor.ts`,
`reversals/reversal.service.ts`, `sale-reversal-action.ts`. Cet avis ne vaut pas relecture indépendante.
