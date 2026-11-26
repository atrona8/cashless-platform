---
affected_files: []
cycle_number: 3
mission_slug: routes-backoffice-01M86KT6
reproduction_command:
reviewed_at: '2026-11-26T02:09:32Z'
reviewer_agent: claude
wp_id: WP11
---

# WP11, cycle 3 : correctif d'intégration issu de la batterie de l'orchestrateur (26/11)

Batterie complète sur la lane k (`cashless_test`, suites relancées une à une pour écarter les interférences) :
trois défauts réels, causés par la mission 11b, non vus par les lots (qui ne lancent que leurs suites).

1. RÉGRESSION (argent) : `permission denied for table anomaly` (42501) dans cash-due.spec.ts (5),
   release-chaining.spec.ts (4), refunds/journey.spec.ts (1), topups/cash-desk-guard.spec.ts (1),
   media/cash-due-after-replace.spec.ts (1). Cause : D4 (WP01) a retiré UPDATE sur `anomaly` à `cashless_app`, or
   `apps/api/src/media/lifecycle/cash-due.service.ts:57` fait `SELECT … FROM anomaly … FOR UPDATE` (un verrou de ligne
   exige le droit UPDATE). Correctif attendu : retirer `FOR UPDATE` de cette lecture SANS rendre aucun droit (D4 reste).
   Justifier dans un commentaire : `lockCounterMedia` prend déjà le verrou du bracelet, et `refund_cash_due` (SECURITY
   DEFINER) reprend le verrou du bracelet puis verrouille et re-somme les anomalies OPEN elle-même. Vérifier que le
   seuil de seconde personne est bien contrôlé par la base (sinon le dire : écart à soumettre au porteur, ne rien
   coder de plus). Chercher tout autre `FOR UPDATE`/`FOR SHARE`/`UPDATE` sur `anomaly` côté API (aucun attendu).
   Test qui échoue si un verrou ou une écriture directe sur `anomaly` revient dans l'API (garde d'architecture ou
   test de droits), avec mutation.
2. Balayage d'isolement de la mission 5b (`end-to-end/payment-isolation.spec.ts:466`) : `getSale` et
   `listEventSales` déclarés sans cas. Corriger le filtre d'opérations du balayage 5b (les opérations de la 11b sont
   couvertes par `backoffice-isolation`), sans affaiblir le contrôle « chaque opération de la mission 5b a un cas ».
3. Balayage d'isolement des routes de configuration (`end-to-end/configuration-isolation.spec.ts`) : 4 échecs,
   `TypeError: bodies[route.operationId] is not a function` — opérations de la 11b ramassées par ce balayage. Même
   principe que 2.
Ensuite : relancer, sur `cashless_wp11` remise à zéro, les 8 suites citées + architecture, production-guard,
contracts, consignation, backoffice-isolation, x-roles-matrix (sans SKIP_LATENCY pour cette dernière).
Consigner le correctif dans preuves.md (et ADR-235 si utile : D4 tenu, verrou redondant retiré).
