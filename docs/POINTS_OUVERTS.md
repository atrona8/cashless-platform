# Points ouverts — système cashless multi-tenant

État au 2 octobre 2026 (après la revue de cohérence n° 2). Ce document liste ce qui n'est pas encore décidé. Chaque point indique s'il **bloque le code** et s'il **bloque la mise en production**, qui décide, et ce que l'agent code en attendant.

**Deux catégories :**

- **Bloque le code (OP-Bn).** Sans la réponse, l'agent ne peut pas écrire le module concerné correctement. Il code l'interface (port) et un faux pour les tests, puis s'arrête sur ce module.
- **Ne bloque pas le code (OP-Nn).** Une valeur par défaut sûre existe. L'agent la code, la rend paramétrable, et la décision la remplacera sans refonte. Beaucoup de ces points bloquent en revanche la **mise en production**.

Quand un point est tranché : on ajoute une fiche dans `DECISIONS_ADR.md`, on met à jour `SPECIFICATION.md` (§17 pour les valeurs par défaut) et on retire le point d'ici.

## Vue d'ensemble

| Point | Sujet | Bloque le code | Bloque la production | Qui décide |
|---|---|---|---|---|
| OP-N3 | Taxes, caution acquise, correspondance SYSCOHADA (la casse est tranchée : ADR-67) | Non | **Oui** | Expert-comptable |
| OP-N11 | Région d'hébergement AWS : Paris (`eu-west-3`) retenue à titre provisoire (ADR-65) | Non | **Oui** (confirmation) | Mesure de latence et juriste |
| OP-N12 | Durées de conservation des données | Non | **Oui** | Juriste |
| OP-N13 | Algorithme de signature des snapshots | Non | Non | Agent (vérification technique) |
| OP-N36 | Capture différée dans la cible V2 (reporté au cadrage V2) | Non | Non | Porteur du projet, avec le premier partenaire de caisse |
| OP-N37 | Outils de sécurité en CI (reporté) | Non | Non | Porteur du projet |
| OP-N41 | Service de clés des bracelets : faux seulement, adaptateur AWS KMS à écrire | Non | **Oui** | Mission 7 (hors ligne), après OP-N11 (confirmé par le porteur le 15/10/2026) |
| OP-N42 | Identité du terminal — **levé** le 21/10/2026 par la mission 5a (jeton lié, mTLS et signature de chaque requête, ADR-107 ; `device-auth-matrix.spec.ts`, `production-guard.spec.ts`) | Non | Non | — |
| OP-N43 | Identité du festivalier : faux seulement | Non | **Oui** | Mission 10 (app festivalier) |
| OP-N44 | `EXECUTE` hérité de `PUBLIC` — **levé** le 21/10/2026 par la mission 5a (droits rôle par rôle, `tests_execute_grants.sql`) | Non | Non | — |
| OP-N45 | Aiguillage par chemin devant les processus de l'API | Non | **Oui** | Mission 13 (recette V1) (confirmé par le porteur le 15/10/2026) |
| OP-N46 | Signature d'originalité NXP vérifiée par le poste seulement | Non | Non | Mission 12 (app terminal), avec l'auditeur sécurité (confirmé par le porteur le 15/10/2026) |
| OP-N47 | Rotation du secret d'empreinte des codes de rattachement non outillée | Non | Non | Mission 10 (app festivalier) : proposée par l'agent le 16/10/2026, à confirmer par le porteur (ADR-104) |
| OP-N48 | Fichier de commande des codes de rattachement perdu en route : pas de nouvelle émission | Non | Non | Agent (choix laissé par le porteur) ; à revoir en exploitation |
| OP-N49 | Caution en espèces et espèces dues : aucune caisse avant la mission des caisses (`409`) | Non | **Oui** | Mission « Recharges, caisses et PSP » |
| OP-N50 | Lecture liée à une demande de rattachement utilisable par `consume_tap` — **levé** le 21/10/2026 par la mission 5a (migrations 0024, 0026 ; `tests_consume_tap_claim.sql`, `tap-claim-race.spec.ts`) | Non | Non | — |
| OP-N51 | Guichet de retour : enchaînement des étapes servi par la mission 9 (décidé le 15/10/2026, ADR-91) | Non | Non | Mission 9 |
| OP-N52 | Sortie de liste noire : valideur non vérifié par la base — **levé** le 15/10/2026 (migration 0017, ADR-94), avec une limite résiduelle : OP-N56 | Non | Non | — |
| OP-N53 | Limite de la consultation anonyme par adresse sans réglage `trust proxy` — **levé** le 15/10/2026 (`TRUST_PROXY_HOPS`, ADR-95) | Non | Non | Exploitation (valeur du déploiement) |
| OP-N54 | Empreinte de requête sans clé au registre d'idempotence — **levé** le 21/10/2026 par la mission 5a (HMAC `IDEMPOTENCY_HMAC_KEY`, ADR-99 ; `request-hash.spec.ts`, `personalization.spec.ts`) ; consigne de déploiement à appliquer (purge des lignes antérieures) | Non | Non | Exploitation (consigne de déploiement) |
| OP-N55 | `replace_media` ne fait pas suivre les espèces dues au bracelet neuf (ADR-100) | Non | Non | Mission 9 |
| OP-N56 | Décision d'une demande d'approbation : la base ne vérifie pas l'identité de la personne qui décide (limite résiduelle d'ADR-94) | Non | Non (limite acceptée, ADR-94) | Mission 11 (back-office), avec le serveur d'identité réel |
| OP-N57 | `offline_snapshot` : une version très grande plantée par la connexion de l'API bloque les snapshots suivants du grand livre (déni de service hors ligne) ; limite du kit, antérieure à la mission 4 | Non | **Oui** | Mission 7 (hors ligne) |
| OP-N58 | `offline_policy_history` : trace des politiques hors ligne écrite aux droits de l'appelant, donc falsifiable par la connexion de l'API (et version plantée en avance : déni de service sur la modification suivante) ; limite du kit, antérieure à la mission 4 | Non | **Oui** (décision du porteur du 15/10/2026) | Mission 7 (hors ligne) |
| OP-N59 | Fonctions SECURITY DEFINER sans `pg_temp` — **levé** le 21/10/2026 par la mission 5a (migration 0021 et `TEMPORARY` retiré ; `tests_definer_search_path.sql`, `tests_device_rights.sql` §5, `tests_definer_trigger_writers.sql` §4 à 0) | Non | Non | — |
| OP-N60 | `cashless_app` écrit directement ce que des fonctions contrôlent : `INSERT` et `UPDATE` sur toutes les colonnes de `media_batch` (lot créé directement `ACTIVE` ou `CLOSED`, clôture sans `close_batch`, quantité, index de clé), `UPDATE (status)` de `media` sans motif ; antérieur au lot 20 | Non | **Oui** (décision du porteur du 15/10/2026, ADR-97) | Mission 11 (back-office) |
| OP-N61 | Traitements par tranches (NFR-008) : clôture, rattrapage du préchargement et rechiffrement non prouvés sur un lot de 5 000 bracelets (ADR-98) | Non | **Oui** (preuve attendue de la recette, avant la production) | Mission 13 (recette V1), décision du porteur du 15/10/2026 |
| OP-N62 | Retrait d'une clé dédiée sans travail ; demande approuvée périmée — **levé** le 21/10/2026 par la mission 5a (migration 0025 ; `tests_tag_key_retire_guard.sql`) | Non | Non | — |
| OP-N63 | Clé d'accord d'un terminal réécrite par l'API — **levé** le 21/10/2026 par la mission 5a (clé écrite à l'enrôlement seulement, ADR-105 ; `tests_device_rights.sql` §1 et §2) | Non | Non | — |
| OP-N64 | Terminal iOS : clé de signature ECDSA non attestée (App Attest atteste sa propre clé), liée à l'instance attestée par le défi d'enrôlement (ADR-106) | Non | Non (limite acceptée par le porteur le 19/10/2026) | Mission 12 (app terminal) |
| OP-N65 | Rafraîchissement d'un jeton d'appareil : une représentation du jeton consommé tolérée 60 s pour le même terminal (ADR-108) | Non | Non (limite acceptée par le porteur le 19/10/2026) | Mission 13 (recette V1) |
| OP-N66 | Import du fichier de l'imprimeur lent quand la table des bracelets est volumineuse (> 5 s avec ~100 000 bracelets) ; antérieur à la mission 5a | Non | À évaluer | Porteur du projet (point ouvert du 19/10/2026, hors mission 5a) |
| OP-N67 | Attestation Android : `attestationApplicationId` lu dans la liste logicielle de Key Attestation (seul champ ; écart accepté au plan, ADR-110) | Non | Non (limite acceptée par le porteur le 19/10/2026) | Mission 13 (recette V1) |
| OP-N68 | Une fonction créée à la main, hors de `migrate.ts`, reste exécutable par `PUBLIC` jusqu'au prochain rejeu de `post-roles.sql` (ADR-111) | Non | À confirmer par le porteur (limite acceptée le 20/10/2026) | Mission 7 (hors ligne), décision du porteur du 20/10/2026 |
| OP-N69 | `cashless_app` modifie directement neuf colonnes de `device`, dont le plancher de numérotation (`next_seq_floor`), la dernière présence et l'affectation (`event_id`, `pos_id`) ; antérieur à la mission 5a (ADR-112) | Non | À confirmer par le porteur (consigné le 20/10/2026) | Mission 7 (hors ligne), décision du porteur du 20/10/2026 |
| OP-N70 | Suites de la mission 4 sous le faux d'identité du terminal — **levé** le 21/10/2026 par WP18 de la mission 5a (chaque route de terminal en HTTPS réel, test de couverture : `device-auth-matrix.spec.ts`) | Non | Non | — |
| OP-N71 | Idempotence : rejeu sur une autre ressource et entre personnes — **levé** le 21/10/2026 par WP18 de la mission 5a (chemin concret et appelant dans l'empreinte, ADR-116 ; `admin.spec.ts`, `request-hash.spec.ts`) ; même consigne de déploiement qu'OP-N54 | Non | Non | Exploitation (consigne de déploiement) |
| OP-N72 | Enrôlement : chaque refus d'un code inconnu prend le verrou de la chaîne d'audit de la plateforme, et la limite par adresse (/64 en IPv6) ne borne pas un attaquant qui dispose de nombreuses adresses ; aucune limite en amont (répartiteur) sur `POST /v1/device-enrollments` (ADR-117) | Non | Non (limite résiduelle acceptée) | Mission 13 (recette V1) : proposée par l'agent, confirmée par le porteur le 21/10/2026 |
| OP-N73 | Autorité des terminaux (`DEVICE_CA`) et signataire des jetons d'appareil (`TOKEN_SIGNER`) : faux seulement, aucun adaptateur réel (C-004 de la mission 5a, ADR-119) | Non | **Oui** (démarrage refusé en production) | Mission 7 (hors ligne), avec OP-N41 : décision du porteur du 21/10/2026 |
| OP-N74 | Enrôlement accepté sur un code lié à un événement clos (`CLOSED`) ou à un point de vente supprimé depuis l'émission : la base ne relit pas leur état (cas limite de la spécification de la mission 5a non livré ; ADR-120) | Non | Non (le terminal enrôlé n'encaisse rien avant la mission 5b) | Mission 5b (paiement en ligne) : décision du porteur du 21/10/2026 |
| OP-N76 | PIN des vendeurs : l'API lit les empreintes et la base ouvre une session sur la transaction de l'API (même classe qu'OP-N56 ; ADR-121) | Non | Non (limite acceptée par le porteur le 22/10/2026, plan de la mission 5b) | Mission 11 (back-office), avec OP-N56 |
| OP-N75 | Purges des nonces et des essais d'enrôlement exécutées par `cashless_app` (droit plus large que le plan, borné par test ; ADR-114) | Non | Non (limite acceptée par le porteur le 20/10/2026) | Mission 7 (hors ligne), rôle de maintenance dédié : décision du porteur du 21/10/2026 |
| OP-N77 | Secrets de l'API (`IDEMPOTENCY_HMAC_KEY`, `ENROLLMENT_CODE_HMAC_KEY`, `VENDOR_PIN_SECRET`, `VENDOR_PIN_IDEMPOTENCY_SECRET` depuis le 26/10) exigés et reçus par tous les processus, y compris ceux qui ne s'en servent pas (clés, personnalisation) ; antérieur à la mission 5b (ADR-125) | Non | Non (exposition acceptée par le porteur le 23/10/2026) | Mission 13 (recette V1), proposée par l'agent |

Les points sont détaillés aux sections 2 (points non bloquants), 6 (reportés) et 9 (questions de la revue n° 2). OP-N21 à OP-N37 viennent de la revue de cohérence du 30 septembre 2026 (§8) : OP-N21 à OP-N35 sont tranchés, ainsi qu'OP-N38, né de la décision OP-N28 (§5) ; OP-N36 et OP-N37 sont reportés (§6). Aucun ne bloque le code. Q1 à Q6 viennent de la revue n° 2 du 2 octobre 2026 (§9) : toutes sont tranchées (ADR-72 à ADR-77).

---

## 1. Points qui bloquent le code

Aucun depuis le 2 octobre 2026 (OP-B1 : ADR-70 ; OP-B2 : ADR-66).

## 2. Points qui ne bloquent pas le code

### OP-N3 — Casse, taxes, caution acquise, correspondance SYSCOHADA

- **Questions.** La casse est-elle légale, après quel délai, et au profit de qui ? Taux et fait générateur des taxes sur frais et commissions ? Une caution acquise est-elle taxable ? La correspondance comptable indicative est-elle juste ?
- **Recommandation.** Coder avec les hypothèses actuelles, qui sont toutes paramétrables, puis faire valider par un expert-comptable SYSCOHADA avant la production. Questions détaillées : §3 (expert-comptable ; casse aussi au juriste).
- **Casse tranchée le 2 octobre 2026** (ADR-67) : réversible pendant 5 ans après le verrouillage ; reste à confirmer par l'expert-comptable et le juriste (si la date limite suffit : `late_claim_years = 0`).
- **Défaut codé.** TVA 18 % TTC ; casse à `refund_deadline`, partagée selon le contrat, réversible 5 ans ; caution acquise sans taxe ; `account_mapping` indicatif. **Bloque la production.**

### OP-N9 — Contestations de paiement par carte

- **Question.** Qui supporte une recharge par carte contestée quand le portefeuille est déjà dépensé ?
- **Options.** A : l'organisateur. B : le prestataire. C : selon le contrat. D : selon le contrat, avec une part au commerçant.
- **Recommandation.** C, l'organisateur par défaut, avec 3-D Secure obligatoire, un plafond de recharge par carte et par jour, et une alerte quand plusieurs cartes rechargent le même portefeuille. Le contrat doit porter la partie qui supporte les contestations.
- **Statut.** **Tranché le 2 octobre 2026** (ADR-77) : option C (selon le contrat, organisateur par défaut, avec 3-D Secure, plafond par carte et par jour, alerte multi-cartes) ; contestation tardive écrite dans le grand livre verrouillé.
- **Codé.** Le portefeuille est débité jusqu'à son solde et bloqué ; le reste va au compte de pertes de la partie désignée par `contract.chargeback_bearer`.

### OP-N11 — Région d'hébergement AWS

- **Préalables.** Mesurer la latence depuis Dakar vers Paris, l'Irlande, Milan et Le Cap, sur les réseaux Orange, Free et Expresso (protocole du banc). Obtenir l'avis d'un juriste sur la localisation des données (CDP, BCEAO).
- **Critère ajouté le 1er octobre 2026.** La région retenue DOIT proposer PostgreSQL 17 sur AWS RDS (ADR-55).
- **Statut.** Provisoire le 1er octobre 2026 : Paris (`eu-west-3`), ADR-65, à confirmer après ces deux préalables. La seconde région des sauvegardes reste à choisir.
- **Défaut codé.** Région paramétrable par prestataire, sauvegardes dans une seconde région. **Bloque la production.**

### OP-N12 — Durées de conservation des données

- **Question.** Combien de temps garder les historiques des festivaliers identifiés, pays par pays ?
- **Défaut codé.** Écritures comptables : 5 ans (à confirmer) ; données personnelles anonymisées 13 mois après la dernière activité. Paramètre `rules.retention_days`. **Bloque la production.**

### OP-N13 — Algorithme de signature des snapshots

- **Question.** Ed25519 si AWS KMS le propose dans la région retenue, sinon ECDSA P-256.
- **Défaut codé.** ECDSA P-256 (`ECC_NIST_P256`) ; l'algorithme et `key_id` sont dans l'en-tête, pour changer sans rupture. L'agent vérifie la disponibilité d'Ed25519 et ouvre une PR s'il est disponible.

### OP-N41 à OP-N47 — Dettes de sécurité de la mission des bracelets (13 octobre 2026)

Règle du projet (`CLAUDE.md`, « Écarts qui affaiblissent la sécurité ») : chaque écart accepté est nommé ici, avec son
risque, sa garde, ce qui le lève et la condition de levée. Les décisions correspondantes sont dans `DECISIONS_ADR.md`
(ADR-83 à ADR-92) : OP-N41, OP-N42, OP-N43 → ADR-88 ; OP-N44 → ADR-84 ; OP-N45 → ADR-83 ;
OP-N46 → ADR-85 ; OP-N47 → ADR-87.

Missions de levée d'OP-N41, OP-N44, OP-N45 et OP-N46 (15 octobre 2026, ADR-101) : proposées par
l'agent et
**confirmées par le porteur le 15/10/2026**, en remplacement de « porteur du projet » ou «
exploitation », qui ne sont pas des missions du découpage. Raisons :
- OP-N41 → mission 7 : première mission qui a besoin d'un vrai KMS pour autre chose que les bracelets (signature des
  snapshots, vérification d'Ed25519 dans KMS, OP-N13) ; l'adaptateur AWS des quatre ports s'y écrit avec celui de la
  signature, une fois la région arrêtée (OP-N11).
- OP-N44 → mission 5 : même correction de droits d'exécution sur les fonctions du schéma de référence que celle
  d'OP-N59 (`post-roles.sql`, générateur `gen_tests.py`), déjà confiée à la mission 5 (ADR-96).
- OP-N45 → mission 13 : l'aiguillage des routes relève du déploiement ; la recette V1 monte l'environnement proche de
  la production et y passe le test de cloisonnement sur toutes les routes.
- OP-N46 → mission 12 : elle ne part qu'après la validation de la puce sur de vrais bracelets (actions 1 et 2), qui
  fournit la clé publique NXP et des signatures réelles ; elle lit `READ_SIG` à chaque passage.

| Point | Dette | Risque si elle atteint la production | Garde en place | Levée par | Condition de levée |
|---|---|---|---|---|---|
| OP-N41 | Le service de clés est un faux (`apps/api/src/kms/fake-kms.ts`) : ses clés se dérivent d'une graine écrite dans le code | Tous les mots de passe de bracelets calculables par quiconque lit le code | Le faux refuse de se construire en production et la garde de démarrage refuse un processus qui le porte (`production-guard.spec.ts`) | **Mission 7** (hors ligne) : adaptateur AWS KMS, une fois la région et les comptes arrêtés (OP-N11) (confirmé par le porteur le 15/10/2026 ; ADR-101) | Les ports `MacPort`, `DataKeyPort`, `DecryptPort`, `KeyAdminPort` ont une implémentation AWS, avec un rôle IAM par processus (§3.2) |
| OP-N42 | L'identité du terminal est un faux qui croit des en-têtes ; aucune requête de terminal n'est signée | Quiconque se dit terminal obtient le mot de passe d'un bracelet et enregistre des lectures ; rejeu et falsification d'une lecture | Même garde de production ; le terminal annoncé est toujours relu en base (statut, prestataire) | Mission 5 (terminaux) | `DeviceIdentityPort` vérifie le jeton d'appareil, le mTLS et la signature de chaque requête ; le faux n'est plus câblé hors des tests |
| OP-N43 | L'identité du festivalier est un faux qui croit des en-têtes (routes concernées complétées par le plan de la mission 5b, 22/10/2026 : `payPaymentRequest`, `createCustomerQrToken`) | Rattachement d'un bracelet à solde nul par un tiers qui connaît son code ; paiement QR depuis l'app impossible en production tant que le faux reste seul | Même garde de production ; le compte annoncé est relu en base ; un bracelet approvisionné exige toujours la confirmation au guichet | Mission 10 (app festivalier) | `CustomerIdentityPort` vérifie un jeton de compte festivalier ; le faux n'est plus câblé hors des tests |
| OP-N44 | Les rôles `cashless_tagkeys`, `cashless_perso`, `cashless_tagcheck`, `cashless_keyadmin` héritent de `PUBLIC` le droit d'exécuter les fonctions d'API du schéma de référence (même limite que `cashless_platform`, ADR-80) | Un processus des clés compromis peut appeler ces fonctions pour un prestataire dont il pose l'identifiant — ni plus ni moins que le rôle de l'API publique | Aucun droit direct sur les tables du grand livre (`tests_media_roles.sql`) ; chaque fonction commence par `assert_tenant` | **Mission 5**, avec OP-N59 : modification du générateur de la suite de référence du kit (`gen_tests.py`) (confirmé par le porteur le 15/10/2026 ; ADR-101) | La suite de référence n'exige plus `EXECUTE` pour `PUBLIC` ; les droits d'exécution sont accordés rôle par rôle |
| OP-N45 | Les routes de la mission sont servies par trois processus (`x-process` du contrat) ; rien, dans le dépôt, n'aiguille une requête vers le bon | Une route de clés exposée par erreur sur l'API publique répondrait 404 (elle n'y est pas chargée) ; le risque est une indisponibilité, pas une fuite | Test d'isolation : chaque opération n'est servie que par son processus | **Mission 13** (recette V1) : aiguillage décrit et vérifié sur l'environnement de recette (confirmé par le porteur le 15/10/2026 ; ADR-101) | L'aiguillage par chemin est décrit et déployé ; `POST /media/auth-keys` et `/media-personalizations` n'atteignent que leur processus |
| OP-N46 | À la personnalisation, la signature d'originalité NXP est vérifiée par le poste, pas par le serveur, qui n'en garde que l'empreinte (comparée à chaque lecture) | Un poste compromis enregistre une puce contrefaite comme authentique | Rôle `PERSONALIZER` dédié ; toute personnalisation est tracée avec son auteur | **Mission 12** (app terminal), avec l'auditeur sécurité (ADR-44) (confirmé par le porteur le 15/10/2026 ; ADR-101) | Le kit fournit la clé publique NXP et des vecteurs de signature, et le serveur vérifie lui aussi |
| OP-N47 | Changer `CLAIM_CODE_HMAC_KEY` invalide toutes les empreintes de codes existantes ; aucune procédure de rotation | Une fuite de ce secret ne se répare qu'en réimprimant les codes | Le secret est hors de la base, obligatoire en production, 32 octets au moins | **Mission 10** (app festivalier) : proposée par l'agent le 16/10/2026, **à confirmer par le porteur** (ADR-104) ; elle reprend les flux qui lisent ces empreintes (rattachement, code de confirmation, consultation anonyme) | Une procédure de rotation (double empreinte pendant une période) est écrite et testée : un code émis sous l'ancien secret se rattache pendant la période, plus après |

**Levés le 21/10/2026 par la mission 5a (identite-enrolement-terminaux).**
- **OP-N42** : `DeviceIdentityPort` vérifie ensemble le jeton d'appareil lié, le certificat client (mTLS) et la
  signature de chaque requête (ADR-107) ; le faux n'est plus câblé hors des tests (`DEVICE_IDENTITY_FAKE=1`, refusé en
  production). Tests : `apps/api/test/integration/end-to-end/device-auth-matrix.spec.ts` (chaque route de terminal du
  contrat, refusée pour chaque preuve absente, fausse, expirée, d'un autre terminal, rejouée ou d'une autre autorité),
  `apps/api/test/unit/production-guard.spec.ts` (« terminal : identité réelle par défaut… »),
  `device-latency.spec.ts` (garde de production, un test par faux). L'autorité des terminaux et le signataire des
  jetons restent des faux, refusés en production : dette OP-N73 (mission 7).
- **OP-N44** : `post-roles.sql` retire `EXECUTE` à `PUBLIC` et l'accorde rôle par rôle ; la suite de référence
  (`gen_tests.py`) ne l'exige plus pour `PUBLIC`. Test : `packages/ledger-sql/tests/tests_execute_grants.sql` (listes
  figées par rôle, refus à l'appel). Limite résiduelle séparée : OP-N68 (ADR-111).

### OP-N48 — Fichier de commande des codes de rattachement perdu en route (13 octobre 2026)

Le fichier de commande d'un lot (`issueClaimCodeOrder`) n'est remis qu'une fois et n'est conservé nulle part : c'est
voulu (ADR-56, NFR-002). Conséquence : si la réponse se perd après la validation en base (coupure réseau, navigateur
fermé), les codes du lot existent sous forme d'empreintes mais plus personne ne les connaît, et aucune route ne permet
d'en tirer d'autres. Sortie actuelle : clore le lot (ses codes jamais associés sont invalidés) et en commander un
nouveau. Le porteur a laissé le choix à l'agent (13 octobre 2026) : **pas de route de nouvelle émission dans cette mission** ;
la sortie reste de clore le lot et d'en commander un autre. À revoir si le cas se présente en exploitation (une
nouvelle émission, permise tant qu'aucun code du lot n'est associé à une puce, ne conserverait toujours rien).
Limites posées dans le même lot, à confirmer : import du fichier de l'imprimeur par envois de 10 000 lignes et 1 Mo
au plus.

