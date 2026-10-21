# Notes d'architecture — mission identite-enrolement-terminaux-01M52R6H

> État : **review terminée, acceptation en attente** (18/18 lots approuvés le 21/10/2026). Rédigé au plan le
> 19/10/2026, recalé le 21/10/2026 sur le code de la lane finale (`lane-r`).

## Composant(s) introduit(s) ou modifié(s) par cette mission
- **API publique et processus des clés de bracelet** (`apps/api`, NestJS 11) : HTTPS en TLS 1.3, certificat client
  demandé et vérifié dans le processus (`processes/bootstrap.ts`, `requestCert`) ; aucun en-tête de répartiteur cru.
- **Identité réelle du terminal** (`device-identity/real-device-identity.ts`, `request-signature.ts`,
  `device.guard.ts`, `nonce-store.ts`) derrière le port `DeviceIdentityPort` de la mission 4. Ordre : certificat,
  jeton, terminal et famille relus, empreintes, corps et signature (`@authority` dans `DEVICE_REQUEST_AUTHORITIES`),
  révoqué → `403` sans rien écrire, nonce, suspendu → `403` sauf configuration et présence.
- **Autorité des terminaux** (`device-ca/`, `DeviceCaPort`) et **signataire des jetons** (`device-tokens/`,
  `TokenSignerPort`) : faux seulement, refusés en production (dette OP-N73, ADR-119, levée en mission 7).
- **Vérificateurs d'attestation** (`attestation/`) : Android Key Attestation (liste de révocation Google en cache,
  `android.googleapis.com/attestation/status`) et iOS App Attest (racine Apple configurée, vérification locale).
- **Modules de routes** (`devices/`) : codes d'enrôlement, enrôlement, rafraîchissement, back-office des terminaux
  (`deviceScope`), configuration, battement de cœur ; tâche de purge des nonces et des essais.
- **Idempotence** (`idempotency/request-hash.ts`, `idempotency.interceptor.ts`) : empreinte à clé HMAC
  (`IDEMPOTENCY_HMAC_KEY`, OP-N54) sur le chemin concret et l'appelant (ADR-116).
- **Base de données** : migrations `0021` à `0027`, `0029`, `0030` (0028 libre) :
  0021 `search_path = public, pg_temp` (OP-N59) ; 0022 S5 (codes, jetons, historique, essais ; fonctions
  d'enrôlement et de statut ; `serial` unique par prestataire) ; 0023 nonces, rotation, garde de statut ;
  0024 et 0026 lecture d'une demande de rattachement (OP-N50, `consume_tap_for_claim` en SECURITY DEFINER) ;
  0025 retrait de clé lié à un travail (OP-N62) ; 0027 audit de tous les refus d'enrôlement (ADR-117) ;
  0029 `record_config_served` durci (ADR-118) ; 0030 limites d'enrôlement atomiques, /64 (ADR-117).
  `post-roles.sql` : `EXECUTE` rôle par rôle (OP-N44), `TEMPORARY` retiré, écritures directes de l'API sur les
  clés du terminal retirées (OP-N63). `migrate.ts` : verrou et droits rejoués dans la transaction (ADR-111).
- **Contrat** (`openapi.yaml`) : 136 chemins et 165 opérations (+5 chemins, +6 opérations) ; schémas `deviceMtls`,
  `deviceToken`, `deviceSignature` exigés ensemble, `staffBearer` sur 9 routes de guichet.
- **CI** (`.github/workflows/ledger-tests.yml`) : historique complet, `ignore-scripts`, `check:generated`, mesures en
  série.

## Décisions d'architecture prises dans cette mission
| Décision | Justification | Alternative envisagée |
|---|---|---|
| Trois preuves ensemble sur chaque requête de terminal (ADR-107) | Aucune preuve volée seule ne suffit ; levée d'OP-N42 | Jeton ou mTLS (§10.3) |
| mTLS vérifié dans les processus, répartiteur en passage TCP | Aucun en-tête de répartiteur cru | Terminaison au répartiteur |
| Signature des requêtes : profil restreint de RFC 9421, nonces en base, heure de la base ; autorités signées et listées (`DEVICE_REQUEST_AUTHORITIES`, obligatoire en production, ADR-113) | Rejeu refusé sur toutes les instances ; requête pour une autre autorité refusée | Format maison ; cache en mémoire |
| Révocation sans CRL ni OCSP : terminal et famille relus en base à chaque requête ; révoqué → `403 DEVICE_REVOKED` après preuves valides (ADR-115) | Effet immédiat ; seul le détenteur des clés apprend la révocation | Liste de révocation ; `401` |
| Android 12 minimum ; deux chaînes d'attestation ; `attestationApplicationId` lu dans la liste logicielle (ADR-110, OP-N67) | Clé d'accord matérielle et attestée | Android 9–11 en QR seulement |
| iOS : clés liées à l'instance App Attest (OP-N64, ADR-106) | Seule preuve offerte par la plateforme | Assertion sur chaque requête |
| Grâce de 60 s au rafraîchissement (OP-N65, ADR-108) | Réponse perdue sur un réseau de festival | Mode strict |
| `serial` unique par prestataire (ADR-109) | Cloisonnement entre prestataires | Index global du schéma de référence |
| Guichet : jeton de la personne dans `X-Staff-Authorization` (ADR-113) | Deux Bearer ne tiennent pas dans `Authorization` | Retirer le jeton d'appareil au guichet |
| Purges des nonces et des essais par l'API publique (ADR-114) | Pas de rôle de maintenance de plus ; fenêtre bornée par test | Rôle et connexion dédiés |
| Idempotence : chemin concret et appelant dans l'empreinte, `409` (ADR-116) | Plus de rejeu sur une autre ressource ni entre personnes | Modèle de route (contrat de la mission 1) |
| Enrôlement : audit de tous les refus, limites sur les refus seuls, atomiques, /64 (ADR-117) | Aucun oracle d'existence d'un code ; écritures bornées sur une route sans compte | Limites non atomiques, adresse complète |
| `record_config_served` refuse un terminal révoqué et une version d'un autre prestataire ou `PLATFORM` (ADR-118) | Défense en base, sans dépendre de la route | Garde dans la route seule |

## Écarts au plan (sens)
- Migrations 0026, 0027, 0029, 0030 en plus du plan (0021 à 0025) : renforcements.
- ADR-113 à ADR-119 pris pendant l'implémentation ; dettes levées : OP-N42, N44, N50, N54, N59, N62, N63, N70, N71.
- Droits plus larges acceptés et listés pour la revue : purges par `cashless_app` (ADR-114), famille non opposée à un
  terminal révoqué (ADR-115), écriture de `cashless_app` dans la chaîne d'audit de la plateforme (0027).
- Limites nouvelles : OP-N72 (pas de limite en amont de l'enrôlement, mission 13), OP-N73 (autorité et signataire
  en faux, mission 7).

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions d'architecture notables » et domaine « Terminaux ».

## Nécessaire pour cette mission ? Oui — la mission change le transport (TLS dans les processus), ajoute deux ports, l'identité réelle du terminal et touche les droits de la base.
## Complet ? Oui — recalé sur les migrations livrées (0021 à 0030), les ADR-113 à ADR-119 et les dettes ouvertes.
## Validé par : Agent, par délégation du porteur (21/10/2026)
