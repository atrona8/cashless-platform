---
affected_files: []
cycle_number: 1
mission_slug: serveur-app-festivalier-01M7WB69
reproduction_command:
reviewed_at: '2026-11-23T10:22:01Z'
reviewer_agent: claude
wp_id: WP11
---

# Relecture WP11, cycle 1 : changements demandes (documentation seule, trois constats)

Verifie sans ecart : numerotation OP-N163 a OP-N169 et ADR-225 a ADR-231 (suite d'OP-N162 / ADR-224, aucune
branche locale au-dela, aucun doublon) ; renvois, noms de fonctions, tests, fichiers et libelles de refus de
`bootstrap.ts` existent (grep) ; OP-N47 leve avec test de levee, borne inversee, double empreinte ecartee ; chiffres
de `preuves.md` (WP08 12/12, WP10 integration 5/5 et 50/50 = dossier customer-auth, unitaires 19/19 = 16 `it` + 3 de
`it.each`, passerelle 35/35, p95 24/51 et 26/73) conformes aux notes ; reports 10a, 10b, 11, 12b, 13 et PRD presents ;
aucun fichier hors du lot (hors procedure, accepte), SPECIFICATION.md et matrice intacts.

## Constat 1 (bloquant, regle 4) : liste des fichiers a faire relire incomplete
Fichiers sensibles modifies par la mission et absents de la liste (POINTS_OUVERTS section 12) :
- `.github/workflows/ledger-tests.yml`, `tools/dev-db/env.sh`, `tools/dev-db/env.test.example`,
  `apps/gateway/test/support/disposable-databases.ts` : mot de passe et URL du role `cashless_claimadmin` (WP04) ;
- `apps/api/src/kyc/kyc.controller.ts` et `kyc-revocation.controller.ts` : controle de role et de portee des routes
  d'identification et de revocation ;
- `apps/api/src/media/batches/claim-codes.service.ts` et `media/personalization/personalization.service.ts` :
  appels versionnes, remplacement d'un ancien code (`MEDIA_ALREADY_HAS_CODE`), empreintes ;
- `apps/api/src/customer-auth/customer-auth.service.ts` et `customer-auth.module.ts` (cablage de la chaine, lien du
  titulaire), `audit/audit.service.ts` (`KYC_VERIFIED`, `KYC_REVOKED`).
Correction : les ajouter a la liste de la section 12 (et aux ADR concernees : ADR-226, 228, 229).

## Constat 2 (bloquant, regle 3) : deux ecarts de notes de lane non consignes
- WP07 : `personalization.service.ts` n'a pas le controle applicatif `claim_code_used_at` (la base refuse `CL020`,
  `tests_claim_key_version.sql` l. 298-299). Controle reporte vers la base : l'ecrire dans OP-N169 (et ADR-231) avec
  le test qui le fige.
- WP06 : `guardDecision` ne teste pas l'etat `REVOKED` (R-03 suivi, la demande echoue a l'execution, `CL063`).
  Ajouter une ligne a OP-N165 ou OP-N169 avec le test (`revoke.spec.ts`, cas « deja revoquee », 409).

## Constat 3 (mineur) : affirmation trop forte
`PROMPTS-A-ENVOYER.md` (etat 10a) dit que chaque limite a « son test de borne ». OP-N167 (3), OP-N168 (tous statuts
de lot) et OP-N169 n'en ont pas (la section 12 le reconnait). Reformuler : « test de borne, ou limite declaree non
figee (section 12) ».