### OP-N49 — Caution en espèces et espèces dues : pas de caisse avant la mission des caisses (13 octobre 2026)

Une caution payée à part en espèces, et le rendu des espèces dues, s'écrivent sur le compte de caisse du terminal
(`A-CAISSE-<n° de série>`). Ces comptes et leurs sessions (ouverture, comptage, fermeture) sont livrés par la mission
« Recharges, caisses et PSP ». **Décision du porteur n° 10 (13 octobre 2026, option A)** : la mission des bracelets
ne crée aucun compte de caisse. Les routes sont livrées et testées (compte posé par les tests) ; en usage réel elles
répondent `409` « aucune caisse ouverte pour ce terminal » tant que la mission des caisses n'a pas ouvert le compte.
Aucun argent liquide n'entre donc sans session de caisse. À la charge de la mission des caisses : créer le compte à
l'ouverture d'une session, sous ce code, ou adapter la recherche du compte (`counter-access.ts`). Décision : ADR-89.

### OP-N50 — Rattachement par code : trois décisions et une limite (14 octobre 2026)

Décisions du porteur prises pendant le lot 17 (rattachement par code imprimé), consignées dans l'ADR-90 :

- **n° 11 — Consultation anonyme réduite** : `lookupBalanceByClaimCode` ne rend que ce que rend
  `public_balance_lookup` (devise, solde disponible, statut, et pour chacun des 10 derniers mouvements : date, type,
  montant). Le contrat demandait aussi la répartition payé/offert et l'identifiant, la source et le libellé de chaque
  écriture ; il est réduit (`openapi.yaml`). Renforcement : moins de données sur une route sans authentification.
- **n° 12 — Lecture consommée par la demande confirmée** (migration 0016) : `consume_tap` exige une écriture
  comptable et un rattachement n'en fait aucune. `consume_tap_for_claim` lie la lecture à la demande : une lecture
  récente, du bracelet de la demande, jamais déjà consommée, ne confirme qu'une demande.
  **Limite** : `consume_tap` (schéma de référence, non modifiable) ignore ce lien ; une lecture qui a confirmé une
  demande peut encore servir à une écriture pendant la fenêtre de l'événement (120 s par défaut). Risque faible :
  une même présentation du bracelet sert à un rattachement puis à une opération du même bracelet. Test qui échoue si
  la limite s'élargit : `tests/tests_media_claim_tap.sql`. **Levée par la mission 5** (confirmé par le porteur le
  15/10/2026 ; ADR-101) : c'est elle qui sert le paiement par `register_tap`,
  `post_transaction` et `consume_tap` et touche donc ce chemin. **Condition de levée** : `consume_tap` refuse une
  lecture liée à une demande de rattachement (migration, ou évolution du schéma de référence par son générateur) ;
  test pgTAP : lecture qui a confirmé une demande refusée par `consume_tap`. Fichier SQL à faire relire par une
  personne.
- **n° 13 — Activation depuis l'app (`SELF_APP`)** : un code valide d'un bracelet jamais activé l'active sur un
  portefeuille du festivalier si l'événement autorise `SELF_APP`, que le lot sert un seul événement et qu'il n'a pas
  de caution payée à part ; sinon refus, essai compté.
