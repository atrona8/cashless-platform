# Notes d'architecture — mission identite-enrolement-terminaux-01M52R6H

> État : **plan finalisé** le 19/10/2026. Rédigé d'après `plan.md` et `research.md` ; à recaler après review.

## Composant(s) introduit(s) ou modifié(s) par cette mission
- **API publique et processus des clés de bracelet** (`apps/api`, NestJS 11) : écoute en HTTPS (TLS 1.3), certificat
  client demandé et vérifié dans le processus (pas d'en-tête de répartiteur) ; identité réelle du terminal derrière le
  port `DeviceIdentityPort` de la mission 4.
- **Autorité des terminaux** (`DeviceCaPort`) et **signataire des jetons** (`TokenSignerPort`) : ports avec faux pour
  les tests ; adaptateurs réels après OP-N11 ; la garde refuse un faux en production.
- **Vérificateurs d'attestation** Android (Key Attestation, liste de révocation Google en cache) et iOS (App Attest).
- **Base de données** : migrations `0021` à `0025` (S5 : codes, jetons de rafraîchissement, nonces, historique des
  statuts, essais ; fonctions d'enrôlement et de statut ; `serial` unique par prestataire) ; `post-roles.sql`
  (`EXECUTE` rôle par rôle, `TEMPORARY` retiré, écritures directes de l'API sur les terminaux retirées) ; générateur
  `gen_tests.py` (OP-N44).
- **Contrat** (`openapi.yaml`) : trois preuves exigées ensemble, en-têtes de signature, six routes back-office.

## Décisions d'architecture prises dans cette mission
| Décision | Justification | Alternative envisagée |
|---|---|---|
| Trois preuves ensemble sur chaque requête de terminal (ADR-107) | Aucune preuve volée seule ne suffit ; condition de levée d'OP-N42 | Jeton ou mTLS (§10.3) |
| mTLS vérifié dans les processus, répartiteur en passage TCP | Aucun en-tête de répartiteur cru | Terminaison au répartiteur |
| Signature des requêtes : profil restreint de RFC 9421, nonces en base, heure de la base | Format normalisé pour l'app ; rejeu refusé sur toutes les instances | Format maison ; cache en mémoire |
| Révocation sans CRL ni OCSP : terminal et famille de jetons relus en base à chaque requête | Effet immédiat | Liste de révocation |
| Android 12 minimum ; deux chaînes d'attestation | Clé d'accord matérielle et attestée | Android 9–11 en QR seulement |
| iOS : clés liées à l'instance App Attest (OP-N64, ADR-106) | Seule preuve offerte par la plateforme | Assertion App Attest sur chaque requête |
| Grâce de 60 s au rafraîchissement (OP-N65, ADR-108) | Réponse perdue sur un réseau de festival | Mode strict |
| `serial` unique par prestataire (ADR-109) | Cloisonnement entre prestataires | Index global du schéma de référence |

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions d'architecture notables » et domaine « Terminaux ».

## Nécessaire pour cette mission ? Oui — la mission change le transport (TLS dans les processus), ajoute deux ports et touche les droits de la base.
## Complet ? Oui au stade du plan — à recaler après review.
## Validé par : Agent, par délégation du porteur, le 19/10/2026
