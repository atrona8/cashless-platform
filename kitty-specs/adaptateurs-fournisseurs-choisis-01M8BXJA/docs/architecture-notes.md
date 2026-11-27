# Notes d'architecture : mission adaptateurs-fournisseurs-choisis-01M8BXJA

> État : **review du 27/11/2026 : 13 lots sur 13 approuvés, recalé sur le code livré (lane m), non accepté, non fusionné**. Aucun conteneur nouveau ; aucun diagramme dans ce fichier (routage : prose et tableau seuls). **Rien n'a été essayé contre un vrai service ; `PRODUCTION_ENABLED_SERVICES` est vide.**

## Composant(s) introduit(s) ou modifié(s) par cette mission

- **API centrale** (NestJS, TypeScript) : adaptateurs réels `psp/wave/wave-adapter.ts`, `psp/paydunya/paydunya-adapter.ts`, `psp/stripe/stripe-adapter.ts` derrière le port `PspAdapter` révisé (deux verdicts, notification ou signal ; méthode facultative `resolvePaymentReference` pour le litige Stripe) ; `psp/aws/secrets-manager-store.ts` (port `PspSecretStore`) ; `kms/aws/aws-kms.ts` et `aws-kms-client.ts` (cinq ports de clés) ; `sealing/s3-seal-copy.ts` (`SealExternalCopy`) ; client HTTP sortant commun `psp/http/psp-http.ts` (axios) ; `psp/fake/fake-signal-psp-adapter.ts` (faux à signal) ; `external-services/services.ts`, `production-enabled.ts` (liste unique, vide) et `trial/` (commande d'essai `npm run essai -w @cashless/api -- <service>`) ; `topups/psp/psp-status-confirmer.ts` (relecture authentifiée, commune à la réception et au travailleur). Modifiés : vérifieur et réception des notifications (corps en formulaire pour PayDunya, signal conservé sans effet, relecture lancée après l'écriture de la réponse), répartiteur d'événements (résolution du litige Stripe), travailleur d'interrogation (délègue au confirmateur ; reste le filet de 2 minutes), garde de production (`UntriedInProductionError`), fabriques `psp.providers.ts` (règle I1), `config.ts` (réglages `PSP_ADAPTERS`, `PSP_SECRET_STORE`, `KMS_BACKEND`, `SEAL_COPY`, `SEAL_COPY_BUCKET`, `SEAL_COPY_RETENTION_DAYS`, adresses de base et délai des PSP), `android-key-attestation.ts` (exception de la racine d'usine, WP12).
- **Base** (PostgreSQL 17) : **aucune migration**, aucun `.sql` généré modifié, aucun droit nouveau (`git diff` de `packages/ledger-sql` vide). Le signal réutilise `psp_event` (nature `UNKNOWN`, marqué traité sans effet) ; `psp_poll_candidates` inchangée.
- **Contrat** (`openapi.yaml`, `contract-baseline.json`) : ajout rétrocompatible à `receivePspWebhook` (D9, ADR-237) livré : `application/x-www-form-urlencoded` (objet libre, `paydunya` seulement, `400 VALIDATION_FAILED` pour les autres) et description par fournisseur de la preuve d'origine ; 313 différences admises (310 avant), 0 refusée ; types TypeScript et Dart régénérés. Aucune route ni opération ajoutée (196 chemins, 234 opérations, analyse YAML).
- **Dépendances nouvelles** (C-004, `docs/08-pile-logicielle.md`) : `axios` 1.21.1, `@aws-sdk/client-kms`, `@aws-sdk/client-secrets-manager`, `@aws-sdk/client-s3` 3.1172.0, versions exactes, installées ; 32 paquets ajoutés au verrou (`@smithy/*`), registre officiel avec intégrité, aucun script d'installation.
- **Systèmes externes** (voir `docs/03-context-diagram.md`) : Wave, PayDunya, Stripe, AWS Secrets Manager, KMS, S3 Object Lock : « adaptateur conforme, jamais essayé en réel » ; Orange Money inchangé.

## Décisions d'architecture prises dans cette mission

| Décision | Justification | Alternative envisagée |
|---|---|---|
| D1 : Orange Money hors périmètre | Documentation technique derrière un compte Sonatel | Écrire l'adaptateur sans la documentation |
| D2 : notification PayDunya = signal ; crédit après `checkout-invoice/confirm/{token}` | PayDunya ne signe pas son contenu ; preuve d'origine fixe (`sha512` de la clé maître) ; écart consigné (OP-N199, ADR-238) | Croire la notification (écarté par le porteur) |
| D3, D6 : refus en production jusqu'à l'essai réel ; liste dans le code (vide), modifiée par une PR relue | Preuve de l'essai tracée par la revue | Réglage d'environnement |
| Règle I1 : réglage absent = `real` en production ; `fake` refusé ; `real` non listé : PSP et coffre indisponibles (démarrage permis), KMS et copie des scellements refusent de démarrer | Préserve le comportement d'avant pour les PSP (404/503) tout en refusant ce qui protège les clés | Refuser le démarrage pour tout service non listé |
| D4 : Stripe inclus ; éligibilité Sénégal à vérifier à l'essai | Carte internationale | Reporter Stripe |
| D5 : remboursement d'un paiement non crédité hors plateforme (OP-N82) | Décision du 26/11/2026 | Le servir par la plateforme |
| D7 : carte PayDunya sans preuve 3-D Secure : reçue, non créditée | Aucune preuve dans la confirmation (OP-N200) | Assouplir la règle d'ADR-77 |
| Stripe : seul `authenticated` vaut 3-D Secure réussi ; `attempt_acknowledged` non crédité (décision du 26/11/2026, renforcement de `research.md`) | Lecture stricte d'ADR-77 | Ranger `attempt_acknowledged` parmi les succès |
| Stripe : session `open` après un refus reste en attente | Le payeur peut réessayer | Marquer échouée |
| Litige Stripe : conservé « à relire », rattaché à la recharge par relecture (`resolvePaymentReference`), sinon voie `UNMATCHED` (24 h puis anomalie) | Décision du 26/11/2026 (cycle 3 de WP03) : le journal seul retirait un contrôle | Journal seul, événement marqué traité (refusé, règle 1) |
| D8 : rétention des copies de scellement 10 ans (`SEAL_COPY_RETENTION_DAYS`, 3 650), mode COMPLIANCE, `IfNoneMatch: *` | Durée de conservation comptable | Mode gouvernance |
| D9 : ajout rétrocompatible à `receivePspWebhook` | Corps en formulaire de PayDunya | Convertir le corps avant l'API |
| **Relecture du signal lancée par la réception après l'écriture de la réponse (`finish` ou `close`), par `PspStatusConfirmer`, hors transaction, au plus une par recharge et par minute et par processus ; le travailleur d'interrogation (2 min) est le filet**, sans migration | Réponse < 2 s au contrat, Wave exige un `2xx` sous 5 s, crédit par le chemin unique (NFR-005) ; borne en mémoire du processus (OP-N205) | Version initiale du plan (avant R-07) : relecture prioritaire par le seul travailleur (délai 0), qui aurait exigé de changer `psp_poll_candidates` ; appel `getStatus` pendant la réception |
| Attestation Android : exception limitée à la racine d'usine `f92009e853b6b045` pour les certificats expirés ; Apple : contrôle des extensions reporté en mission 12 | WP12, décisions du 26/11/2026 (OP-N202, OP-N203, ADR-239) | Ne rien changer |
| Serveurs HTTP locaux rejouant les réponses documentées, clients AWS visant ces serveurs ; garde réseau des tests (`no-external-network.ts`) | NFR-001 : aucun réseau en test, sérialisation réelle du SDK prouvée ; limite : contournable par `lookup` (OP-N207) | Moquer `client.send` |

## Écarts de sécurité (règle du porteur du 13/10/2026), consignés par la mission

| Écart | Sens | Consignation |
|---|---|---|
| Preuve d'origine PayDunya fixe (D2) | affaiblit, borné (relecture authentifiée, une par recharge et par minute, aucun crédit sur le signal) | OP-N199, ADR-238, tests de borne `paydunya-adapter.spec.ts` et `signal-relecture.spec.ts`, report PRD et PROMPTS |
| Exception Android des certificats d'usine expirés (racine `f92009e853b6b045`) | affaiblit, borné à une racine | OP-N202, ADR-239, test de borne, `consignation.spec.ts` ; manque : test de l'exclusion RKP (mission 12) |
| Extensions App Attest non contrôlées (écart déjà présent, mis au jour) | affaiblit (existant) | OP-N203, ADR-239 ; décision du 27/11/2026 : ne bloque pas la production, levé par la mission 12 |
| Carte PayDunya non créditée ; Stripe 3-D Secure strict ; corps brut d'un signal non conservé ; session d'une autre recharge refusée ; faux refusé à la fabrique ; adresses non `https` refusées en production | renforcent, faits puis consignés | OP-N200, ADR-237, §16 de `POINTS_OUVERTS.md` |
| Faux ou adaptateur gardé en production | aucun : liste vide (D6) | `production-enabled.spec.ts`, `production-guard.spec.ts`, `processes.spec.ts` (OP-N209) |

À faire relire par une personne (règle 4) : `psp/paydunya/paydunya-adapter.ts`, `psp/aws/secrets-manager-store.ts`, `kms/aws/aws-kms.ts`, `sealing/s3-seal-copy.ts`, `external-services/production-enabled.ts`, `webhooks/webhook-verifier.ts`, `topups/psp/psp-status-confirmer.ts`, `attestation/android-key-attestation.ts` et les deux fichiers App Attest, `test/support/no-external-network.ts`, `package-lock.json`, `tools/contract-stability/contract-baseline.json`.

## Lien avec la synthèse globale

Contribue à : `docs/04-architecture-diagram.md`, table « Détail par mission » et « Décisions d'architecture notables ». Vue C4 inchangée (aucun conteneur nouveau, aucun acteur, aucun domaine). Contribue aussi à `docs/03-context-diagram.md` (état des systèmes externes), `docs/08-pile-logicielle.md` (quatre dépendances, installées) et `docs/SERVICES-EXTERNES.md`.

## Nécessaire pour cette mission ? Oui : décisions D1 à D9 et celles des relectures, dépendances installées, écarts de sécurité et garde de production tracés, même sans conteneur nouveau (proposition de l'Agent à la review du 27/11/2026, en attente de confirmation du porteur).
## Complet ? Oui à la review (27/11/2026) : composants et décisions recalés sur le code livré, dont le déclencheur de la relecture du signal (plan révisé R-07, la doc du plan décrivait la version initiale) ; écarts de sécurité et fichiers à relire listés ; limites OP-N204 à OP-N211 renvoyées à `docs/POINTS_OUVERTS.md` §16 (proposition de l'Agent, en attente de confirmation du porteur).
## Validé par : plan : proposition de l'Agent le 26/11/2026, confirmée par le porteur le 26/11/2026 ; review : proposition de l'Agent le 27/11/2026, en attente de confirmation du porteur.