- **Limite du n° 12 levée le 21/10/2026 par la mission 5a** (WP05, migrations 0024 et 0026) : `consume_tap` refuse une
  lecture liée à une demande de rattachement, en ligne comme hors ligne, et la lecture d'une demande ne s'écrit plus
  directement. Tests : `packages/ledger-sql/tests/tests_consume_tap_claim.sql` (sections 1 à 7, chaque refus avec son
  témoin) ; course entre une écriture et une demande sur la même lecture (verrou `media-tap-use:`) :
  `apps/api/test/integration/media/tap-claim-race.spec.ts`. ADR-90 et ADR-101 complétés.

### OP-N51 — Guichet de retour : enchaînement des étapes, rattaché à la mission 9 (14 octobre 2026, décidé le 15)

`openapi.yaml` (`releaseMedia` avec `settle_balance`, `refund_deposit_by`) décrit un enchaînement complet du guichet de
retour par le serveur ; le plan de la mission des bracelets le renvoie à la mission 9. Provisoire : la restitution est
servie sans enchaînement, ces champs sont refusés en `422` (règle `release.no_chaining`).
**Décision du porteur du 15/10/2026 (ADR-91, acceptée)** : la mission 9 sert l'enchaînement, le contrat reste
inchangé. Point encore ouvert, rattaché à la mission 9 ; il ne bloque pas la mission des bracelets.

### OP-N52 à OP-N55 — Constats des relectures indépendantes de la mission des bracelets (14 octobre 2026)

Relevés par les relectures indépendantes des lots 16 à 19 ; corrigé dans la mission tout ce qui renforçait la sécurité
sans décision (voir le compte rendu du lot 20). OP-N52 et OP-N53 sont levés le 15/10/2026 (décision du porteur,
lot 20, cycle 3) ; OP-N54 et OP-N55 restent ouverts ; leur fiche est complétée le 15/10/2026 sous le tableau (ADR, mission, condition de levée).

| Point | Constat | Risque | En place | Proposition |
|---|---|---|---|---|
| OP-N52 (**levé** le 15/10/2026, avec une limite résiduelle : OP-N56 ; migration `0017_media_reinstate_approval.sql`, ADR-94 ; tests `tests/tests_media_reinstate.sql`, `blacklist.spec.ts`) | La base ne vérifiait pas le valideur d'une sortie de liste noire : `reinstate_media` croit le valideur qu'on lui passe, et `check_media_transition` compare deux réglages de session posés par l'appelant ; `cashless_app` a `UPDATE (status)` sur `media` | Avec la connexion de l'API (défaut d'une autre route, injection), une seule personne sort un bracelet de liste noire en inventant un valideur | L'API n'appelle `reinstate_media` que depuis l'action approuvée `REINSTATE_MEDIA` (lien à l'épisode de liste noire, une seule demande en attente) ; réglages de session remis à vide après l'appel | Migration : `reinstate_media` exige une `approval_request` `REINSTATE_MEDIA` approuvée pour ce bracelet (auteur et valideur concordants) et le déclencheur refuse `BLACKLISTED → ACTIVE` hors de ce chemin ; ou retirer `UPDATE (status)` au profit de fonctions dédiées. Fichiers à relire : `schema_grand_livre_cashless.sql` (`reinstate_media`, `check_media_transition`), `post-roles.sql` |
| OP-N53 (**levé** le 15/10/2026 : `TRUST_PROXY_HOPS`, obligatoire en production, ADR-95 ; tests `claims-address-limit.spec.ts`, `config.spec.ts`, `processes.spec.ts`) | La limite de la consultation anonyme par adresse (60 par heure) reposait sur `req.ip`, sans réglage `trust proxy` | Derrière un répartiteur : toutes les adresses se confondent (limite globale, déni de service facile) ; `trust proxy` sans borne : `X-Forwarded-For` falsifiable, limite contournée | Limite par code (20 par heure) ; empreinte d'adresse à clé | Fixer explicitement la source de l'adresse (`trust proxy` limité au nombre de sauts du déploiement), et un test « 61ᵉ consultation de la même adresse → 429 » |
| OP-N54 | Le registre d'idempotence garde l'empreinte `request_hash` (SHA-256 sans clé) de la requête, qui contient le code imprimé (50 bits) | Une fuite de la base permet de retrouver un code par essais hors ligne (calcul lourd mais faisable) | Le code lui-même n'est jamais conservé ; les codes de confirmation ne sont plus conservés (route `transient`) | Empreinte de requête à clé (HMAC) dans le registre (mission 1), ou exclusion du code de l'empreinte pour ces routes |
| OP-N55 | `replace_media` ne fait pas suivre au bracelet neuf les espèces dues (anomalies `CASH_TOPUP_OVER_LIMIT`) de l'ancien | Des espèces dues sur un bracelet remplacé ne peuvent plus être rendues au guichet (bracelet `REPLACED`, rendu refusé) | Aucune perte comptable : la dette reste au grand livre (`L-ESP-A-RENDRE`) | Faire suivre les anomalies au remplacement (migration), ou un rendu au back-office sur décision de deux personnes (mission 9) |

**OP-N54 — fiche complétée le 15/10/2026 (ADR-99).**
- **Mission qui le lève : mission 5** (terminaux et paiement en ligne), confirmé par le porteur le 15/10/2026. Raison : c'est la prochaine mission de paiement ; elle ajoute des routes au registre d'idempotence
  (`POST /payments`, etc.) et touche donc `api_idempotency` et l'intercepteur qui calcule `request_hash`.
- **Condition de levée.** `request_hash` est une empreinte à clé (HMAC, secret hors de la base, comme
  `CLAIM_CODE_HMAC_KEY`), ou les champs secrets (code imprimé, code de confirmation) sont exclus de l'empreinte des
  routes qui les portent ; test : l'empreinte d'une requête de rattachement ne se recalcule pas à partir du code seul.
- **Test qui échoue si la limite s'élargit** : `apps/api/test/integration/end-to-end/media-secrets.spec.ts` (aucun code
  imprimé ni code de confirmation, en clair, hexadécimal ou base64, dans aucune colonne de la base, `api_idempotency`
  compris). Il ne fige pas l'empreinte elle-même : l'empreinte sans clé est le manque, pas un droit qui pourrait
  s'élargir.

**OP-N54 — levé le 21/10/2026 par la mission 5a (WP13, WP18 ; ADR-99).** `request_hash` est un HMAC sous
`IDEMPOTENCY_HMAC_KEY` (secret hors de la base, obligatoire en production), sans préfixe ; l'empreinte de
personnalisation (`personalizationHash`) aussi. Tests : `apps/api/test/unit/idempotency/request-hash.spec.ts`
(« requestHash (OP-N54) »), `apps/api/test/unit/media/personalization-hash.spec.ts`,
`apps/api/test/integration/media/personalization.spec.ts` (« registre d'idempotence : empreinte à clé liée à la
personne, jamais un SHA-256 sans clé (OP-N54) »), `media-secrets.spec.ts`, `device-secrets.spec.ts`.
**Consigne de déploiement (décision du porteur du 21/10/2026, option a)** : les lignes `api_idempotency` écrites
avant la mise en service (empreinte sans clé, ou modèle de route : OP-N71) sont purgées par le propriétaire de la base
à T + `IDEMPOTENCY_TTL_HOURS` (720 h), T étant l'heure du déploiement :
`DELETE FROM api_idempotency WHERE created_at < T` ; vérifier ensuite que ce compte est nul. D'ici là, un rejeu en vol
d'une requête antérieure reçoit `409 IDEMPOTENCY_KEY_REUSED` au lieu de la réponse enregistrée.

**OP-N55 — fiche complétée le 15/10/2026 (ADR-100).**
- **Mission qui le lève : mission 9** (remboursements, versements et clôture), déjà retenue au checkout principal ;
  report fait aussi dans `PROMPTS-A-ENVOYER.md` et `PRD.md` de cette branche. Raison : elle sert les remboursements
  et le guichet de retour, dont le rendu des espèces dues.
- **Condition de levée.** Les espèces dues d'un bracelet remplacé se rendent : soit `replace_media` fait suivre les
  anomalies `CASH_TOPUP_OVER_LIMIT` au bracelet neuf (migration), soit un rendu au back-office sur décision de deux
  personnes ; test : espèces dues d'un bracelet `REPLACED` rendues une fois, et une seule.
- **Test.** Aucun test ne fige ce manque : ce n'est pas un droit qui peut s'élargir mais une opération absente ; la
  dette reste au grand livre (`L-ESP-A-RENDRE`), dont les soldes sont vérifiés par les suites pgTAP du kit.

### OP-N56 — Décision d'une demande d'approbation : la personne qui décide n'est pas authentifiée par la base (15 octobre 2026)

Limite résiduelle d'ADR-94 (levée d'OP-N52), consignée à la relecture du lot 20, cycle 3 (règle 3 de `CLAUDE.md`).

- **Risque.** `decide_approval_request(id, decided_by, approve, ...)` croit l'identifiant de valideur qu'on lui passe :
  la base ne sait pas authentifier une personne. Une session de l'API compromise (défaut d'une autre route, injection)
  peut donc créer une demande `REINSTATE_MEDIA` au nom d'un superviseur réel, la faire décider au nom d'un second
  superviseur réel du même prestataire, puis appeler `reinstate_media` : un bracelet sort de liste noire sans que
  deux personnes l'aient voulu. Même limite pour toute autre action à deux décidée par `approval_request`.
- **En place.** L'API ne décide une demande que pour la personne authentifiée par le serveur d'identité (jeton court,
  rôle relu en base, valideur ≠ auteur). La base exige, depuis la migration 0017 : une demande `REINSTATE_MEDIA`
  APPROVED du même prestataire, pour ce bracelet et l'épisode de liste noire en cours ; auteur et valideur distincts,
  personnes ACTIVE du prestataire ; valideur `SUPERVISOR` non révoqué ; demande née `PENDING`. Un valideur inventé ou
  non habilité est refusé. Depuis le lot 20, cycle 4 : les règles de passage (`media_transition`) ne sont plus modifiables
  par `cashless_app` (aucun contournement par un autre état). Depuis le cycle 5 (migration 0018) : l'historique des
  statuts (`media_status_history`, `media_batch_status_history`) n'est écrit que par ses déclencheurs, SECURITY
  DEFINER ; `cashless_app` n'y a ni `INSERT`, ni `UPDATE`, ni `DELETE`. Une session de l'API ne peut donc ni masquer
  l'épisode en cours ni planter une fausse mise en liste noire pour figer « l'épisode en cours » : la demande d'un
  épisode passé ne redevient pas concordante. Même fermeture sur `media_assignment` (clés d'idempotence du
  préchargement et des cautions, portefeuille débité) et `device_config_served` (configuration servie en cours). Chaque décision est journalisée
  (`audit_log`, chaîné et scellé).
- **Mission qui le lève.** Mission 11 (back-office web), où se prennent les décisions, avec le serveur d'identité réel
  (produit à choisir, PRD §4) : la décision porte une preuve signée par le serveur d'identité (jeton d'approbation
  d'ADR-74 : `sub` = valideur, `act`, `act_hash`, `jti` à usage unique) ou une signature de la décision par le
  valideur, vérifiée hors de la session de l'API et conservée avec la décision.
- **Condition de levée.** Une décision de demande d'approbation n'est enregistrée qu'avec une preuve que la session de
  l'API ne peut pas fabriquer seule (signature du serveur d'identité ou du valideur, vérifiée par une clé publique que
  l'API ne détient pas en écriture), et un test montre qu'une décision sans preuve, ou avec la preuve d'une autre
  personne ou d'une autre demande, est refusée.
- **Tests qui bornent la limite aujourd'hui** (ils échouent si elle s'élargit) : `tests/tests_media_reinstate.sql`
  (valideur inventé, valideur caissier, auteur et valideur inversés, épisode passé, historique masqué, ligne plantée
  dans l'historique puis réutilisation au nouvel épisode, détour par un autre état : refusés ; droits de `cashless_app`
  sur les historiques et les règles de passage ; droits d'écriture de tous les rôles de l'application sur les
  historiques de statut, `media_assignment` et `device_config_served`), `blacklist.spec.ts`.
- **Attribution de l'historique** (remarque 2 de la relecture du cycle 5, préexistante). L'auteur, le valideur et le
  motif portés par `media_status_history` et `media_batch_status_history` (`actor_id`, `approved_by`, `reason`) sont
  lus dans des réglages de session (`app.user_id`, `app.approved_by`, `app.reason`) que l'appelant fixe : une session
  de l'API compromise peut donc attribuer un passage réel à un valideur inventé ou à une autre personne. Cela ne
  débloque aucune règle (la sortie de liste noire exige une demande approuvée concordante, migration 0017) ; la trace
  n'est pas une preuve d'identité, au même titre que la décision elle-même. Levée avec ce point (mission 11).

- **Même limite à l'enrôlement des terminaux (revue post-fusion de la mission 5a, SEC-2, 21/10/2026).**
  `enroll_device` (migration 0022) croit l'auteur (`p_actor`) et accepte tels que l'API les donne les clés publiques,
  l'empreinte du certificat et le type d'attestation : la base ne prouve ni l'attestation ni l'auteur. Une session de
  l'API compromise pourrait créer un terminal aux clés choisies ; il resterait inutilisable sans certificat de
  l'autorité des terminaux ni jeton du signataire, deux clés hors de la base (barrière réelle, OP-N73 pour leurs
  adaptateurs). Renforcement décidé le même jour : retirer à `cashless_app` la lecture de
  `device_enrollment_code.code_hash` (correctif post-fusion de la mission 5a). **Fait le 22/10/2026** (`814710c`,
  aussi pour `device_enrollment_attempt.code_hash` ; test `tests_device_rights.sql` §1 bis) : une session compromise
  ne lit plus d'empreinte de code. La confiance dans l'auteur et les preuves reste, avec ce point (mission 11).

### OP-N57 — `offline_snapshot` : version plantée, déni de service hors ligne (15 octobre 2026)

Faiblesse du kit, antérieure à la mission 4, relevée à la relecture du lot 20, cycle 5 (remarque 1) ; consignée au
cycle 6 sans changement de comportement (décision de l'orchestrateur : les tables appartiennent à la mission 7).

- **Risque.** `cashless_app` est l'écrivain légitime de `offline_snapshot` (`INSERT` donné par `roles.sql`) et choisit
  la version. `check_offline_snapshot` n'exige qu'une version strictement croissante par grand livre : une session de
  l'API compromise (défaut d'une autre route, injection) qui insère un snapshot d'une version très grande (jusqu'à la
  borne de `bigint`) bloque toute version suivante de ce grand livre. Les terminaux ne reçoivent plus de snapshot à
  jour : déni de service du paiement hors ligne pour l'événement, et snapshots périmés gardés plus longtemps.
