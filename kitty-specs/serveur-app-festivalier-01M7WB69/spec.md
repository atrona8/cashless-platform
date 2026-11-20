# Mission Specification: Serveur de l'app festivalier

**Mission Branch**: `feat/serveur-app-festivalier`
**Created**: 2026-11-20
**Status**: Draft
**Input**: Mission 10a de `PROMPTS-A-ENVOYER.md` ; Decision Moments du porteur du 20/11/2026 (périmètre, règle de
l'agent titulaire, rotation OP-N47) et résumé d'intention confirmé le même jour.

## Contexte

Une partie du serveur de l'app festivalier a été servie en avance, hors Spec Kitty, le 10/11/2026 (branche
`feat/me-lectures`, dans `main`) : comptes par numéro vérifié et code à usage unique (`/customer-auth/*`), jeton de
compte (`TokenCustomerIdentity`, seul cru en production), lectures `/me`, déclaration de perte ; remboursements et
relevé du festivalier sont servis par la mission 9a. Cette mission complète ce serveur pour que l'équipe de l'app
(mission 10b, déléguée) code contre des routes réelles : identification du festivalier au guichet, rotation du secret
des codes de rattachement (OP-N47), champs encore vides de `/me`, chaîne d'envoi des codes avec repli.

Hors périmètre : adaptateurs réels des fournisseurs WhatsApp et SMS (mission 12b ; l'en-tête `X-Test-Otp-Code` du faux,
OP-N120, reste jusque-là) ; vérification d'identité en ligne (méthode `ONLINE`, prévue par l'interface, non
implémentée en V1) ; écrans du back-office et de l'app ; gestion des clients par une application cliente (mission 10c).

## Domain Language

| Terme canonique | Sens | À éviter |
|---|---|---|
| Identification (KYC) | Passage au guichet où un agent contrôle une pièce d'identité d'un festivalier qui a un compte ; ajout seul | « vérification », « inscription » |
| Niveau d'identification | `NONE` ou `VERIFIED`, calculé à chaque usage, jamais stocké (ADR-54) | « statut KYC » stocké |
| Agent titulaire | Agent du guichet dont le téléphone est le numéro vérifié du compte festivalier présenté | « conflit d'intérêts » |
| Code de rattachement | Code imprimé sur le bracelet, qui permet de le rattacher à un compte ; la base n'en garde que l'empreinte à clé | « code QR », « PIN du bracelet » |
| Rotation du secret | Remplacement immédiat du secret des empreintes des codes de rattachement ; les codes émis avant ne valent plus rien | « renouvellement », « migration » |
| Chaîne d'envoi | Ordre des canaux d'un même code : WhatsApp, puis SMS principal, puis SMS de repli | « multicanal » |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Identifier un festivalier au guichet (Priority: P1)

Un festivalier qui a un compte au numéro vérifié se présente au guichet avec son bracelet ou son téléphone et une pièce
d'identité. Le caissier (ou un `ORGANIZER_ADMIN`) contrôle la pièce et saisit le type, le pays d'émission, les 4
derniers caractères du numéro et la date d'expiration. Tous les portefeuilles du client passent `VERIFIED` : les
plafonds des identifiés s'appliquent à ses recharges suivantes.

**Why this priority**: sans identification, aucun festivalier ne dépasse les plafonds des non-identifiés (§6.3) ; les
routes sont au contrat depuis la mission 5b et répondent `404`.

**Independent Test**: un caissier identifie un client au compte vérifié ; la recharge suivante au-delà du plafond non
identifié et sous le plafond identifié est acceptée ; elle était refusée avant.

**Acceptance Scenarios**:

1. **Given** un portefeuille dont le client a un compte au numéro vérifié, **When** un caissier saisit une pièce
   valide, **Then** `201` avec l'identification, et le niveau calculé de tous les portefeuilles du client est `VERIFIED`.
