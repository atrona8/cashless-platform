# Notes d'architecture : mission routes-backoffice-01M86KT6

> État : **relue le 25/11/2026 (11 lots sur 11 approuvés ; WP11 au cycle 2, `e32df355`, code réuni dans la lane k), non acceptée, non fusionnée**.
> Aucun conteneur nouveau. Recalé sur le code (migrations `0101` et `0102`, modules de l'API) et sur ADR-235 et ADR-236. Décisions D1 à D10 validées par le porteur les 24 et 25/11/2026.

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **API centrale** (NestJS, TypeScript) : quatre modules nouveaux `staff-profile/`, `sales/`, `anomalies/`, `search/`, plus `devices/phone-models/` ; modifications de l'enrôlement et du signal de vie (`device_model` facultatif) et des lectures de terminaux (`nfc_level`). Réutilisent `identity/roles.guard.ts`, `scope-resolver.ts`, `payments/payment-read.service.ts` (jointure du commerçant par participation), `ClaimHasher`, `audit/audit.service.ts` (cinq actions nouvelles : `ANOMALY_CLASSIFIED`, `PHONE_MODEL_UPSERTED`, `PHONE_MODEL_DELETED`, `STAFF_CUSTOMER_SEARCH`, `STAFF_CUSTOMER_SEARCH_RATE_LIMITED`).
- **Base** (PostgreSQL 17) : migrations livrées `0101_anomaly_classification_phone_models.sql` (colonnes de classement sur `anomaly`, fonction `classify_anomaly` (`SECURITY DEFINER`), table `phone_model` (plateforme, sans `operator_id`), colonnes `device.manufacturer` et `device.model`, fonctions `upsert_phone_model`, `delete_phone_model`, `set_device_model`, index d'audit) et `0102_backoffice_read_views.sql` (vues `security_invoker` `sale_overview` et `anomaly_overview`, index de lecture des ventes) ; droits dans `post-roles.sql` §15 et §16 ; pgTAP.
- **Contrat** (`openapi.yaml`, `contract-baseline.json`, script de production de `x-roles`) : 11 opérations nouvelles, `x-roles` sur 226 opérations (310 différences admises, 0 refusée), quatre ajouts facultatifs à des schémas existants ; tous soumis au porteur avant codage (C-001).
- **Documentation normative** : `SPECIFICATION.md` §12.2 (23 types au lieu de 21, le schéma prime, §0.3) et §15, ADR-235 et ADR-236, OP-N170 levé, OP-N185 à OP-N198 (résolutions d'anomalie qui écrivent de l'argent, reportées à la mission 11c).

## Décisions d'architecture prises dans cette mission

| Décision | Justification | Alternative envisagée |
|---|---|---|
| D1 (porteur) : 10 types d'anomalie classables, tenus dans la base | Aucun ne laisse d'argent en attente | Sans les signaux de sécurité du bracelet ; deux personnes pour ces signaux |
| D2 (porteur, exception à C-001 pour deux requêtes) : modèle du terminal déclaré par l'app | Pas de saisie manuelle ; informatif | Saisie par un administrateur ; les deux |
| D3 (porteur) : `x-roles` fidélisé par une matrice échantillon (un appel permis, un refusé par opération) | Coût borné | Matrice complète (plus de 2 000 appels) ; registre unique |
| D4 (validé, renforcement, livré) : classement par `classify_anomaly`, droit `UPDATE (status, resolution_tx_id)` retiré à `cashless_app` si aucun usage direct (sinon déclencheur de garde) | La liste D1 doit être tenue par la base ; le droit actuel permettrait de clore une anomalie d'argent depuis l'application | Contrôle dans l'API seule |
| D5 (accepté) : lectures par vues `security_invoker` sous RLS, curseur opaque, 200 maximum | NFR-003, NFR-005 | Droits de lecture nouveaux |
| D6 (accepté) : portée du commerçant dans la requête SQL | Aucun filtrage après lecture | — |
| D7 (validé, livré) : `POST /search/customers`, audit sans le numéro (ni empreinte) | Aucun secret nouveau en production | Audit par empreinte du numéro |
| D8 (accepté) : 20 recherches par minute et par personne, compté sur l'audit | Mécanique existante, multi-instance | Compteur en mémoire |
| D9 (validé, livré) : `phone_model` table de plateforme, écrite par la connexion de plateforme et une fonction | Liste unique pour tous les prestataires | Table par prestataire |
| D10 (validé, livré) : aucun code d'erreur nouveau (`reason` porte le motif) | Précédent de la 9c, contrat stable | Codes nouveaux |

## Écarts entre le plan et le code livré

| Écart | Sens pour la sécurité | Consigné |
|---|---|---|
| Deux migrations (`0101`, `0102`) ; `set_device_model` sous `SAVEPOINT` au lieu de nouvelles versions des fonctions d'enrôlement | neutre | ADR-235 |
| Droits nouveaux de `cashless_app` : `SELECT` sur `sale_overview`, `anomaly_overview`, `phone_model`, `EXECUTE` sur 4 fonctions (« aucun droit nouveau » du plan caduc) | élargit, mais décidé (D5, D9) et nommé | ADR-235, confirmé par le porteur le 25/11/2026 |
| `PLATFORM_ADMIN` retiré de la recherche par numéro ; trois dérives `x-roles` alignées sur le code | renforce | ADR-235, ADR-236 |
| Limites acceptées : modèle déclaré non vérifié (OP-N186), matrice par échantillon (OP-N187), huit opérations sans `x-roles` (OP-N188), débit par personne (OP-N189), niveau NFC sans historique (OP-N190), nom de plateforme fixe (OP-N191), ventes non attribuées invisibles (OP-N192), planificateur (OP-N193), latences non mesurées (OP-N195), auteur de `classify_anomaly` non vérifié par la base (OP-N196) | dette nommée ; **OP-N185 bloque la production** (résolutions d'argent non livrées) | ADR-236, `POINTS_OUVERTS.md` §15 |

À faire relire par une personne (règle 4) : `post-roles.sql` §15 et §16, migrations `0101` et `0102`, `search-scope.ts`, `search-rate-limit.ts`, `search.service.ts`, `anomalies.service.ts`, `phone-models.service.ts`, `tools/contract-stability/x-roles/roles.json`.

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table « Détail par mission » et « Décisions notables ». Vue C4 inchangée (aucun conteneur nouveau).

## Nécessaire pour cette mission ? Oui : décisions D1 à D10, migration et contrat à tracer, même sans conteneur nouveau (réponse proposée par l'Agent le 24/11/2026, validée par le porteur le 24/11/2026).
## Complet ? Oui, recalé à la review (25/11/2026) : migrations `0101` et `0102`, droits nouveaux, écarts listés (réponse proposée par l'Agent le 25/11/2026, en attente de confirmation du porteur).
## Validé par : plan validé par le porteur le 24/11/2026 ; recalage post-review proposé par l'Agent le 25/11/2026, en attente de confirmation du porteur.