- **En place.** Lignes immuables (`offline_snapshot_immutable` : ni `UPDATE` ni `DELETE`), `DELETE`/`TRUNCATE` retirés à
  tous les rôles de l'application ; le déclencheur exige aussi le prestataire du grand livre, une clé de signature
  `ACTIVE` du central, l'époque d'autorité courante et un en-tête signé égal aux colonnes ; RLS `tenant_isolation`. Seul
  `cashless_app` y écrit (`INSERT`, et `UPDATE` refusé par le déclencheur). Aucun code de l'API n'écrit encore cette
  table (mission 7).
- **Mission qui le lève.** Mission 7 (hors ligne, snapshots et lots).
- **Condition de levée.** Un snapshot ne s'inscrit que par une fonction (SECURITY DEFINER, ou rôle dédié) qui calcule
  elle-même la version (dernière version + 1) ; `INSERT` direct retiré à `cashless_app` (ou borné par une politique
  restrictive équivalente) ; un test montre qu'une version choisie par l'appelant (très grande ou non contiguë) est
  refusée et que le snapshot suivant reste possible.
- **Test qui borne la limite aujourd'hui** (il échoue si elle s'élargit) : `tests/tests_definer_trigger_writers.sql`
  (liste exacte des droits d'écriture des rôles `cashless_*` sur `offline_snapshot` : `INSERT` et `UPDATE` de
  `cashless_app` seulement ; aucune suppression ; déclencheurs de contrôle et d'immuabilité présents).

### OP-N58 — `offline_policy_history` : trace falsifiable (15 octobre 2026)

Même origine qu'OP-N57 (kit, antérieure à la mission 4 ; relecture du lot 20, cycle 5, remarque 1 ; consignée au
cycle 6 sans changement de comportement).

- **Risque.** `log_offline_policy` écrit l'historique des politiques hors ligne avec les droits de l'appelant : le rôle
  qui modifie `offline_policy` doit donc avoir `INSERT` sur `offline_policy_history`, et peut y écrire n'importe quelle
  ligne de son prestataire. Une session de l'API compromise peut y planter une fausse version d'une politique (plafonds,
  auteur, date de début) : la trace des plafonds hors ligne devient falsifiable, et une version plantée en avance
  (`UNIQUE (policy_id, version)`) fait échouer la modification légitime suivante de cette politique.
- **En place.** Lignes immuables (`offline_policy_history_immutable`) ; `DELETE`/`TRUNCATE` retirés à tous les rôles de
  l'application ; RLS `tenant_isolation`. Aucune règle de la base ne lit cette table : le contrôle « plafonds en
  vigueur » (`policy_in_force`) lit la configuration servie (`device_config_served`, écrite par `record_config_served`
  seule, fermée en écriture à `cashless_app` au lot 20, cycle 5). Aucun code de l'API n'écrit encore les politiques
  hors ligne (mission 7).
- **Mission qui le lève.** Mission 7 (hors ligne), qui sert les politiques hors ligne.
- **Condition de levée.** `log_offline_policy` passe en SECURITY DEFINER (`search_path` fixé, comme `log_media_status`
  en migration 0018) et `INSERT` sur `offline_policy_history` est retiré à `cashless_app` ; un test montre qu'une ligne
  insérée directement est refusée et qu'une modification de politique écrit toujours son historique.
- **Test qui borne la limite aujourd'hui** : `tests/tests_definer_trigger_writers.sql` (liste exacte des droits
  d'écriture des rôles `cashless_*` sur `offline_policy_history` : `INSERT` et `UPDATE` de `cashless_app` seulement ;
  aucune suppression ; `log_offline_policy` aux droits de l'appelant, comportement inchangé dans la mission 4).
- **Bloque la production : oui** (décision du porteur du 15/10/2026, relecture du lot 20, cycle 6, remarque 1). Comme
  OP-N57, une version plantée en avance est un déni de service (la modification légitime suivante de la politique
  échoue) ; il est levé avant la production, avec la mission 7.

### OP-N59 — Fonctions SECURITY DEFINER : tables masquées par une table temporaire de l'appelant (15 octobre 2026)

Relevé au lot 20, cycle 7, en passant `register_personalized_media` en SECURITY DEFINER. Antérieur à la mission 4 :
toutes les fonctions SECURITY DEFINER du schéma de référence et des migrations fixent `SET search_path = public`.
**Tranché par le porteur le 15/10/2026 (ADR-96) ; aucun changement de comportement hors du lot 20.**

- **Risque.** Quand `pg_temp` n'est pas nommé dans `search_path`, PostgreSQL cherche les tables **d'abord** dans le
  schéma temporaire de la session. Tous les rôles `cashless_*` ont le droit `TEMP` sur la base (accordé à `PUBLIC` par
  défaut). Une session compromise crée une table temporaire du même nom qu'une table lue ou écrite par une fonction
  SECURITY DEFINER, et la fonction lit ou écrit la table temporaire avec les droits du propriétaire. Démontré en base
  (`scratchpad/wp20c7/pgtemp2.sql`, transaction annulée) : `cashless_app` crée `pg_temp.media_status_history`, puis
  `UPDATE media SET status = 'BLACKLISTED'` ; la ligne d'historique part dans la table temporaire, l'historique réel
  n'a pas la mise en liste noire (avant la migration 0019). Même chose pour un contrôle qui lit une table (lot, clé,
  grand livre) : la fonction voit les lignes choisies par l'appelant.
- **Conséquence probable : contournement du cloisonnement entre prestataires** (relecture du cycle 7, constat 2).
  `tenant_of_ledger`, `tenant_of_media`, `tenant_of_wallet`, `tenant_of_batch`, `tenant_of_event`, `tenant_of_device`
  et `tenant_of_gateway` sont SECURITY DEFINER, sans `pg_temp`, et lisent une table pour trouver le prestataire d'un
  objet. Elles alimentent `assert_tenant` (SECURITY INVOKER) dans les fonctions qui déplacent de l'argent ou changent
  un bracelet, par exemple `post_transaction` (`assert_tenant(tenant_of_ledger(p_ledger))`). Une table temporaire
  `ledger` de l'appelant ferait rendre le prestataire de la session pour un grand livre d'un autre prestataire, et le
  contrôle passerait. **Non démontré de bout en bout** : risque probable, écrit comme tel.
- **En place.** Migration 0019 : `register_personalized_media`, `associate_claim_code`, `log_media_status` et
  `log_batch_status` ont `search_path = public, pg_temp` (test : `tests/tests_personalization_definer.sql`, tables
  temporaires `media_batch` et `tag_data_key` ignorées). Les **77** autres fonctions SECURITY DEFINER du schéma
  `public` (81 au total au 15/10/2026) ne l'ont pas, dont les `tenant_of_*` ci-dessus, `post_transaction`,
  `activate_media`, `retire_dedicated_key`, les fonctions d'identité et d'audit. `assert_tenant` n'en fait pas partie
  (SECURITY INVOKER).
- **Options.** (A) retirer `TEMPORARY` sur la base à `PUBLIC` et aux rôles `cashless_*` dans `post-roles.sql` (une
  ligne ; vérifier qu'aucun rôle applicatif n'utilise de table temporaire) ; (B) migration qui passe toutes les
  fonctions SECURITY DEFINER du schéma `public` à `search_path = public, pg_temp`, avec un test qui liste celles qui
  ne l'ont pas ; (C) les deux.
- **Décision du porteur (15/10/2026, ADR-96).** Défaut consigné, non corrigé dans la mission 4 ; **levé par la
  mission 5** (prochaine mission qui touche la base) ; **bloque la production : oui**.
- **Mission qui le lève.** Mission 5 (terminaux et paiement en ligne) : retirer `TEMPORARY` aux rôles applicatifs
  (option A) ou passer toutes ces fonctions à `search_path = public, pg_temp` (option B), ou les deux.
- **Condition de levée.** Option retenue appliquée, et un test pgTAP : table temporaire de l'appelant sans effet sur
  une fonction SECURITY DEFINER prise au hasard (un `tenant_of_*` au moins), ou création de table temporaire refusée à
  chaque rôle `cashless_*` ; avec l'option B, le compte du test ci-dessous tombe à 0 et devient une égalité.
- **Test qui borne la limite aujourd'hui** (il échoue si elle s'élargit) : `tests/tests_definer_trigger_writers.sql`,
  section 4 : au plus 77 fonctions SECURITY DEFINER du schéma `public` sans `pg_temp` dans leur `search_path`.
- **Levé le 21/10/2026 par la mission 5a (options A et B ; WP02, WP07).** Migration 0021 : toute fonction SECURITY
  DEFINER du schéma `public` finit son `search_path` par `pg_temp` ; `post-roles.sql` retire `TEMPORARY` à `PUBLIC` et
  aux rôles `cashless_*`. Tests : `tests/tests_definer_search_path.sql` (table temporaire de l'appelant sans effet sur
  chaque `tenant_of_*`, témoin aux réglages d'avant 0021), `tests/tests_device_rights.sql` §5 (tables temporaires
  refusées à chaque rôle `cashless_*`), `tests/tests_definer_trigger_writers.sql` §4 (borne passée de 77 à une égalité
  à 0).

### OP-N60 — `cashless_app` contourne par accès direct des contrôles de fonctions INVOKER (15 octobre 2026)

Relevé au lot 20, cycle 7 (recherche demandée par le porteur : « les autres fonctions qui contrôlent ce qu'un rôle de
processus pourrait aussi faire par un accès direct à la table »). Les rôles des processus des clés n'ont plus de cas
(voir ADR-94, complément du cycle 7) ; restent ceux du rôle de l'API. **Tranché par le porteur le 15/10/2026 (ADR-97) ; non corrigé ici**, la
correction change des routes de l'API hors du lot 20.

- **Risque.** `roles.sql` rend `INSERT` et `UPDATE` sur toutes les tables à `cashless_app` ; `post-roles.sql` ne les
  borne pas sur `media_batch` (toutes les colonnes). Une session de l'API compromise peut : insérer un lot directement
  au statut `ACTIVE` ou `CLOSED`, sans passer par `ORDERED → PERSONALIZED → DELIVERED` (vérifié par la relecture du
  cycle 7 : `INSERT 0 1` dans les deux cas) ; passer un lot à `CLOSED` directement (le passage est permis par
  `media_batch_transition`) sans `close_batch`, donc sans acquérir les cautions ni retirer les bracelets, alors que
  `set_media_batch_status` refuse `CLOSED` ; changer `quantity`, `key_index`, `organizer_id` ou `event_id` d'un lot ;
  et changer le statut d'un bracelet sans motif (`media_set_status` exige un motif ; l'historique garde un motif
  vide). Vérifié en base (`scratchpad/wp20c7/opn60.sql`, transaction annulée) : `UPDATE media_batch SET quantity =
  500` et `SET status = 'CLOSED'` passent depuis `cashless_app`, alors que `set_media_batch_status(…, 'CLOSED', …)` est
  refusé ; `UPDATE media SET status = 'BLACKLISTED'` passe et l'historique garde un motif nul. Une quantité relevée
  par l'API laisse aussi la personnalisation enregistrer au-delà de la commande (la fonction lit la quantité du lot).
  La RLS borne tout cela au prestataire de la session ; les passages de statut restent ceux des tables de passage.
- **En place.** RLS `tenant_isolation` ; déclencheurs de passage (`check_media_transition`, `check_batch_transition`,
  `check_media_batch_key`) ; historiques écrits par leurs seuls déclencheurs (0018). L'API crée un lot par `INSERT`
  direct (`apps/api/src/media/batches/batches.service.ts:68`) et change son statut par `set_media_batch_status` et
  `close_batch` : un droit `INSERT` ne peut donc pas être retiré sans changer la création.
- **Options.** Borner `UPDATE` de `media_batch` par colonne (`status` seul, ou aucun avec une fonction SECURITY
  DEFINER pour chaque passage) et refuser `CLOSED` hors de `close_batch` par une politique restrictive ou un
  déclencheur ; passer `media_set_status` en SECURITY DEFINER et retirer `UPDATE (status)` de `media` à l'API.
- **Décision du porteur (15/10/2026, ADR-97).** Défaut consigné, non corrigé dans la mission 4 ; **levé par la
  mission 11** (back-office) ; **bloque la production : oui**.
- **Condition de levée.** Option retenue appliquée (création d'un lot par une fonction qui impose le statut `ORDERED`,
  ou politique restrictive sur l'`INSERT`) ; test pgTAP depuis `cashless_app` : lot inséré directement en `ACTIVE` ou
  en `CLOSED` refusé, `UPDATE media_batch SET status = 'CLOSED'` et `SET quantity = …` refusés, statut de bracelet
  sans motif refusé.
- **Test qui borne la limite aujourd'hui** (il échoue si elle s'élargit) : `tests/tests_definer_trigger_writers.sql`,
  section 4 : droits de `cashless_app` sur `media_batch` figés colonne par colonne (`INSERT`, `SELECT`, `UPDATE` ;
  aucune suppression).

### OP-N61 — Traitements par tranches (NFR-008) : preuve sur 5 000 bracelets manquante (15 octobre 2026)

Relevé par la vérification d'acceptation de la mission 4 (`acceptance-matrix.json`, 45 critères sur 46 en `pass`,
NFR-008 en échec). **Écart consigné par décision du porteur du 15/10/2026 (ADR-98).**

- **Exigence.** NFR-008 : la clôture d'un lot, le rattrapage du préchargement et le rechiffrement traitent au plus 500
  bracelets par tranche, peuvent être relancés sans double effet, et vont au bout sur un lot de 5 000 bracelets.
- **Ce qui est prouvé.** Tranches de 500 (`FORFEIT_SLICE`, `PRELOAD_SLICE`, `batches.service.ts`) et relance sans
  double effet : clôture sur 600 cautions, deux relances (`apps/api/test/integration/media/batches.spec.ts`) ;
  rechiffrement de 1 200 bracelets en 3 tranches, avec reprise après interruption
  (`apps/api/test/integration/media/data-keys.spec.ts`).
- **Ce qui manque.** Aucun test sur un lot de 5 000 bracelets ; le rattrapage du préchargement n'est testé que sur 3
  bracelets, sans atteindre une tranche (`PRELOAD_SLICE` jamais atteint).
