# Compte rendu du lot WP12 (Annulation) — implémenteur (reprise)

Lane : lane-l, commit `1de01c23`. Base de test : cashless_wp12 (supprimée en fin de lot). T055 à T060 marquées done.

## Reprise du travail non commité
Examiné et gardé : service, contrôleur, DTO, module, `sale-reversal-action.ts`, `device-onsite-approval.ts`, factorisation
dans `onsite-approval.ts` (`verifyOnsiteApproval` et `recordApprovalUse` partagées par la garde personne et la variante
terminal ; garde existante inchangée, `onsite.spec.ts` vert sans retouche). Corrigé ou ajouté par moi : `ReversalsModule`
(imports `ConfigResolverModule`, provider `DeviceOnsiteApprovalGuard` : le module ne démarrait pas), DTO ramené à `422`
pour tout corps invalide (les aides génériques rendaient `400`, absent du contrat), `x-process: public`, tous les tests.

## Écarts au plan
- Chemin : `apps/api/src/reversals/` au lieu de `payments/` (prévu par le prompt du lot), sans effet de sécurité.
- Point `SALE_REVERSAL` sans route : levé par ADR-129 (section dédiée ci-dessous).
- Refus du registre : l'annulation n'a aucun effet durable de refus (pas d'anomalie ni de consignation hors transaction),
  donc le cas « erreur du registre empêche l'effet durable » des reports WP11 ne s'applique pas ; l'erreur du registre
  remplace l'erreur d'origine (comme `createPayment`). Pas de test d'injection de panne du registre (non couvert).

## Retouches hors carte (justifiées)
- `apps/api/src/app.module.ts` : import de `ReversalsModule` (autorisé par le prompt, 2 lignes).
- `apps/api/src/approval/approval.service.ts` : `exercisedRole(…, requiredRoles(definition), …)` (arbitrage ADR-122, rôle liste).
- `packages/contracts/openapi.yaml` : `x-process: public` sur `reversePayment` (autorisé). La description contient déjà
  l'ordre terminal puis vendeur puis fenêtre (report WP01), prouvé par le test « ADR-123 ».
- Le garde Spec Kitty émet ces 3 avertissements ACTIVE_WP_SCOPE_VIOLATION (non bloquants).

## Points soumis au porteur
Aucun affaiblissement codé. Droit plus large `ORGANIZER_ADMIN` : déjà accepté (ADR-122), borné par test.
Fichiers à faire relire par une personne : `apps/api/src/approval/onsite/` (surtout `onsite-approval.ts` refactoré et
`device-onsite-approval.ts`), `apps/api/src/reversals/reversal.service.ts`, `sale-reversal-action.ts`.

## Critères et preuves (commande : `npx jest --runInBand <fichier>` avec toutes les DATABASE_URL_* sur cashless_wp12)
- reversal-vendor.spec.ts (18 verts) : FR-016 réussite (REVERSAL lié, solde rendu, attribution, numéro ACCEPTED, contenu
  du registre) ; rejeu de clé ; 409 ALREADY_REVERSED + numéro REJECTED ; autre vendeur/autre terminal 422 ; hors
  fenêtre 409 vs autre vendeur 422 (ADR-123) ; A5 (`recorded_at`) ; terminal suspendu ; A8 ; `<serial>` étranger ; vente
  inconnue 404 ; session absente 409 ; session fermée pendant l'attente du verrou ; ordre des verrous terminal puis
  session ; suspension entre garde et verrou ; NFR-005 : 20 annulations simultanées donnent exactement 1.
- reversal-supervisor.spec.ts (19 verts) : FR-017 succès hors fenêtre et autre vendeur (valideur, attribution, jeton
  consommé avec appelant terminal) ; terminal d'un autre événement refusé (422) ; portée = événement de la vente ; tableau
  des refus rejoué (autre act, corps/session d'un autre corps, expiré, sans rôle, autre prestataire, désactivé, SUPERVISOR
  d'un autre événement, autre clé de signature, jeton d'accès, sujet inconnu, jeton d'une autre vente) : 403
  APPROVAL_INVALID, aucune annulation ni consommation, numéro REJECTED ; vente inconnue 404 ; jeton rejoué avec autre clé ;
  3 requêtes simultanées avec le même jeton donnent une seule ; jeton non consommé si annulation refusée ; session fermée.
- reversal-backoffice.spec.ts (7 verts) : demande puis approbation, REVERSAL BACKOFFICE auteur différent du valideur ;
  ORGANIZER_ADMIN ; même personne refusée ; CASHIER/OPERATOR_ADMIN refusés ; charge utile ; vente déjà annulée donne FAILED
  (ALREADY_REVERSED) ; `assert_reversible` BACKOFFICE refuse en base (CL036).
- test/unit/reversals/reversal-request.spec.ts, action-registry.spec.ts : corps, contenu du registre, traduction par nom
  de contrainte (un autre 23505 jamais en ALREADY_REVERSED).
- device-auth-matrix.spec.ts (11 verts) avec `reversals.cases.ts` : succès 201 puis tous les refus de preuve.
- Régression : approval, payments, media/blacklist (14 suites, 128 verts) ; transverse + unit (58 suites, 1287 verts) ;
  `tsc --noEmit`, eslint et prettier propres ; `contracts check` ok.
- Non rejoués : pgTAP, `npm test` complet (réservés à l'orchestrateur ; aucune migration modifiée).

## ADR-129 : chemin de la personne de `reversePayment` (second commit)
- Le `403 APPROVAL_REQUIRED` (`DeviceCallerOnlyGuard`) est retiré. Sans marqueur de terminal, un SUPERVISOR ou
  ORGANIZER_ADMIN (`TenantAccess.actor`, 403 pour tout autre rôle) crée la demande par `SaleReversalActions.request`
  (rôle contrôlé sur l'événement de la VENTE par `ApprovalService.request`, 403 sinon ; vente inconnue 404) et reçoit
  `202` + `Location` + `ApprovalRequest` (contrat vérifié par `contractViolations('ApprovalRequest')`). Aucune ligne de
  grand livre avant l'approbation ; l'approbation par une seconde personne (`/approval-requests/{id}/approve`) exécute
  l'annulation (BACKOFFICE, auteur différent du valideur, contrôlé par la base).
- Clé : `Idempotency-Key` UUID libre pour la personne (422 avant réservation sinon), scope `bo:` ; terminal inchangé
  (`<serial>:<seq>`, scope `device:`). Corps de la personne : `reason`, `comment`, `supervisor_pin_proof` refusé.
- Retouche hors carte supplémentaire : `apps/api/src/idempotency/idempotency.interceptor.ts` (le contrôle `deviceSeq`
  ne s'applique que si un terminal est authentifié ; sans terminal, la clé doit être un UUID). Terminal seul : sans
  effet (la garde garantit le terminal). Aucun contrôle retiré ; à faire relire. `device-onsite-approval.ts` : la garde
  du jeton laisse passer sans terminal (la personne n'a pas de jeton sur place).
- Tests : `reversal-backoffice.spec.ts` (13 verts) : 202 conforme, Location, rien au grand livre, rejeu de clé,
  ORGANIZER_ADMIN, même personne refusée puis seconde personne exécute (HTTP), CASHIER/OPERATOR_ADMIN/SUPERVISOR d'un autre
  événement 403, vente inconnue 404, clé non UUID/absente, pin_proof, raison hors liste. Régression : 71 suites, 1431 verts
  (reversals, unit, matrice, approval, payments, transverse, blacklist). `reversals.cases.ts` : inchangé (le cas
  terminal suffit). tsc, eslint, prettier propres. Base cashless_wp12 recréée puis supprimée.

## Correctifs de batterie (cashless_test, 6ee53903)
- `x-process: public` sur `reversePayment` RETIRÉ : rien ne l'exige (le prompt le listait comme retouche autorisée par
  analogie avec WP11 ; seul `media-isolation.spec.ts` le lit et il compte les opérations qui le portent : 41 -> 42).
  La retouche hors carte `openapi.yaml` disparaît du lot. Si l'orchestrateur veut l'étiquette, il faudra ajouter le cas et
  porter le compte à 42 dans `media-isolation.spec.ts` (comme WP11).
- `reversal-backoffice.spec.ts` : comptages globaux (`posting`, `REVERSAL` de toute la base) remplacés par une empreinte
  bornée à la vente (`reverses_id`) et au portefeuille du festivalier (lignes et solde). Les autres suites du lot n'ont
  aucun comptage global (toutes les lectures sont par `device_id`, `transaction_id`, `jti` ou portefeuille).
- Rejoué sur cashless_wp12 (recréée puis supprimée) : reversals (3 suites + unitaire), media-isolation, matrice : 67 verts.
