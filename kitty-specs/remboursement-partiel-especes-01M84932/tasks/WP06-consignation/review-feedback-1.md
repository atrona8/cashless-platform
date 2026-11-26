# Relecture WP06, cycle 1 : changements demandes

Verifie et conforme : SPECIFICATION 8.5 et 17 fideles aux decisions (cumul par portefeuille, montant debite,
deux reglages false), numero de version inchange (1.2) ; OP-N173 a OP-N184 et ADR-233/234 sans collision avec
main ni les autres branches ; les 12 limites de la liste de reference ont chacune un OP, un ADR, une mission et
un test de borne ou une absence assumee ; reports PROMPTS (11, 12, 13) et PRD presents.

**Constat 1 (bloquant, chiffres de preuves.md absents des notes).** `docs/passation-9c/preuves.md`, ligne WP01 :
"14 tests ; 147 avec tests_execute_grants.sql" ; ligne WP03 : "30/30 avec cascade". Aucune note de lane ni
relecture ne contient 14, ni 147 pour WP01 (le 147 des notes est celui des gardes transverses de WP05), ni 30/30.
Le fichier pgTAP est en `no_plan()` : 14 n'est pas deduit non plus. Correction : remplacer par ce que la note
WP01 dit ("suites de droits (execute_grants, 9b, 10a, 11a) vertes", mutations tests 3 a 8) et par "97/97" pour
WP03, ou ecrire "non etabli" ; meme retrait des chiffres derives dans FR-005 ("14 tests") et NFR-004 ("14 tests,
147 avec ...").

**Constat 2 (mineur, liste a relire).** `apps/api/src/configuration/settings-catalog.ts` porte qui peut regler
chaque reglage (`setBy` OPERATOR_ADMIN / ORGANIZER_ADMIN) : c'est une matrice de droits, rangee a tort dans le
"cablage sans droit" de la section 13. L'ajouter aux fichiers a faire relire.

**Constat 3 (mineur).** Sections 13 et PROMPTS : deux faits des notes ne sont pas consignes : WP03, la creation
d'evenement ignore `cash_partial_refund_enabled` (EventCreate inchange) ; WP04, ecart a interfaces.md (parametre
`ledgerId` ajoute). Les citer dans OP-N184 ou une ligne de la section 13 (pas d'OP obligatoire).

**Constat 4 (mineur).** L'etat de PROMPTS-A-ENVOYER.md dit "WP06 en relecture" : a passer a "livree" a
l'approbation (ou formuler sans etat de relecture).