- **Risque.** Une clôture, un rattrapage ou un rechiffrement qui n'irait pas au bout sur un gros lot (durée,
  `transaction_timeout` de 60 s, verrous) en exploitation : lot bloqué à mi-chemin, cautions non acquises ou bracelets
  sous l'ancienne clé de données. Le découpage en tranches et la reprise limitent ce risque sans le mesurer.
- **Mission qui le lève : mission 13** (recette V1), décision du porteur. **Condition de levée** : test sur un lot de
  5 000 bracelets pour les trois traitements (clôture, rattrapage du préchargement au-delà d'une tranche,
  rechiffrement), chacun allant au bout, avec au moins une relance sans double effet ; durées consignées dans le
  rapport de recette.
- **Bloque la production : oui** (la preuve est attendue de la recette, qui précède la production).
- **Pas de test qui fige la limite.** La limite est un manque de preuve, pas un droit ni un contrôle retiré : rien ne
  peut « s'élargir » qu'un test puisse borner. Les tests existants (`batches.spec.ts`, `data-keys.spec.ts`) échouent
  déjà si le découpage ou la reprise régressent.

### OP-N62 — Retrait d'une clé dédiée par la personnalisation sans travail (16 octobre 2026)

Limite résiduelle de la correction de SEC-1 (revue post-fusion de la mission 4, correctif
post-fusion n° 1, ADR-102), consignée selon la règle 3 de `CLAUDE.md`.

- **Risque.** `retire_dedicated_key` (schéma de référence, SECURITY DEFINER) retire une clé dédiée
  dont tous les lots sont clos : clé et clés de données retirées, mots de passe effacés, bracelets
  en fin de vie. Elle ne vérifie pas qu'un travail `RETIRE_KEY` approuvé est en cours. Depuis la
  migration 0020, seul `cashless_perso` peut l'appeler (l'API et `PUBLIC` ne le peuvent plus) : un
  processus de personnalisation compromis retirerait une clé dédiée sans décision à deux. Le modèle
  de menace retenu par la mission (connexion de l'API compromise) n'est plus concerné.
- **En place.** `EXECUTE` retiré à `PUBLIC` et à `cashless_app` ; la personnalisation n'exécute
  `RETIRE_KEY` qu'après la revérification de la demande (`TagKeyJobGate`) ; la désactivation dans le
  KMS qui suit n'est acceptée que pour une clé `RETIRED` après un retrait approuvé.
- **Mission qui le lève : mission 5**, avec OP-N44 (droits d'exécution des fonctions du schéma
  accordés rôle par rôle) — **confirmé par le porteur le 16/10/2026**. Condition de levée
  : `retire_dedicated_key` n'est plus appelable que par une fonction qui exige un travail
  `RETIRE_KEY` `RUNNING` de la même clé, issu d'une demande exécutée (ou la vérification est ajoutée
  par migration à une fonction de remplacement) ; test : appel sans travail refusé.
- **Test qui échoue si la limite s'élargit** : `tests/tests_tag_key_job_approval.sql` (droit
  d'exécution de `retire_dedicated_key` : personnalisation seulement ; refusé à `PUBLIC`, à l'API, à
  la plateforme, aux clés de bracelet et à la commande d'administration).
- **Seconde limite, délai d'une demande approuvée (confirmée par le porteur le 16/10/2026,
  mission 5, ADR-102 complété).** `enqueue_tag_key_job` ne lit pas `expires_at` : une demande
  `APPROVED` jamais exécutée sert encore plus tard, une seule fois (index uniques). La mission 5
  la fait refuser une fois `expires_at` dépassé. Test qui documente le comportement actuel :
  `tests/tests_tag_key_job_approval.sql`, section 6 (à inverser à la levée).
- **Levé le 21/10/2026 par la mission 5a (WP06, migration 0025, puis droits de WP07 ; ADR-102).** Le retrait d'une
  clé dédiée exige le travail `RETIRE_KEY` `RUNNING` de la même clé, et une demande approuvée périmée est refusée
  (`CL023`). Test : `tests/tests_tag_key_retire_guard.sql` (sections 2 à 4 : demande périmée refusée, retrait par le
  travail en cours, refus sans travail).

### OP-N63 — Clé d'accord d'un terminal réécrite par l'API (16 octobre 2026)

Signalé par le correctif post-fusion n° 1 en cherchant les autres entrées qu'un processus des clés
consomme après qu'une autre connexion les a déposées (consigne 6). **Écart accepté, bloque la
production : oui, levé par la mission 5 (enrôlement réel des terminaux) ; confirmé par le porteur
le 16/10/2026 ; ADR-105.**

- **Constat.** `roles.sql` (kit) accorde à `cashless_app` `UPDATE (agreement_public_key)` sur
  `device`. Le processus des clés de bracelet (`POST /media/auth-keys`) chiffre le mot de passe d'un
  bracelet pour cette clé (ECDH-ES P-256).
- **Risque.** Une session de l'API compromise remplace la clé d'accord d'un terminal par la sienne ;
  la réponse suivante de `POST /media/auth-keys` pour ce terminal devient lisible par elle si elle
  intercepte cette réponse. Aujourd'hui l'identité du terminal est un faux qui croit des en-têtes
  (OP-N42, bloque la production) : le risque est couvert par ce point jusqu'à la mission 5.
- **Décision.** Avec l'enrôlement réel (mission 5) : clé d'accord écrite à l'enrôlement
  seulement, par une fonction qui vérifie le code d'enrôlement, et `UPDATE (agreement_public_key)`
  retiré à `cashless_app` ; test : réécriture directe refusée. Fichier concerné :
  `packages/ledger-sql/roles.sql` (kit), corrigé par `post-roles.sql`.
- **Test qui échoue si la limite s'élargit** : `tests/tests_tag_key_job_approval.sql`, section 7
  (liste exacte des colonnes de `device` que `cashless_app` peut mettre à jour, `INSERT`,
  `REFERENCES`, `DELETE`, `TRUNCATE`).
- **Levé le 21/10/2026 par la mission 5a (WP03, WP07 ; ADR-105).** La clé d'accord n'est écrite qu'à l'enrôlement,
  par la fonction qui consomme le code d'enrôlement ; `UPDATE (agreement_public_key)` et `INSERT` sur `device` sont
  retirés à `cashless_app`. Tests : `tests/tests_device_rights.sql` §1 (liste exacte des colonnes modifiables) et §2
  (réécriture directe de chaque colonne protégée refusée). Les colonnes encore modifiables relèvent d'OP-N69.

### OP-N64 — Terminal iOS : clé de signature non attestée (19 octobre 2026)

Signalé au plan de la mission 5a. **Écart accepté, bloque la production : non ; réexaminé par la mission 12 (app
terminal) ; décision du porteur du 19/10/2026 ; ADR-106.**

- **Constat.** App Attest atteste sa propre clé et l'intégrité de l'app, pas la clé de signature ECDSA P-256 du
  terminal (requêtes signées, CSR, certificat mTLS).
- **Risque.** Une app iOS dont la clé de signature serait extraite de l'appareil pourrait signer hors de lui. Borné :
  un iPhone encaisse en QR seulement et ne reçoit jamais le mot de passe d'un bracelet.
- **Ce qui est fait en attendant.** Le défi d'enrôlement couvre le code, le `serial` et les deux clés publiques ; le
  jeton, le certificat et la signature restent exigés ensemble ; révocation immédiate.
- **Condition de levée.** Requêtes iOS signées par assertion App Attest (ou preuve équivalente).
- **Test qui échoue si la limite s'élargit** : `POST /media/auth-keys` refuse un terminal `os = IOS`.
- **Vérifié le 21/10/2026 (WP18)** : bornes « borne iOS (OP-N64) » de
  `apps/api/test/integration/end-to-end/device-auth-matrix.spec.ts` (seule `/media/auth-keys` refuse un terminal iOS)
  et de `media-port-swap.spec.ts`. Pour la mission 12 : le `keyId` App Attest (credentialId) devra être renvoyé par le
  port et stocké (assertions), et l'app passe `iosClientDataHash` tel quel à `attestKey`.

### OP-N65 — Rafraîchissement : grâce de 60 s pour le même terminal (19 octobre 2026)

Signalé par la relecture contradictoire du plan de la mission 5a. **Écart accepté, bloque la production : non ;
réexaminé par la mission 13 (recette V1) ; décision du porteur du 19/10/2026 ; ADR-108.**

- **Constat.** Une réponse de rafraîchissement perdue fait réessayer le terminal avec un jeton déjà consommé.
- **Risque.** Un jeton consommé volé, représenté dans les 60 s, donnerait une paire neuve, à condition d'avoir aussi la
  clé de signature et le certificat du terminal (mTLS et preuve de possession exigés).
- **Test qui échoue si la limite s'élargit** : seconde représentation, plus de 60 s ou autre certificat → famille
  révoquée, jeton d'appareil de la famille refusé.
- **Vérifié le 21/10/2026 (WP18)** : « borne d'OP-N65 » (trois tests) de
  `apps/api/test/integration/devices/refresh.spec.ts` et `packages/ledger-sql/tests/tests_device_tokens.sql` §2.

### OP-N67 — Attestation Android : identité de l'app lue dans la liste logicielle (19 octobre 2026)

Signalé par l'implémentation de WP10 (mission 5a). **Écart accepté, affaiblit le plan, bloque la production : non ;
réexaminé par la mission 13 (recette V1) ; décision du porteur du 19/10/2026 ; ADR-110.**

- **Constat.** `research.md` R-05 voulait lire `attestationApplicationId` (paquet et empreintes de signature de l'app)
  dans la liste matérielle de Key Attestation. Sur les vrais appareils, ce champ est écrit par le service Keystore du
  système, donc placé dans `softwareEnforced` : la lecture stricte refuserait tout terminal Android.
- **Risque.** Un système d'exploitation compromis peut mentir sur l'app qui a créé la clé. Borné : la clé reste
  générée dans le TEE ou StrongBox (`origin = GENERATED`, chaîne signée par le matériel) ; `verifiedBootState =
  Verified`, `deviceLocked` et les niveaux de correctif restent lus dans la liste matérielle, et chaque certificat de
  la chaîne est contrôlé contre la liste de révocation de Google ; un système modifié ne passe pas le démarrage vérifié
  sans casser le TEE.
- **Ce qui est fait.** Seul ce champ est lu dans `softwareEnforced` ; s'il est aussi dans la liste matérielle, cette
  valeur prime et les deux doivent concorder.
- **Condition de levée.** Lecture dans la liste matérielle si les appareils cibles l'y placent, ou preuve d'intégrité
  de l'app complémentaire (Play Integrity) décidée en recette.
- **Test qui échoue si la limite s'élargit** : analyse du source qui échoue si un autre champ que
  `attestationApplicationId` est lu dans `softwareEnforced`, et tests de comportement : un autre contrôle
  (`rootOfTrust`, `origin`…) présent seulement dans `softwareEnforced` → refus ; valeurs différentes entre les deux
  listes → refus (`apps/api/test/unit/attestation/android.spec.ts`).

### OP-N68 — Fonction créée hors de `migrate.ts` : exécutable par PUBLIC jusqu'au rejeu des droits (20 octobre 2026)

Signalé par l'implémentation de WP07 (mission 5a). **Écart au plan accepté (contrôle non tenu) ; levé par la
mission 7 ; décisions du porteur du 20/10/2026 (option « une seule transaction », puis mission 7) ; ADR-111.**

- **Constat.** Le plan de WP07 demandait `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM
  PUBLIC`. Cette forme est sans effet dans PostgreSQL : un défaut posé par schéma ne retire pas le défaut global. La
  forme globale retire aussi `EXECUTE` à pgTAP et aux fonctions `pg_temp` des suites, qui cassent toutes.
- **Ce qui est fait.** `post-roles.sql` retire `EXECUTE` à `PUBLIC` sur toutes les fonctions de `public`, et
  `migrate.ts` applique la série de migrations et le rejeu de `roles.sql` et `post-roles.sql` dans une seule
  transaction (avec un verrou consultatif) : une fonction livrée par une migration n'est jamais exécutable par
  `PUBLIC`, même un instant.
- **Risque.** Une fonction créée à la main par le propriétaire (correctif d'urgence en psql, script d'exploitation)
  reçoit `EXECUTE` pour `PUBLIC` : tout rôle connecté, dont `cashless_app` et les processus des clés, peut l'appeler
  jusqu'au prochain passage de `migrate.ts`. Si elle est `SECURITY DEFINER`, elle s'exécute avec les droits du
  propriétaire, qui ignore la RLS.
- **Garde.** Règle d'exploitation : aucune fonction créée hors d'une migration ; après un correctif manuel, relancer
  `migrate.ts`.
- **Condition de levée.** Droit par défaut global (`ALTER DEFAULT PRIVILEGES FOR ROLE <propriétaire> REVOKE EXECUTE ON
  FUNCTIONS FROM PUBLIC`) une fois que les suites pgTAP n'en dépendent plus (pgTAP installé avec des droits
  explicites, ou droit rendu dans la transaction de chaque suite) ; la première assertion de la §4 de
  `tests_execute_grants.sql` s'inverse alors.
- **Tests qui bornent la limite** : `packages/ledger-sql/tests/tests_execute_grants.sql` §4 (« LIMITE RESTANTE : fonction
  créée à la main hors de migrate.ts exécutable par PUBLIC jusqu'au rejeu », puis fermeture au rejeu) ;
  `apps/api/test/integration/transverse/migrate-rights.spec.ts` (série et droits dans une même transaction ; échoue si
  le rejeu sort de la transaction ou si `post-roles.sql` cesse de retirer `PUBLIC`).

### OP-N69 — Terminal : numérotation, présence et affectation écrites directement par l'API (20 octobre 2026)

Relevé par la relecture indépendante de WP07 (mission 5a). **Défaut antérieur à la mission, ni créé ni aggravé par
WP07 ; consigné, levé par la mission 7 ; décision du porteur du 20/10/2026 ; ADR-112.**

- **Constat.** Après WP07, `cashless_app` n'insère plus dans `device` et ne touche plus au statut ni aux clés, mais
  garde `UPDATE` sur neuf colonnes : `app_mode`, `nfc_enabled`, `event_id`, `pos_id`, `station_name`,
  `last_snapshot_version`, `last_seen_at`, `next_seq_floor`, `personal_phone` (`post-roles.sql`, section 5).
- **Risque.** Une session de l'API compromise peut déplacer un terminal vers un autre événement ou point de vente
  (`event_id`, `pos_id`), abaisser ou relever le plancher de ses numéros de séquence (`next_seq_floor` : rejeu ou refus
  de lots hors ligne), ou falsifier sa dernière présence. Elle peut aussi réécrire `personal_phone` et `app_mode`, et
  contourner ainsi la règle du téléphone personnel (mode `KEYPAD_TPE` seulement ; revue post-fusion de la mission 5a,
  SEC-3). Le statut, les clés, l'empreinte du certificat et le prestataire restent protégés ; chaque requête relit le
  statut et le prestataire en base.
- **Condition de levée.** Ces écritures passent par des fonctions de la base qui contrôlent la transition (affectation
  dans le périmètre de l'organisateur, plancher qui ne descend jamais, présence posée par l'heure de la base), et les
  `UPDATE` directs correspondants sont retirés à `cashless_app`.
- **Test qui échoue si la limite s'élargit** : `packages/ledger-sql/tests/tests_device_rights.sql` §1 (« cashless_app :
  colonnes de device modifiables, liste exacte »).