2. **Given** un portefeuille anonyme (sans client), **When** un caissier tente de l'identifier, **Then** `422
   ACCOUNT_REQUIRED`, rien n'est écrit.
3. **Given** un compte festivalier dont le numéro vérifié est le téléphone du caissier, **When** ce caissier tente de
   l'identifier, **Then** `403 FORBIDDEN`, rien n'est écrit.
4. **Given** une identification dont la pièce expire, **When** une recharge a lieu après la date d'expiration, **Then**
   le niveau calculé est `NONE` et les plafonds des non-identifiés s'appliquent, sans tâche planifiée.
5. **Given** une personne sans rôle `CASHIER` ni `ORGANIZER_ADMIN` sur l'événement, **When** elle tente une
   identification, **Then** `403`.

---

### User Story 2 - Révoquer une identification à deux personnes (Priority: P1)

Un administrateur apprend qu'une pièce présentée était volée. Il demande la révocation avec un motif ; une seconde
personne (`OPERATOR_ADMIN` ou `ORGANIZER_ADMIN`, autre que l'auteur) l'approuve. L'identification passe `REVOKED` et
les plafonds des non-identifiés s'appliquent aux opérations suivantes de tous les portefeuilles du client.

**Why this priority**: une identification frauduleuse ouvre des plafonds élevés ; la seule correction permise est la
révocation (ajout seul).

**Independent Test**: demande `202 PENDING`, approbation par une autre personne, niveau `NONE` à la recharge suivante.

**Acceptance Scenarios**:

1. **Given** une identification `VERIFIED`, **When** un `OPERATOR_ADMIN` demande la révocation avec un motif d'au moins
   10 caractères, **Then** `202` et une demande `KYC_REVOCATION` `PENDING`, rien n'est exécuté.
2. **Given** cette demande, **When** une autre personne habilitée l'approuve, **Then** l'identification est `REVOKED`
   avec l'auteur et le motif, le valideur est au journal d'audit.
3. **Given** cette demande, **When** son auteur tente de l'approuver, **Then** refus, la demande reste `PENDING`.
4. **Given** une identification déjà révoquée, **When** une révocation est demandée, **Then** `409 CONFLICT_STATE`.

---

### User Story 3 - Rotation immédiate du secret des codes de rattachement (Priority: P2)

Le secret des empreintes des codes de rattachement a fuité. L'exploitant suit la procédure de rotation : il pose un
nouveau secret ; dès le redémarrage, aucun code émis sous l'ancien secret ne rattache plus un bracelet, ni ne sert à
une consultation anonyme ou à une confirmation. Les bracelets concernés reçoivent de nouveaux codes par un nouveau
fichier de l'imprimeur.

**Why this priority**: OP-N47 ; aujourd'hui une fuite ne se répare pas proprement (rien n'est prévu, l'effet d'un
changement de secret n'est ni testé ni documenté).

**Independent Test**: un code émis avant la rotation est refusé après, comme un code inconnu ; un code émis après est
accepté ; aucun code en clair n'existe nulle part.

**Acceptance Scenarios**:

1. **Given** un bracelet dont le code a été émis sous l'ancien secret, **When** le secret change et qu'on tente de le
   rattacher avec ce code, **Then** même réponse qu'un code inconnu.
2. **Given** la rotation faite, **When** un nouveau fichier de codes est émis pour ces bracelets, **Then** les nouveaux
   codes rattachent normalement.
3. **Given** la rotation faite, **When** on cherche un code en clair (base, journaux, audit), **Then** aucun.

---

### User Story 4 - `/me` complet pour l'app (Priority: P2)

L'app festivalier affiche le numéro imprimé de chaque bracelet et prévient quand le solde est provisoire parce que des
terminaux hors ligne peuvent encore remonter des achats.

**Why this priority**: champs déclarés au contrat, aujourd'hui vide (`printed_number`) ou absent
(`pending_offline_notice`) ; l'équipe 10b en a besoin pour ses écrans.

**Independent Test**: un bracelet au numéro imprimé connu le montre dans `listMyMedia` ; un portefeuille avec des achats
hors ligne encore attendus montre `pending_offline_notice: true`, puis `false` une fois remontés.

**Acceptance Scenarios**:

1. **Given** un bracelet dont le numéro imprimé est connu, **When** le festivalier liste ses bracelets, **Then** le
   numéro apparaît ; inconnu, il vaut `null`.
2. **Given** un portefeuille présent dans un snapshot hors ligne d'un terminal de l'événement qui n'a pas encore remonté
   ses lots depuis, **When** le festivalier lit ses portefeuilles, **Then** `pending_offline_notice: true`.
3. **Given** le même portefeuille après la remontée des lots de tous ces terminaux, **When** il relit, **Then**
   `pending_offline_notice: false`.

---

### User Story 5 - Le code arrive même si WhatsApp échoue (Priority: P3)

Un festivalier demande un code. Il part par WhatsApp ; si la livraison n'est pas confirmée en 10 s ou si le numéro n'a
pas WhatsApp, le même code part par le fournisseur SMS principal ; si celui-ci ne confirme pas en 20 s, par le
fournisseur SMS de repli. Le festivalier peut aussi demander directement le SMS.

**Why this priority**: ADR-66 ; les vrais fournisseurs n'arrivent qu'en 12b, mais la chaîne et ses délais se testent
dès maintenant avec des faux.

**Independent Test**: avec des faux configurés pour échouer, le code arrive par le canal suivant dans les délais ; un
seul code est valide par défi, quel que soit le canal.

**Acceptance Scenarios**:

1. **Given** un faux WhatsApp qui confirme, **When** un code est demandé, **Then** aucun SMS n'est envoyé.
2. **Given** un faux WhatsApp qui ne confirme pas, **When** 10 s passent, **Then** le même code part par le SMS
   principal.
3. **Given** un numéro sans WhatsApp, **When** un code est demandé, **Then** il part aussitôt par le SMS principal.
4. **Given** un SMS principal qui ne confirme pas, **When** 20 s passent, **Then** le même code part par le SMS de repli.
5. **Given** le canal `SMS` demandé, **When** un code est demandé, **Then** WhatsApp n'est pas essayé.
6. **Given** les limites existantes, **When** elles sont dépassées, **Then** `429 OTP_RATE_LIMITED` comme aujourd'hui,
   et les bascules ne comptent pas comme de nouveaux envois.

### Edge Cases

- Deux caissiers identifient le même client en même temps : deux identifications valides sont admises (ajout seul) ;
  le niveau reste `VERIFIED` tant que l'une est valide.
- Agent sans téléphone enregistré, ou avec un autre numéro que celui du compte : la règle de l'agent titulaire ne le
  détecte pas (limite consignée, voir C-005).
- Pièce dont la date d'expiration est déjà passée à la saisie : refus `422`.
- Révocation approuvée pendant qu'une recharge est en cours : la recharge suivante applique les plafonds non identifiés ;
  celle en cours suit le niveau à sa date.
- Rotation du secret pendant un rattachement en attente de confirmation au guichet : le code de confirmation émis sous
  l'ancien secret est refusé ; le festivalier recommence.
- Toute la chaîne échoue (WhatsApp, SMS principal et repli) : le défi reste valide jusqu'à son expiration, le
  festivalier peut redemander dans les limites ; aucune erreur ne révèle le code.
- Fournisseur qui confirme après la bascule : le code reste le même, un second message n'invalide rien.

## Requirements *(mandatory)*

### Functional Requirements

| ID | Title | User Story | Priority | Status | Delivery | No-op passable? |
|----|-------|------------|----------|--------|----------|-----------------|
| FR-001 | Identification au guichet | En tant que caissier ou `ORGANIZER_ADMIN`, je veux enregistrer la pièce d'un festivalier au compte vérifié (type, pays, 4 derniers caractères, expiration) pour que ses portefeuilles passent `VERIFIED`. | High | Open | [build] | no |
| FR-002 | Compte exigé | En tant que plateforme, je veux refuser l'identification d'un portefeuille sans client (`422 ACCOUNT_REQUIRED`) pour que l'identification porte toujours sur une personne joignable. | High | Open | [build] | no |
| FR-003 | Agent titulaire refusé | En tant que plateforme, je veux refuser (`403`) l'identification d'un compte dont le numéro vérifié est le téléphone de l'agent, pour qu'un agent ne s'ouvre pas lui-même des plafonds. | High | Open | [build] | no |
| FR-004 | Écriture contrôlée | En tant que plateforme, je veux que l'identification ne s'écrive que par une fonction contrôlée de la base qui applique FR-002 et FR-003, pour qu'une connexion de l'API compromise ne puisse pas les contourner. | High | Open | [build] | no |
| FR-005 | Révocation à deux | En tant qu'administrateur, je veux révoquer une identification par une demande `KYC_REVOCATION` approuvée par une autre personne habilitée, avec motif, pour corriger une fraude sans modifier l'historique. | High | Open | [build] | no |
| FR-006 | Niveau calculé | En tant que plateforme, je veux que les plafonds appliquent le niveau calculé à la date de l'opération (pièce expirée ou révoquée → `NONE`), pour qu'aucun état stocké ne dérive. | High | Open | [ratchet] | yes — paire : même client, recharge avant et après expiration ou révocation |
| FR-007 | Rotation immédiate du secret | En tant qu'exploitant, je veux une procédure documentée et testée de rotation immédiate du secret des codes de rattachement, après laquelle tout code émis avant est refusé comme inconnu, pour réparer une fuite. | Medium | Open | [build] | no |
| FR-008 | Réémission des codes | En tant qu'exploitant, je veux que les bracelets concernés reçoivent de nouveaux codes par un nouveau fichier de l'imprimeur après rotation, pour qu'ils redeviennent rattachables. | Medium | Open | [build] | no |
| FR-009 | Numéro imprimé | En tant que festivalier, je veux voir le numéro imprimé de mes bracelets dans l'app quand il est connu (`null` sinon), pour reconnaître un bracelet. | Medium | Open | [build] | no |
| FR-010 | Avis de solde provisoire | En tant que festivalier, je veux être prévenu (`pending_offline_notice`) quand des terminaux hors ligne peuvent encore remonter des achats sur mon portefeuille, pour ne pas croire un solde provisoire. | Medium | Open | [build] | no |
| FR-011 | Chaîne d'envoi | En tant que festivalier, je veux que mon code parte par WhatsApp puis par SMS principal (10 s ou pas de WhatsApp) puis par SMS de repli (20 s), pour le recevoir même si un canal échoue. | Medium | Open | [build] | no |
| FR-012 | SMS direct | En tant que festivalier, je veux pouvoir demander directement le SMS, pour ne pas attendre WhatsApp. | Low | Open | [ratchet] | yes — canal `SMS` déjà au contrat ; paire avec `AUTO` sur le même numéro |
| FR-013 | Un seul code par défi | En tant que plateforme, je veux qu'un défi n'ait qu'un code valide quel que soit le nombre de canaux essayés, et que les bascules ne comptent pas dans les limites d'envoi. | High | Open | [build] | no |

### Non-Functional Requirements

| ID | Title | Requirement | Category | Priority | Status |
|----|-------|-------------|----------|----------|--------|
| NFR-001 | Bascules à l'heure | Le SMS principal part au plus 11 s après la demande si WhatsApp ne confirme pas ; le SMS de repli au plus 21 s après l'envoi principal non confirmé (tolérance 1 s, mesurée avec des faux). | Performance | Medium | Open |
| NFR-002 | Aucun code en clair | Aucun code à usage unique ni code de rattachement en clair en base, dans les journaux, l'audit ou le registre d'idempotence : 0 occurrence trouvée par les tests de recherche. | Security | High | Open |
| NFR-003 | Pièce minimale | L'identification ne stocke que type, pays, 4 derniers caractères et date d'expiration ; 0 champ supplémentaire (photo, numéro complet) sans règle explicite du profil de législation. | Security | High | Open |
| NFR-004 | Lecture `/me` | `getMe` et `listMyWallets` avec `pending_offline_notice` : p95 inférieur à 300 ms pour un client de 5 portefeuilles sur la base de test. | Performance | Medium | Open |
| NFR-005 | Faux refusés | 100 % des faux fournisseurs ajoutés (WhatsApp, SMS principal, SMS de repli) refusent le démarrage en configuration de production, chacun prouvé par un test. | Security | High | Open |

### Constraints

| ID | Title | Constraint | Category | Priority | Status |
|----|-------|------------|----------|----------|--------|
| C-001 | Contrat inchangé | `openapi.yaml` fait foi : aucune route existante modifiée ; tout ajout rétrocompatible est soumis au porteur avant d'être codé et inscrit dans `contract-baseline.json`. | Technical | High | Open |
| C-002 | Révocation : contrat contre spécification | §6.3 point 5 dit « un administrateur » ; le contrat exige deux personnes. Le contrat prime (SPECIFICATION §0.3) ; la contradiction reste signalée. | Regulatory | High | Open |
| C-003 | Faux jusqu'à la 12b | Fournisseurs WhatsApp et SMS simulés ; l'en-tête `X-Test-Otp-Code` reste (OP-N120, ADR-180) ; refus en production (règle 2 de `CLAUDE.md`). | Technical | High | Open |
| C-004 | Règles de sécurité du projet | Tout écart qui affaiblit la sécurité est soumis au porteur avant d'être codé ; chaque écart accepté a point ouvert, ADR, test de borne et report (règles 1 à 4 de `CLAUDE.md`). | Regulatory | High | Open |
| C-005 | Limite de la règle de l'agent titulaire | La détection repose sur l'égalité du numéro vérifié et du téléphone de l'agent (décision du porteur du 20/11/2026) ; un agent sans numéro ou avec un autre numéro n'est pas détecté. Limite consignée (point ouvert, ADR, test de borne). | Regulatory | High | Open |
| C-006 | Plafonds provisoires | Les montants des plafonds du Sénégal restent provisoires (§6.5, ADR-48) et ne sont pas présentés comme validés. | Regulatory | Medium | Open |
| C-007 | `.sql` générés | Les fichiers `.sql` générés de `packages/ledger-sql/` ne sont jamais modifiés à la main. | Technical | High | Open |

### Key Entities

- **Identification (`kyc_verification`)** : client, portefeuille présenté, méthode (`DESK`), agent, date, type et pays de
  la pièce, 4 derniers caractères, expiration, statut (`VERIFIED`, `REVOKED`), auteur et motif de la révocation. Ajout
  seul ; seule la révocation la modifie.
- **Demande de révocation (`KYC_REVOCATION`)** : demande d'approbation à deux personnes portant l'identification visée
  et le motif.
- **Code de rattachement** : empreinte à clé par bracelet ; après rotation, les empreintes de l'ancien secret ne
  correspondent plus à rien.
- **Défi de code (`otp_challenge`)** : un code, les canaux essayés et leur état de livraison.
- **Bracelet du festivalier** : numéro imprimé (facultatif), statut, caution, portefeuille.

## Assumptions

- Le numéro imprimé d'un bracelet n'existe dans aucune donnée aujourd'hui (le fichier de l'imprimeur ne porte que la
  correspondance code ↔ UID). Hypothèse : il arrive par une colonne facultative du fichier de l'imprimeur ; s'il n'est
  pas fourni, `printed_number` vaut `null`. Confirmé au plan le 20/11/2026 (troisième colonne facultative), ajout rétrocompatible validé par le porteur (C-001).
- Les nouveaux codes après rotation passent par l'émission et l'import de codes existants (mission 4), sans route
  nouvelle.
- Le délai de 10 s et de 20 s est réglable par la plateforme (§8.5) ; les valeurs par défaut sont 10 s et 20 s.
- La relecture humaine de `0080_customer_auth.sql`, de la section 10 de `post-roles.sql` et de
  `customer-auth.service.ts` (code fait hors Spec Kitty) reste à la charge du porteur et n'est pas un livrable de
  cette mission.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un festivalier identifié au guichet recharge au-delà du plafond non identifié dans 100 % des essais de
  recette, et un festivalier non identifié est refusé dans 100 % des essais. — [build] · no-op passable: no
- **SC-002**: 0 identification enregistrée pour un portefeuille anonyme ou par un agent titulaire au numéro identique,
  sur l'ensemble des tentatives des tests. — [build] · no-op passable: no
- **SC-003**: Après rotation, 100 % des codes émis avant sont refusés et 100 % des codes réémis rattachent leur
  bracelet. — [build] · no-op passable: no
- **SC-004**: L'équipe de l'app (10b) affiche numéro imprimé et avis de solde provisoire sans route simulée : les deux
  champs sont servis par l'API réelle. — [build] · no-op passable: no
- **SC-005**: Avec un canal en échec, le code arrive par le canal suivant dans 100 % des essais, dans les délais de
  NFR-001. — [build] · no-op passable: no
