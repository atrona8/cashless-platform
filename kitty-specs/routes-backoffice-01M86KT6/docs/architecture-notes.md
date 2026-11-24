# Notes d'architecture : mission routes-backoffice-01M86KT6

> État : **plan finalisé le 24/11/2026, rien n'est codé.** Aucun conteneur nouveau. **Décisions D4, D7, D9, D10 et ajouts au contrat A1 à A6 : à valider par le porteur avant `/spec-kitty.tasks`** ;
> D1 à D3 décidées par le porteur le 24/11/2026, D5, D6, D8 acceptées avec l'alignement technique.

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **API centrale** (NestJS, TypeScript) : quatre modules nouveaux `staff-profile/`, `sales/`, `anomalies/`, `search/`, plus `devices/phone-models/` ; modifications de l'enrôlement et du signal de vie (`device_model` facultatif) et des lectures de terminaux (`nfc_level`). Réutilisent `identity/roles.guard.ts`, `scope-resolver.ts`, `payments/payment-read.service.ts` (jointure du commerçant par participation), `ClaimHasher`, `audit/audit.service.ts` (cinq actions nouvelles : `ANOMALY_CLASSIFIED`, `PHONE_MODEL_UPSERTED`, `PHONE_MODEL_DELETED`, `STAFF_CUSTOMER_SEARCH`, `STAFF_CUSTOMER_SEARCH_RATE_LIMITED`).
- **Base** (PostgreSQL 17) : migration prévue `0101_backoffice_reads.sql` : colonnes de classement sur `anomaly`, fonction `classify_anomaly` (`SECURITY DEFINER`), table `phone_model` (plateforme, sans `operator_id`), colonnes `device.manufacturer` et `device.model`, nouvelles versions des fonctions d'enrôlement et de signal de vie, vues `security_invoker` `sale_overview` et `anomaly_overview`, index de lecture des ventes ; pgTAP.
- **Contrat** (`openapi.yaml`, `contract-baseline.json`, script de production de `x-roles`) : environ 11 opérations nouvelles, une extension sur 227 opérations, quatre ajouts facultatifs à des schémas existants ; tous soumis au porteur avant codage (C-001).
- **Documentation normative** : `SPECIFICATION.md` §12.2 (23 types au lieu de 21, le schéma prime, §0.3) et §15, une ADR, OP-N170 levé, points ouverts nouveaux (résolutions d'anomalie qui écrivent de l'argent, reportées).

## Décisions d'architecture prises dans cette mission

| Décision | Justification | Alternative envisagée |
|---|---|---|
| D1 (porteur) : 10 types d'anomalie classables, tenus dans la base | Aucun ne laisse d'argent en attente | Sans les signaux de sécurité du bracelet ; deux personnes pour ces signaux |
| D2 (porteur, exception à C-001 pour deux requêtes) : modèle du terminal déclaré par l'app | Pas de saisie manuelle ; informatif | Saisie par un administrateur ; les deux |
| D3 (porteur) : `x-roles` fidélisé par une matrice échantillon (un appel permis, un refusé par opération) | Coût borné | Matrice complète (plus de 2 000 appels) ; registre unique |
| D4 (**à valider**, renforcement) : classement par `classify_anomaly`, droit `UPDATE (status, resolution_tx_id)` retiré à `cashless_app` si aucun usage direct (sinon déclencheur de garde) | La liste D1 doit être tenue par la base ; le droit actuel permettrait de clore une anomalie d'argent depuis l'application | Contrôle dans l'API seule |
| D5 (accepté) : lectures par vues `security_invoker` sous RLS, curseur opaque, 200 maximum | NFR-003, NFR-005 | Droits de lecture nouveaux |
| D6 (accepté) : portée du commerçant dans la requête SQL | Aucun filtrage après lecture | — |
| D7 (**à valider**) : `POST /search/customers`, audit sans le numéro (ni empreinte) | Aucun secret nouveau en production | Audit par empreinte du numéro |
| D8 (accepté) : 20 recherches par minute et par personne, compté sur l'audit | Mécanique existante, multi-instance | Compteur en mémoire |
| D9 (**à valider**) : `phone_model` table de plateforme, écrite par la connexion de plateforme et une fonction | Liste unique pour tous les prestataires | Table par prestataire |
| D10 (**à valider**) : aucun code d'erreur nouveau (`reason` porte le motif) | Précédent de la 9c, contrat stable | Codes nouveaux |

## Dette de sécurité et fichiers à faire relire

Aucun écart qui affaiblit la sécurité n'est prévu ; D4 est un renforcement à consigner. Écarts à soumettre au porteur avant d'être codés (règle 1 de `CLAUDE.md`) : tout changement qui élargirait un droit ou retarderait un contrôle. À faire relire par une personne à l'implémentation (règle 4) : migration `0101` (droits, fonctions `SECURITY DEFINER`), recherche par numéro (masque, audit, débit), `x-roles` et la table relue à la main.

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table « Détail par mission » et « Décisions notables ». Vue C4 inchangée (aucun conteneur nouveau).

## Nécessaire pour cette mission ? Oui : décisions D1 à D10, migration et contrat à tracer, même sans conteneur nouveau (réponse proposée par l'Agent le 24/11/2026, en attente du porteur).
## Complet ? Oui pour le plan ; à recaler sur le code réel à la review (noms définitifs des opérations dans `interfaces.md` aux tâches, numéro de migration, éventuel `0102`) (réponse proposée par l'Agent le 24/11/2026, en attente du porteur).
## Validé par : réponse proposée par l'Agent le 24/11/2026, en attente du porteur.