### OP-N70 — Suites de la mission 4 encore sous le faux d'identité du terminal (20 octobre 2026)

Signalé par l'implémentation de WP12 (mission 5a). **Écart à la définition de fin de WP12, accepté ; levé par WP18 de
la même mission ; décision du porteur du 20/10/2026 ; ADR-113.**

- **Constat.** La définition de fin de WP12 voulait toute la suite de la mission 4 avec l'identité réelle. Ces suites
  sont servies en clair par supertest, donc sans certificat client : elles tournent sous `DEVICE_IDENTITY_FAKE=1`
  (posé par `apps/api/test/support/app.ts`). L'identité réelle est prouvée en HTTPS mTLS par `media-port-swap.spec.ts`
  (`POST /v1/taps`, `POST /v1/media/auth-keys`, matrice des preuves NFR-002, rejeu, révocation, suspension).
- **Risque.** Une route de terminal de la mission 4 dont le comportement dépendrait de l'identité réelle (par exemple
  un champ lu autrement que par le faux) ne serait pas couverte. Le faux est refusé en production
  (`production-guard.spec.ts`).
- **Condition de levée (WP18).** Au moins une route de chaque contrôleur de terminal de la mission 4 servie en HTTPS
  réel avec le terminal de test ; un test échoue si une route de terminal n'est couverte par aucun test en identité
  réelle.
- **Levé le 21/10/2026 par WP18.** `apps/api/test/integration/end-to-end/device-auth-matrix.spec.ts` croise les
  routes de terminal du contrat (`security` avec `deviceSignature`) et celles que les processus servent sous
  `DeviceGuard` : une route sans cas fait échouer la suite ; chaque route est servie en HTTPS mTLS avec le terminal de
  test (acceptée avec les trois preuves, refusée pour chacune). Les autres suites de la mission 4 restent sous le faux,
  refusé en production.

### OP-N71 — Idempotence : rejeu sur une autre ressource et entre personnes (21 octobre 2026)

Signalé par la relecture de WP16 (mission 5a), défaut antérieur (mission 1, `contracts/idempotency.md` règle 3).
**Correction transverse décidée par le porteur le 21/10/2026 ; confiée à WP18 de la mission 5a ; ADR-116.**

- **Constat.** `requestHash` (`apps/api/src/idempotency/request-hash.ts`) prend le modèle de route, pas le chemin
  concret, et `api_idempotency` rangeait la clé sous (prestataire, portée, clé). `POST /v1/devices/A/revoke` puis
  `POST /v1/devices/B/revoke` avec la même `Idempotency-Key` et le même motif : le second rejoue le 200 du premier, B
  reste actif. Toutes les routes `/:id` idempotentes sont concernées (prestataire, personnes, événements, approbations,
  médias, terminaux).
- **Risque.** Action de sécurité (révocation, suspension) crue faite et non faite ; réponse d'une ressource rendue à
  une personne du même prestataire qui n'y a pas droit, si elle connaît la clé.
- **Condition de levée (WP18).** Empreinte sur le chemin concret et clé liée à l'appelant (ADR-116), règle 3 du contrat
  mise à jour ; tests : même clé sur deux `:id` → `409 IDEMPOTENCY_KEY_REUSED` (statut de `openapi.yaml` et du code ;
  « 422 » corrigé, décision du porteur du 21/10/2026), même clé par deux personnes → aucune réponse de l'autre, rejeu
  légitime inchangé ; consigne de déploiement pour les lignes antérieures.
