# Notes d'architecture : mission adaptateurs-fournisseurs-choisis-01M8BXJA

> État : **plan finalisé le 26/11/2026 : PLANIFIÉ, rien n'est codé**. Aucun conteneur nouveau ; aucun diagramme dans ce fichier (routage : prose et tableau seuls).

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **API centrale** (NestJS, TypeScript) : adaptateurs réels `psp/wave/`, `psp/paydunya/`, `psp/stripe/` derrière le port `PspAdapter` révisé (deux verdicts : notification ou signal) ; `psp/aws/secrets-manager-store.ts` (port `PspSecretStore`) ; `kms/aws-kms.ts` (cinq ports de clés) ; `sealing/s3-seal-copy.ts` (`SealExternalCopy`) ; client HTTP sortant commun (`psp/http/psp-http.ts`, axios) ; `external-services/production-enabled.ts` (liste unique, vide au départ) et `external-services/trial/` (commandes d'essai). Modifiés : vérifieur et réception des notifications (corps en formulaire pour PayDunya, signal sans effet), travailleur d'interrogation (relecture prioritaire des recharges ayant reçu un signal), garde de production (adaptateur « non essayé » refusé comme un faux).
- **Base** (PostgreSQL 17) : aucune migration prévue (le signal réutilise `psp_event` et l'état `PENDING` ; à vérifier au lot sur `psp_poll_candidates`, sinon migration nouvelle présentée au porteur).
- **Contrat** (`openapi.yaml`, `contract-baseline.json`) : ajout rétrocompatible à `receivePspWebhook` (D9) : `application/x-www-form-urlencoded` et description par fournisseur ; présenté au porteur avant codage, accepté le 26/11/2026.
- **Dépendances nouvelles** (C-004, `docs/08-pile-logicielle.md`) : `axios` 1.21.1, `@aws-sdk/client-kms`, `@aws-sdk/client-secrets-manager`, `@aws-sdk/client-s3` 3.1172.0, versions exactes, installées avec `--ignore-scripts`.
- **Systèmes externes** (voir `docs/03-context-diagram.md`) : Wave, PayDunya, Stripe, AWS Secrets Manager, KMS, S3 Object Lock, passant de « faux » à « adaptateur conforme, à essayer » ; Orange Money inchangé.

## Décisions d'architecture prises dans cette mission

| Décision | Justification | Alternative envisagée |
|---|---|---|
| D1 : Orange Money hors périmètre | Documentation technique derrière un compte Sonatel | Écrire l'adaptateur sans la documentation |
| D2 : notification PayDunya = signal ; crédit après `checkout-invoice/confirm/{token}` | PayDunya ne signe pas son contenu ; preuve d'origine fixe (`sha512` de la clé maître) | Croire la notification (écarté par le porteur) |
| D3, D6 : refus en production jusqu'à l'essai réel ; levée par une liste dans le code, modifiée par une PR relue | Preuve de l'essai tracée par la revue | Réglage d'environnement (modifiable sans relecture) |
| D4 : Stripe inclus, éligibilité Sénégal à vérifier par le porteur | Carte internationale | Reporter Stripe |
| D5 : remboursement d'un paiement non crédité hors plateforme (OP-N82) | Décision du 26/11/2026 | Le servir par la plateforme |
| D7 : carte PayDunya, règle 3-D Secure (ADR-77) gardée ; sans preuve, reçue non créditée | Aucune preuve 3-D Secure dans la confirmation PayDunya ; réexamen après l'essai | Assouplir la règle |
| D8 : rétention des copies de scellement 10 ans, mode conformité, réglable | Durée de conservation comptable | Mode gouvernance |
| D9 : ajout rétrocompatible à `receivePspWebhook` | Corps en formulaire de PayDunya | Convertir le corps avant l'API |
| Relecture du signal hors de la réception, par le travailleur d'interrogation existant, sans migration | Réponse < 2 s au contrat, Wave exige 2xx sous 5 s, crédit par le chemin unique (NFR-005 hérité) | Appel `getStatus` pendant la réception |
| Serveurs HTTP locaux rejouant les réponses documentées, clients AWS visant ces serveurs | NFR-001 : aucun réseau en test, sérialisation réelle du SDK prouvée | Moquer `client.send` |

## Écarts de sécurité à consigner par la mission (règle du porteur du 13/10/2026)

| Écart | Sens | À consigner (par la mission, pas par cet addendum) |
|---|---|---|
| Preuve d'origine PayDunya fixe, sans corps signé ni horodatage (D2) | affaiblit, borné : un signal forgé ne déclenche qu'une relecture authentifiée, au plus une par recharge et par minute | OP, ADR, test de borne (un signal valide suivi de « pending » ou d'un montant différent ne crédite pas), report dans PROMPTS et PRD |
| Carte PayDunya non créditée faute de preuve 3-D Secure (D7) | renforce | consigné à l'implémentation |
| Faux ou adaptateur gardé en production plus longtemps que prévu | aucun : liste vide (D6) | test de preuve de refus, `COVERAGE` de `production-refusals.spec.ts` |

À faire relire par une personne (règle 4) : `psp/paydunya/`, `psp/aws/secrets-manager-store.ts`, `kms/aws-kms.ts`, `sealing/s3-seal-copy.ts`, `external-services/production-enabled.ts`, vérifieur de notifications.

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table « Détail par mission » et « Décisions d'architecture notables ». Vue C4 inchangée (aucun conteneur nouveau). Contribue aussi à `docs/03-context-diagram.md` (état des systèmes externes), `docs/08-pile-logicielle.md` (quatre dépendances) et `docs/SERVICES-EXTERNES.md`.

## Nécessaire pour cette mission ? Oui : décisions D1 à D9, dépendances nouvelles, écart de sécurité et garde de production à tracer, même sans conteneur nouveau (proposition de l'Agent, en attente de confirmation du porteur).
## Complet ? Oui pour le plan (26/11/2026) : composants, décisions, écarts à consigner, fichiers à relire ; à recaler à la review sur le code livré (proposition de l'Agent, en attente de confirmation du porteur).
## Validé par : proposition de l'Agent le 26/11/2026, en attente de confirmation du porteur.