- **Levé le 21/10/2026 par WP18 (ADR-116).** Empreinte sur le chemin concret (sans la chaîne de requête) et liée à
  l'appelant (personne, terminal ou festivalier, posés par les gardes) ; règle 3 de `kitty-specs/fondations-grand-livre-01M4AY8M/contracts/
  idempotency.md` mise à jour. Tests : `apps/api/test/integration/devices/admin.spec.ts` (« ADR-116 : même clé sur deux
  `:id` → 409… ; B traité par sa clé », « ADR-116 : même clé par une autre personne du prestataire → aucune réponse de
  l'autre »), `integration/transverse/idempotency.spec.ts` (chaîne de requête hors de l'empreinte : rejeu),
  `unit/idempotency/request-hash.spec.ts`, `integration/media/personalization.spec.ts` (autre personne : 409).
  Consigne de déploiement : celle d'OP-N54 ci-dessus. Effet : sur une route de guichet, une autre personne qui reprend
  la même clé reçoit `409`.

### OP-N72 — Enrôlement : limite en amont absente, chaîne d'audit de la plateforme sollicitée (21 octobre 2026)

Limite résiduelle de la correction d'ADR-117 (relecture de WP14, cycle 2 ; mise en œuvre par WP18, migration 0030).
**Proposé par l'agent le 21/10/2026, confirmé par le porteur le même jour ; bloque la production : non ; levé par la
mission 13 (recette V1).**

- **Constat.** `POST /v1/device-enrollments` est une route sans compte. La migration 0030 rend les limites atomiques
  (verrous de l'adresse puis du code pris avant le contrôle, dans la même transaction), agrège l'adresse par /64 en
  IPv6 (IPv4 encapsulée ramenée à IPv4) et nomme la limite franchie (`limit: code|address`). Restent : chaque refus d'un
  code inconnu écrit dans la chaîne d'audit de la plateforme et en prend le verrou ; un attaquant qui dispose de
  nombreuses adresses (/64 différents) n'est borné que par adresse.
- **Risque.** Déni de service : une rafale de refus depuis de nombreuses adresses sérialise les écritures de la chaîne
  d'audit de la plateforme et ralentit les autres refus d'enrôlement. Pas de fuite ni d'enrôlement indu (60 bits
  d'entropie par code, 10 essais par code et par heure).
- **En place.** Limites par code et par adresse, atomiques ; au-delà, une seule trace `RATE_LIMITED` par fenêtre, les
  `429` suivants n'écrivent rien.
- **Condition de levée.** Limite de débit en amont (répartiteur ou passerelle) sur `POST /v1/device-enrollments`,
  décrite et vérifiée sur l'environnement de recette.
- **Test qui échoue si la limite s'élargit** : `packages/ledger-sql/tests/tests_enrollment_limits.sql` §3 (limite par
  /64) et §5 (rafale qui a passé le contrôle préalable : écritures bornées) ;
  `apps/api/test/integration/devices/enrollment-limits.spec.ts` (requêtes simultanées, IPv6).

### OP-N73 — Autorité des terminaux et signataire des jetons d'appareil : faux seulement (21 octobre 2026)

Signalé par la relecture de WP18 (mission 5a, constat M1) ; prévu par la contrainte C-004 de la mission (« pas
d'adaptateur AWS »), jamais nommé en dette. **Bloque la production : oui ; levé par la mission 7, avec OP-N41 ;
décision du porteur du 21/10/2026 ; ADR-119.**

- **Constat.** `DeviceCaPort` et `TokenSignerPort` n'ont que des faux (`apps/api/src/device-ca/fake-device-ca.ts`,
  `apps/api/src/device-tokens/fake-token-signer.ts`) ; l'adaptateur réel (KMS ou HSM) attend la région (OP-N11).
- **Risque.** Aucun en production tant que la garde tient : le démarrage est refusé ; la dette bloque la mise en
  service. Un faux câblé en production rendrait les certificats et les jetons d'appareil forgeables par qui lit le
  code.
- **En place.** Les deux faux refusent de se construire en production et la garde de démarrage refuse un processus qui
  en porte un.
- **Condition de levée.** Adaptateurs réels des deux ports (clé de l'autorité et clé de signature des jetons hors du
  code et de l'environnement, SPEC §13.2), garde levée pour ces deux ports seulement.
- **Test qui échoue si la limite s'élargit** : `apps/api/test/integration/end-to-end/device-latency.spec.ts` (« faux de
  … seul : démarrage refusé », pour l'autorité et pour le signataire), `apps/api/test/unit/production-guard.spec.ts`.

### OP-N74 — Enrôlement sur un événement clos ou un point de vente supprimé (21 octobre 2026)

Relevé par la revue post-fusion de la mission 5a (DRIFT-1). **Écart à la spécification, consigné ; bloque la production :
non ; levé par la mission 5b ; décision du porteur du 21/10/2026 ; ADR-120.**

- **Constat.** La spécification de la mission 5a (cas limites) exige le refus d'un enrôlement dont le code vise un
  événement clos ou annulé, ou un point de vente supprimé entre l'émission et l'enrôlement.
  `create_device_enrollment_code`, `check_device_enrollment_code` et `enroll_device` (migration 0022) ne lisent ni
  l'état de l'événement ni celui du point de vente. L'état « annulé » n'existe pas dans `event_status` (le plus proche
  est `CLOSED`).
- **Risque.** Un code encore valide (24 h par défaut, 7 jours au plus) enrôle un terminal affecté à un événement clos.
  Faible en 5a : le terminal n'encaisse rien tant que la mission 5b n'a pas livré le paiement ; il grandit avec elle.
- **En place.** Le code est à usage unique, borné dans le temps, révocable avec le terminal ; l'enrôlement est audité.
- **Condition de levée.** `create_device_enrollment_code` et `enroll_device` refusent un événement `CLOSED` (et les
  états de clôture que la mission 5b jugera bloquants) et un point de vente supprimé ; test pgTAP par refus, aucune
  ligne écrite.
- **Test.** Aucun test ne fige ce manque : c'est un contrôle absent, pas un droit qui peut s'élargir (même cas
  qu'OP-N55).

### OP-N75 — Purges des nonces et des essais d'enrôlement exécutées par l'API publique (21 octobre 2026)

Fiche de la limite acceptée par ADR-114 (décision du porteur du 20/10/2026), complétée après la revue post-fusion de
la mission 5a (SEC-1). **Bloque la production : non ; levée par la mission 7 ; décision du porteur du 21/10/2026.**

- **Constat.** `post-roles.sql` (section 4a) accorde à `cashless_app` `EXECUTE` sur `purge_device_request_nonces` et
  `purge_device_enrollment_attempts` (SECURITY DEFINER), appelées par le travailleur `device-purge` de l'API publique.
- **Risque.** Droit plus large que le plan : une session de l'API compromise peut lancer les purges à volonté. Chaque
  purge ne retire que des lignes hors de leur fenêtre, à l'heure de la base.
- **Condition de levée.** Rôle et connexion de maintenance dédiés (mission 7, qui revoit déjà les droits de la base :
  OP-N68, OP-N69), `EXECUTE` retiré à `cashless_app`.
- **Test qui échoue si la limite s'élargit** : `packages/ledger-sql/tests/tests_device_purge_window.sql` (aucune purge
  ne retire un nonce encore dans sa fenêtre ni un essai de moins de 24 h) et les listes figées de
  `tests_execute_grants.sql`.

### OP-N77 — Secrets de l'API exigés par tous les processus (23 octobre 2026)

Constaté par la relecture de WP08 de la mission 5b (constat 2) ; défaut antérieur à la mission. ADR-125.
**Bloque la production : non ; levée : mission 13 (recette V1).**

- **Constat.** `loadConfig` est commun à tous les processus ; en production, les trois secrets HMAC de l'API sont
  obligatoires dans l'environnement des processus des clés, d'administration des clés et de personnalisation.
- **Risque.** Un processus compromis qui n'a pas besoin de ces secrets les obtient quand même (empreintes des PIN,
  codes d'enrôlement, registre d'idempotence) : surface d'exposition plus large que nécessaire.
- **Condition de levée.** Chaque processus n'exige et ne reçoit que ses propres secrets ; test qui le prouve par
  processus.
- **Test qui échoue si la limite s'élargit** : `apps/api/test/unit/config.spec.ts` (liste fermée des secrets
  obligatoires en production).

### OP-N76 — PIN des vendeurs : la base croit l'API pour la vérification (22 octobre 2026)

Limite acceptée par le porteur au plan de la mission 5b (`DM-01M5HRNFEFWDG47YEGE5N3C3GN`, passe contradictoire A15) ;
ADR-121. **Bloque la production : non ; levée avec OP-N56 (mission 11).** Code non encore écrit : la limite naît avec
la migration `0031_vendors.sql` de la mission 5b.

- **Constat.** argon2id se calcule dans l'API : `begin_vendor_pin_check` rend l'empreinte du PIN à `cashless_app`, et
  `open_vendor_session` ouvre la session sur la foi de la transaction de l'API (la base ne refait pas la vérification).
- **Risque.** Une connexion `cashless_app` compromise lit les empreintes (inutiles sans `VENDOR_PIN_SECRET`, gardé hors
  base) et ouvre une session pour n'importe quel vendeur sans PIN (en consommant un essai, audité). Même classe
  qu'OP-N56 : une telle connexion peut déjà écrire des ventes au nom d'un terminal du prestataire.
- **Condition de levée.** Vérification du PIN par un processus séparé, seul détenteur de `VENDOR_PIN_SECRET` et d'un
  rôle de base propre, qui seul exécute ces deux fonctions (sur le modèle des processus de clés de la mission 4) ; ou
  preuve que l'API ne peut fabriquer, comme prévu pour OP-N56.
- **Test qui échoue si la limite s'élargit** : liste figée de `tests_execute_grants.sql` (aucun autre rôle que
  `cashless_app` n'exécute `begin_vendor_pin_check` ni `open_vendor_session`) ; `tests_vendors.sql` (aucune session sans
  essai compté, non expiré, non utilisé) ; audit de chaque ouverture (`VENDOR_SESSION_OPENED`).

### OP-N66 — Import du fichier de l'imprimeur lent quand la table des bracelets est volumineuse (19 octobre 2026)

Constaté pendant la mission 5a (vérification de WP09), défaut antérieur à cette mission (mission 4). **Hors
mission 5a, bloque la production : à évaluer ; décision du porteur du 19/10/2026 : point ouvert, pas de correctif dans
la mission 5a.**

- **Constat.** Le test « associe les lignes justes, refuse les autres… » de
  `apps/api/test/integration/media/claim-code-order.spec.ts` (import `POST …/claim-code-associations`) dépasse son
  délai Jest de 5 s dès que `test/integration/end-to-end/media-latency.spec.ts` a créé ~100 000 bracelets dans un lot.
  Reproduit sur `feat/identite-enrolement-terminaux` sans le code de la mission 5a ; vert seul après `reset-db`. Il est
  apparu quand l'ajout de suites a changé l'ordre d'exécution de Jest.
- **Risque.** Probable recherche sans index adapté dans le chemin d'import (ou dans `associate_claim_code`), dont le
  coût croît avec la table `media` : un import réel sur un prestataire à fort volume serait lent ; et la CI peut
  devenir instable selon l'ordre des suites.
- **Pistes.** `EXPLAIN ANALYZE` des requêtes de l'import sur une base peuplée ; index manquant ; ou isoler la suite de
  latence (lot dédié nettoyé, ou exécution en fin de batterie).
- **Condition de levée.** L'import de 7 lignes reste sous 1 s avec 100 000 bracelets en base, prouvé par un test.

## 3. Relectures d'experts

| Expert | Objet | Points | Documents à fournir |
|---|---|---|---|
| Juriste (BCEAO, CDP) | Statut réglementaire, plafonds, casse, stockage des pièces KYC, conservation, localisation des données | Condition d'ADR-48 (ex-OP-N2), OP-N3 (casse), ADR-38 (stockage KYC), OP-N11, OP-N12 | SPECIFICATION §4.4, §6.3, §6.5, §13.5 ; DECISIONS_ADR |
| Expert-comptable SYSCOHADA | Plan de comptes, taxes, casse, caution, correspondance légale | OP-N3, écart de taxe par période (ADR-09) | SPECIFICATION §5.2, §5.3, §12.3 ; classeur ; scénario de référence |
| Auditeur sécurité | Cloisonnement, clés, bracelets, API, hors ligne, passerelle | ADR-44 (revue de conception, puis test d'intrusion avant le pilote) | Documents du kit : SPECIFICATION, DECISIONS_ADR, `sync_protocol.md`, `openapi.yaml`, schéma de référence et tests |

### Questions au juriste (condition d'ADR-48, ADR-38, OP-N12)

À poser par écrit, avec SPECIFICATION §4.4, §6.3, §6.5, §13.5 et ADR-11, ADR-38, ADR-48 :

1. L'instruction BCEAO n° 001-01-2024 (ou un autre texte en vigueur) exclut-elle de son champ les instruments utilisables seulement dans un réseau limité (un organisateur, ses événements et ses commerçants) ? Si oui, à quelles conditions exactes (nombre ou type de commerçants, montants, durée, fournisseur unique) ?
2. Le modèle décrit en §6.5 (pas de transfert, pas de retrait sauf remboursement du solde, pas de rémunération, validité limitée) remplit-il ces conditions ? Y a-t-il une déclaration ou une notification à faire à la BCEAO ?
3. Qui porte le risque réglementaire : l'organisateur émetteur, le prestataire, ou la plateforme ? Le choix du détenteur des fonds (ADR-11) change-t-il la réponse ?
4. Des plafonds s'appliquent-ils dans ce régime (solde, recharges mensuelles, avec ou sans identification) ? Lesquels ? Les montants de l'instruction 008-05-2015 sont-ils encore applicables ?
5. Un portefeuille durable, utilisable sur plusieurs événements du même organisateur (`wallet_scope = ORGANIZER`), reste-t-il dans l'exclusion ?
6. Le paiement par carte et par mobile money pour recharger, et le remboursement vers mobile money, posent-ils une contrainte particulière ?
7. Si l'exclusion ne s'applique pas : quels types d'établissements agréés peuvent servir d'adossement, et quelles obligations restent au projet ?
8. Stockage des pièces d'identité (ADR-38) : le minimum enregistré au guichet (type de pièce, pays, 4 derniers caractères du numéro, date d'expiration, sans photo) suffit-il aux obligations d'identification ? Faut-il conserver une copie ou le numéro complet, et pendant combien de temps ?
9. Durées de conservation (OP-N12) : combien de temps garder les écritures comptables et les historiques des festivaliers identifiés, pays par pays (CDP au Sénégal) ? L'anonymisation des données personnelles 13 mois après la dernière activité est-elle acceptable ?

### Questions à l'expert-comptable (OP-N3)

À poser par écrit, avec SPECIFICATION §5.2, §5.3, §5.5, §12.3, ADR-09, ADR-12, le classeur et le scénario de référence :

1. Casse : les soldes non réclamés peuvent-ils être acquis, après quel délai, et au profit de qui (organisateur, prestataire, compte légal) ? Quel traitement comptable pour chacun ?
2. Taxes sur les frais et commissions : quel taux, et quel fait générateur (vente, encaissement, clôture de l'événement) ?
3. Écart de taxe par période (ADR-09) : la taxe est extraite par transaction et par bénéficiaire ; son total peut différer de quelques unités d'une taxe calculée sur le total de la période. Cet écart est-il acceptable, et faut-il une écriture de régularisation ?
4. Caution acquise (bracelet non rendu) : est-elle taxable, à quel taux et à quelle date ?
5. Correspondance SYSCOHADA indicative (SPECIFICATION §12.3, table `account_mapping`) : est-elle juste pour un organisateur émetteur et détenteur des fonds ? Quels comptes changent si le prestataire est émetteur ou détenteur ?

## 4. Ordre de décision conseillé

1. **Condition d'ADR-48** : choisir le juriste et lui envoyer ses questions (§3, questions 1 à 9 ; action 8). La réponse écrite est exigée avant le premier événement réel.
2. **Campagne NFC** : validation de la puce, campagne de mesure et mesure de latence (actions 1 à 3), avant le code de l'app terminal ; elle conditionne la liste des téléphones et OP-N11.
3. **Questions de la revue de cohérence n° 1** (OP-N21 à OP-N38, §8) : toutes traitées le 1er octobre 2026 ; restent les points reportés (§6).
4. **Questions de la revue de cohérence n° 2** : toutes tranchées le 2 octobre 2026 (§9).
5. **OP-N3** : envoyer les questions à l'expert-comptable (action 9), en parallèle du développement.
6. **OP-B1 et OP-B2** sont tranchés (ADR-70, ADR-66) : plus aucun point ne bloque le code.
7. Les autres points peuvent attendre le premier pilote.

## 5. Points tranchés

| Point | Décision | Date | Fiche |
|---|---|---|---|
| OP-N42 Identité du terminal | Levé par la mission 5a : jeton lié, mTLS et signature de chaque requête exigés ensemble ; faux refusé en production (`device-auth-matrix.spec.ts`, `production-guard.spec.ts`) | 21 octobre 2026 | ADR-88, ADR-107 |
| OP-N44 `EXECUTE` hérité de `PUBLIC` | Levé par la mission 5a : droits d'exécution rôle par rôle (`tests_execute_grants.sql`) | 21 octobre 2026 | ADR-84, ADR-101 |
| OP-N50 Lecture d'une demande et `consume_tap` | Levé par la mission 5a : migrations 0024 et 0026 (`tests_consume_tap_claim.sql`, `tap-claim-race.spec.ts`) | 21 octobre 2026 | ADR-90, ADR-101 |
| OP-N54 Empreinte sans clé au registre d'idempotence | Levé par la mission 5a : HMAC sous `IDEMPOTENCY_HMAC_KEY` (`request-hash.spec.ts`, `personalization.spec.ts`) ; purge des lignes antérieures à T + 720 h | 21 octobre 2026 | ADR-99 |
| OP-N59 SECURITY DEFINER sans `pg_temp` | Levé par la mission 5a : migration 0021 et `TEMPORARY` retiré (`tests_definer_search_path.sql`, `tests_device_rights.sql` §5) | 21 octobre 2026 | ADR-96 |
| OP-N62 Retrait d'une clé dédiée sans travail | Levé par la mission 5a : migration 0025 (`tests_tag_key_retire_guard.sql`) | 21 octobre 2026 | ADR-102 |
| OP-N63 Clé d'accord réécrite par l'API | Levé par la mission 5a : écrite à l'enrôlement seulement (`tests_device_rights.sql` §1, §2) | 21 octobre 2026 | ADR-105 |
| OP-N70 Suites de la mission 4 sous le faux | Levé par WP18 de la mission 5a : chaque route de terminal en HTTPS réel, test de couverture (`device-auth-matrix.spec.ts`) | 21 octobre 2026 | ADR-113 |
| OP-N71 Idempotence par chemin concret et appelant | Levé par WP18 de la mission 5a (`admin.spec.ts`, `idempotency.spec.ts`, `request-hash.spec.ts`) | 21 octobre 2026 | ADR-116 |
| OP-N40 Conservation des clés d'idempotence | 30 jours par défaut (720 h, `IDEMPOTENCY_TTL_HOURS`), conforme au contrat ; terminaux : pour toujours (clé du grand livre) | 9 octobre 2026 | ADR-79 |
| OP-N39 Pile logicielle | L'existant prime : PostgreSQL 17, RFC 9457, curseur, idempotence en base, sans ORM, Express, jose 6 ; le reste du document du porteur devient la cible (`08-pile-logicielle.md`) | 9 octobre 2026 | ADR-78 |
| OP-N1 Catalogue | Option B : prix TTC fixe, catégories, un taux de taxe par article ; ni variantes, ni remises, ni stock en V1 | 30 septembre 2026 | ADR-35 |
| OP-B1 Paiements | Comptes marchands au détenteur des fonds (A) ; Wave et Orange Money en direct (M3) ; carte configurée par organisateur : agrégateur local (PayDunya) ou PSP international (Stripe) | 2 octobre 2026 | ADR-70 |
| OP-B2 Codes à usage unique | WhatsApp d'abord, SMS en repli avec deux fournisseurs SMS (options C et D combinées) ; fournisseurs à choisir sur devis | 2 octobre 2026 | ADR-66 |
| OP-N3 (casse) | Casse réversible : enregistrée à la date limite, remboursement possible pendant 5 ans par annulation de casse en back-office (C) | 2 octobre 2026 | ADR-67 |
| OP-N6 Assiette des frais du prestataire | Au choix dans chaque contrat, brut par défaut (C) | 2 octobre 2026 | ADR-68 |
| OP-N7 Gestion des terminaux | Pas de MDM ; un téléphone personnel n'a jamais le hors ligne | 2 octobre 2026 | ADR-69 |
| OP-N2 Statut réglementaire | Option B : instrument à usage limité (réseau limité), règles de périmètre dans SPEC §6.5 ; plafonds paramétrables, valeurs de 2015 provisoires. **Sous condition** d'un avis écrit du juriste avant le premier événement réel ; sinon adossement à un établissement agréé | 30 septembre 2026 | ADR-48 |
| OP-N4 Code imprimé | Option B : QR code imprimé + code de 10 caractères en clair dessous | 30 septembre 2026 | ADR-36 |
| OP-N5 Capture différée | Option A : capture automatique seulement en V1 ; si un client hôtelier le demande, réservation dans le grand livre (option C) | 30 septembre 2026 | ADR-37 |
| OP-N8 Identification | Option D : vérification au guichet en V1, vérification en ligne plus tard sur le même modèle de données. Stockage minimal de la pièce à confirmer par le juriste | 30 septembre 2026 | ADR-38 |
| OP-N10 Validation terrain NFC | Téléphones : ceux déjà disponibles (option C). Critères : deux niveaux, « recommandé » (300 ms, 2 %) et « toléré » (500 ms, 5 %). Calendrier : dès maintenant, par le porteur du projet, avant le code de l'app terminal | 30 septembre 2026 | ADR-39 |
| OP-N14 Droit de place supérieur aux ventes | Option D : mode choisi par l'organisateur pour chaque commerçant (déduction avec reste dû, paiement d'avance, déduction plafonnée), défaut « déduction avec reste dû » | 30 septembre 2026 | ADR-40 |
| OP-N15 Import des billets | Sans objet : les bracelets-billets et le contrôle d'accès sont abandonnés ; les bracelets servent exclusivement au cashless | 30 septembre 2026 | ADR-41 |
| OP-N16 App festivalier | Compte par téléphone vérifié seulement (A) ; perte : suspension immédiate et paiement par QR en attendant (B) ; sans compte : consultation du solde en lecture seule par le code imprimé (B) | 30 septembre 2026 | ADR-42 |
| OP-N17 Premier partenaire de caisse tierce | Option C : caisses tierces reportées après la V1 (intentions de paiement, TPE associé, webhooks sortants, SDK) ; contrat conservé, marqué V2 | 30 septembre 2026 | ADR-43 |
| OP-N18 Audit de sécurité | Revue de conception et test d'intrusion (B) ; revue de conception dès maintenant sur les documents, test d'intrusion avant le pilote (A) ; pas d'outils de sécurité imposés dans la CI pour l'instant (B) | 30 septembre 2026 | ADR-44 |
| OP-N19 Charge et chaînage | Charge cible B (200 terminaux, 50 ventes/s sur le site, 20/s sur un stand), démontrée à deux fois ; scellement périodique du journal toutes les 5 minutes, copié hors de la base (C) | 30 septembre 2026 | ADR-45, ADR-46 |
| OP-N20 Compléments de schéma | Option C : les éléments critiques (S6 à S10, S12, S13, S25 et les colonnes associées de S4) sont écrits dans le schéma de référence avec leurs tests ; l'agent conçoit les éléments courants, et le porteur du projet relit sa première migration | 30 septembre 2026 | ADR-47 |
| OP-N21 Fin d'événement | Synchronisations tardives : écrites jusqu'à la fin de `RECONCILING`, ensuite rejet `SYNC_DEADLINE_PASSED`, anomalie et écriture par le back-office, commerçant garanti (C) ; `PROMO_EXPIRY` et `CHARGEBACK` acceptés pendant toute la clôture (A) ; clôture possible avec soldes restants listés si la casse est `NONE` ou `LEGAL_ACCOUNT`, grand livre verrouillé quand ils sont nuls (A) | 1er octobre 2026 | ADR-49 |
| OP-N22 Remboursements | Wave, Orange Money, virement bancaire au back-office, espèces au guichet ; pas de carte en V1 (B) ; espèces : une personne jusqu'à 50 000 XOF (réglable par événement), deux au-delà (B) ; bracelets anonymes remboursables en espèces sur présentation du bracelet (A) | 1er octobre 2026 | ADR-53 |
| OP-N23 Niveau d'identification | Porté par le client et calculé à chaque usage (identification non révoquée, pièce non expirée) ; table `kyc_verification` écrite dans le schéma de référence (A) | 1er octobre 2026 | ADR-54 |
| OP-N24 Renvoi d'une lecture | Le serveur reconnaît le renvoi (même terminal, bracelet, compteur, UID) dans un délai réglable par événement, 120 s par défaut, de 0 à 600 s (B) ; une opération de lot qui cite la lecture enregistrée en ligne la réutilise, quel que soit le délai (A) | 1er octobre 2026 | ADR-50 |
| OP-N25 Durée des transactions | PostgreSQL 17, `transaction_timeout = 60s` sur le rôle applicatif, plus une tâche de surveillance en filet (A + B) | 1er octobre 2026 | ADR-55 |
| OP-N26 Statut événement et grand livre | Fonction SQL unique `set_event_status` : passage contrôlé, conditions de clôture calculables vérifiées par la base, statut des grands livres, scellement final, historique (A) | 1er octobre 2026 | ADR-51 |
| OP-N27 Passerelle pendant une coupure | Passerelle intermédiaire : ventes, annulations, recharges espèces, activation sans frais sur solde, caution en espèces ; refus des autres prélèvements sur solde, des remboursements et des restitutions (B) | 1er octobre 2026 | ADR-52 |
| OP-N28 Code imprimé | Tous les lots `PUBLIC`, pas les lots `STAFF` ni `VIP` (A) ; code généré à la commande, associé à la puce à la personnalisation par scan du QR ou fichier du fournisseur (A) | 1er octobre 2026 | ADR-56 |
| OP-N29 Perte d'un terminal non conforme | Selon qui a fourni le terminal : plateforme ou prestataire → prestataire ; organisateur → organisateur ; commerçant → commerçant, sauf défaut du logiciel établi (B) | 1er octobre 2026 | ADR-58 |
| OP-N30 Chemin NFC de paiement | `READ_SIG` à chaque paiement, vérifiée par le terminal et comparée par le serveur à la signature de la personnalisation ; pas de `GET_VERSION` (B) | 1er octobre 2026 | ADR-59 |
| OP-N31 Latence | Bout en bout p95 ≤ 1,2 s, p99 ≤ 2 s ; NFC p95 ≤ 300 ms ; réseau + serveur p95 ≤ 800 ms, p99 ≤ 1,5 s ; serveur seul p95 ≤ 200 ms, p99 ≤ 500 ms (A) | 1er octobre 2026 | ADR-60 |
| OP-N32 Réglages des terminaux | Réglables par événement dans des bornes fixées par la base, par le prestataire (fenêtre d'annulation : organisateur), envoyés dans `DeviceConfig` (A) | 1er octobre 2026 | ADR-61 |
| OP-N33 Compte commerçant chaud | Tout compte commerçant est chaud par défaut (A) | 1er octobre 2026 | ADR-62 |
| OP-N34 Espèces encaissées au-delà d'un plafond | Recharge écrite en deux parts : marge au portefeuille, reste en `L-ESP-A-RENDRE`, rendu au guichet sur présentation du bracelet (B) | 1er octobre 2026 | ADR-63 |
| OP-N35 Paiement par QR | Deux sens toujours autorisés, sans réglage (C) ; pas de jeton préchargé, réseau obligatoire sur le téléphone ; sinon paiement par bracelet (A) | 1er octobre 2026 | ADR-64 |
| OP-N38 Rattachement d'un bracelet approvisionné | Libre si le solde est nul ; sinon demande en attente confirmée au guichet (lecture du bracelet et code de confirmation) ; consultation anonyme par un tiers acceptée (A) | 1er octobre 2026 | ADR-57 |

## 6. Points reportés

| Point | Statut | En attendant |
|---|---|---|
| OP-N3 : casse, taxes, caution acquise, SYSCOHADA | Regroupé dans les questions à l'expert-comptable (§3), et, pour la casse, dans les questions au juriste (§3) ; envoi : action 9 | Hypothèses actuelles paramétrables ; `account_mapping` indicatif |
| OP-N9 : contestations de paiement par carte | **Tranché le 2 octobre 2026** (ADR-77) : payeur selon le contrat (`chargeback_bearer`, organisateur par défaut), 3-D Secure, plafond par carte et par jour, alerte multi-cartes ; contestation tardive écrite dans le grand livre verrouillé | ADR-77 |
| OP-N11 : région AWS | Provisoire le 1er octobre 2026 : Paris (`eu-west-3`), ADR-65. À confirmer après la mesure de latence (action 3, §7) et l'avis du juriste | Développement, tests et pilote préparés en `eu-west-3` ; région paramétrable |
| OP-N12 : durées de conservation | Regroupé dans les questions au juriste (§3, question 9) | 5 ans pour les écritures ; données personnelles anonymisées 13 mois après la dernière activité |
| OP-N13 : algorithme de signature des snapshots | Vérification technique confiée à l'agent | ECDSA P-256 |
| OP-N37 : outils de sécurité en CI (dépendances vulnérables, analyse statique, détection de secrets) | Reporté le 30 septembre 2026 (ADR-44 : « reste à décider » ; question B17 de la revue de cohérence) | Aucun outil imposé en CI ; le test de cloisonnement sur toutes les routes reste un critère d'acceptation |
| OP-N36 : capture différée dans la cible V2 | Reporté le 1er octobre 2026 au cadrage de la V2, avec le premier partenaire de caisse (option A) | `capturePaymentIntent` reste marquée V2, sans engagement |

## 7. Actions à mener

| # | Action | Responsable | Échéance | Débloque |
|---|---|---|---|---|
| 1 | Validation de la puce sur de vrais bracelets (demi-journée, §5.0 du protocole) : `GET_VERSION`, `READ` sur page protégée, reprise après NAK, compteur 2, protection de `INCR_CNT` | Porteur du projet | Avant le code de l'app terminal | Code de lecture NFC |
| 2 | Campagne de mesure complète sur les téléphones disponibles, classés par profil ; rapport selon le gabarit du protocole | Porteur du projet | Avant le code de l'app terminal | Liste des téléphones recommandés et tolérés |
| 3 | Mesure de latence réseau depuis Dakar (Orange, Free, Expresso) vers les régions candidates | Porteur du projet, pendant la campagne | Avant le code de l'app terminal | OP-N11 (région) |
| 4 | Demander au fournisseur de bracelets le surcoût d'un QR différent par bracelet | Porteur du projet | Avant la première commande | ADR-36 |
| 5 | Préciser la taille du plus grand événement visé la première année (festivaliers, points de vente), pour confirmer la cible de charge | Porteur du projet | Avant le test de charge | ADR-45 |
| 6 | Choisir un auditeur de sécurité et lui confier la revue de conception (documents du kit) | Porteur du projet | Maintenant | ADR-44 |
| 7 | Test d'intrusion du système complet | Auditeur | Avant le premier événement pilote | Mise en production |
| 8 | Choisir un juriste (droit bancaire UEMOA) et lui envoyer ses questions (§3 : condition d'ADR-48, stockage des pièces KYC, durées de conservation) | Porteur du projet | Maintenant ; réponse écrite avant le premier événement réel | Mise en production (régime et plafonds) ; ADR-38 (stockage KYC) ; OP-N12 |
| 9 | Envoyer les questions à l'expert-comptable SYSCOHADA (§3) avec le classeur et le scénario de référence | Porteur du projet | Maintenant ; réponse avant la production | OP-N3 (casse, taxes, caution acquise, correspondance comptable) |
| 10 | Codes à usage unique (ADR-66) : demander les devis (SMS principal local couvrant Orange, Free et Expresso ; SMS de repli international ; fournisseur WhatsApp agréé Meta) et lancer la validation du nom d'expéditeur SMS (RCCM, 5 à 10 jours) et du modèle WhatsApp | Porteur du projet | Avant le pilote | Envoi réel des codes |
| 11 | Paiements (ADR-70) : ouvrir un compte Wave Business et un compte marchand Orange Money (accès de test et documentation des API) ; obtenir les accès de test PayDunya et Stripe ; vérifier pour Stripe l'ouverture de compte et le versement en XOF pour un marchand établi au Sénégal | Porteur du projet | Maintenant (validation Orange Money : plusieurs semaines) | Adaptateurs PSP réels |

## 8. Questions issues de la revue de cohérence n° 1 (30 septembre 2026)

Questions de la partie B de `REVUE_COHERENCE.md` (archivée). Toutes ont été traitées le 1er octobre 2026 : tranchées, ou reportées (§6). Le tableau est gardé pour la correspondance des numéros.

| Point | Revue | Question | Recommandation |
|---|---|---|---|
| ~~OP-N21~~ | B1 | Tranché le 1er octobre 2026 : voir §5 et ADR-49 | — |
| ~~OP-N22~~ | B2 | Tranché le 1er octobre 2026 : voir §5 et ADR-53 | — |
| ~~OP-N23~~ | B3 | Tranché le 1er octobre 2026 : voir §5 et ADR-54 | — |
| ~~OP-N24~~ | B4 | Tranché le 1er octobre 2026 : voir §5 et ADR-50 | — |
| ~~OP-N25~~ | B5 | Tranché le 1er octobre 2026 : voir §5 et ADR-55 | — |
| ~~OP-N26~~ | B6 | Tranché le 1er octobre 2026 : voir §5 et ADR-51 | — |
| ~~OP-N27~~ | B7 | Tranché le 1er octobre 2026 : voir §5 et ADR-52 | — |
| ~~OP-N28~~ | B8 | Tranché le 1er octobre 2026 : voir §5 et ADR-56 | — |
| ~~OP-N38~~ | — | Tranché le 1er octobre 2026 : voir §5 et ADR-57 | — |
| ~~OP-N29~~ | B9 | Tranché le 1er octobre 2026 : voir §5 et ADR-58 | — |
| ~~OP-N30~~ | B10 | Tranché le 1er octobre 2026 : voir §5 et ADR-59 | — |
| ~~OP-N31~~ | B11 | Tranché le 1er octobre 2026 : voir §5 et ADR-60 | — |
| ~~OP-N32~~ | B12 | Tranché le 1er octobre 2026 : voir §5 et ADR-61 | — |
| ~~OP-N33~~ | B13 | Tranché le 1er octobre 2026 : voir §5 et ADR-62 | — |
| ~~OP-N34~~ | B14 | Tranché le 1er octobre 2026 : voir §5 et ADR-63 | — |
| ~~OP-N35~~ | B15 | Tranché le 1er octobre 2026 : voir §5 et ADR-64 | — |
| ~~OP-N36~~ | B16 | Reporté le 1er octobre 2026 au cadrage V2 : voir §6 | — |
| OP-N37 | B17 | Outils de sécurité en CI : ADR-44 dit « reste à décider », sans point de suivi | Reporté (§6) |

## 9. Questions de la revue de cohérence n° 2 (2 octobre 2026)

Questions de la partie B de `REVUE_COHERENCE_2.md`. Statut : **à trancher**. Elles seront posées une par une. En attendant, l'agent ne choisit pas : il code ce qui n'en dépend pas et signale le reste. La SPEC écrit « en attente de Qx (revue 2) » aux endroits concernés.

| Point | Question | Recommandation de la revue | Statut | En attendant (texte actuel) |
|---|---|---|---|---|
| Q1 | La configuration PSP (S26) est rattachée à l'organisateur, alors que le détenteur des fonds est choisi par événement. Faut-il rattacher S26 à l'événement ? | Configuration par organisateur, avec choix par événement parmi ses configurations | **Tranché le 2 octobre 2026 : option C** (ADR-72) | S26 + S26b (SPEC §11.1, §14.2) |
| Q2 | Date limite de synchronisation : non définie, citée sur deux transitions (`CLOSING` → `RECONCILING` et `RECONCILING` → `SETTLING`) | `event.sync_deadline` = fin de l'événement + 72 h, contrôlée au passage à `SETTLING` | **Tranché le 2 octobre 2026 : option B, 72 h** (ADR-73) | `event.sync_deadline_hours`, contrôle dans `set_event_status` (SPEC §12.1) |
| Q3 | Comment fonctionne la double validation par l'API ? Aujourd'hui `approved_by` est envoyé dans le corps de la requête : une seule personne peut se valider elle-même (API-B1) | Demande, puis approbation par une seconde personne connectée, avec expiration après 24 h | **Tranché le 2 octobre 2026 : option C** (ADR-74) | Guichet : jeton d'approbation sur place (`X-Approval-Token`, 5 min) ; back-office : demande puis approbation (`approval_request`, `/approval-requests`, 24 h) ; `approved_by` du corps ignoré (SPEC §3.2) |
| Q4 | Faut-il une limite au montant et au périmètre des réclamations tardives (comptes, montant, `ADJUSTMENT` libre, `BREAKAGE_REVERSAL` accepté sur un grand livre `OPEN`) ? (DB-I6) | Limite = casse initiale du support ; double validation ; seulement par le back-office | **Tranché le 2 octobre 2026 : option A** (ADR-75) | `check_late_claim` dans `post_transaction`, `CL024` (SPEC §5.3, §12.1) |
| Q5 | Le numéro pour un remboursement mobile peut-il être différent du numéro vérifié ? | Oui, mais seulement après un code à usage unique envoyé au nouveau numéro | **Tranché le 2 octobre 2026 : option C, 50 000 et 48 h** (ADR-76) | SPEC §8.5 ; `event.refund_new_number_max`, `event.refund_new_number_hold_hours` |
| Q6 (= OP-N9) | Qui paie les contestations carte, et comment traiter une contestation reçue après `CLOSED` (flux `LATE_CHARGEBACK`) ? | Toujours ouvert ; à reposer avec le flux `LATE_CHARGEBACK` | **Tranché le 2 octobre 2026 : partie 1 option C, partie 2 option B** (ADR-77) | `contract.chargeback_bearer` ; contestation tardive par demande d'approbation (SPEC §5.3, §12.1) |
