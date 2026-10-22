# PRD — Système cashless multi-tenant (V1)

> **Source.** Ce PRD structure `docs/SPECIFICATION.md` (v1.2, 2 octobre 2026), `docs/DECISIONS_ADR.md`,
> `docs/POINTS_OUVERTS.md`, `docs/sync_protocol.md` et `packages/contracts/openapi.yaml`.
> Il ne remplace aucun de ces fichiers : en cas de doute ou de contradiction, **la règle de priorité de
> SPECIFICATION §0.3 s'applique** (tests exécutables > schéma SQL, OpenAPI, protocole de synchronisation > SPECIFICATION > ce PRD).
> Chaque section renvoie à la section normative (`§n`) qui porte le détail complet.

## 1. Vision produit

**Problème résolu.** Les festivals, concerts et lieux permanents (cinémas, hôtels, supermarchés) ont besoin
d'un paiement fermé (cashless) rapide, qui fonctionne même quand le réseau tombe, et d'une comptabilité
exacte de l'argent encaissé et dû à chaque intervenant. (§1.1)

**Utilisateurs cibles.**
- Prestataires cashless (opérateurs, unité d'isolation des données) qui fournissent bracelets et terminaux.
- Organisateurs d'événements, émetteurs des crédits par défaut.
- Commerçants (internes et externes) et leurs vendeurs.
- Festivaliers, anonymes ou avec un compte.
- La plateforme, éditeur du logiciel, qui perçoit une redevance sur chaque prestataire. (§3.1)

**Proposition de valeur.**
- Le festivalier charge un portefeuille (mobile money, carte, espèces), paie avec un bracelet NFC ou un QR code,
  et récupère son solde à la fin.
- Le système tient une comptabilité en partie double par réserve d'argent (pool), calcule les frais de chaque
  intervenant et prépare les versements. (§1.1)
- Les ventes continuent hors ligne dans des plafonds qui bornent la perte, ou via une passerelle locale sur site. (§9)
- Contexte de lancement : Sénégal (XOF, Wave, Orange Money, BCEAO, SYSCOHADA). (§6.5, §11.1, §12.3)

## 2. Périmètre fonctionnel détaillé

### 2.1 Grand livre et moteur d'écritures (§5)
- Grand livre en partie double par pool (une devise) ; invariants G1 à G8 (somme nulle, rien ne s'efface,
  idempotence, montants entiers, pas de passage du mauvais côté, cache = recalcul). (§5.1)
- Plan de comptes : argent (`A-*`), droits (`L-*`), attente (`S-ATTENTE`) ; comptes chauds sans cache. (§5.2)
- Liste fermée de types de transaction (`TOPUP`, `PURCHASE`, `REVERSAL`, `BREAKAGE`, `PAYOUT_*`…) avec leur
  schéma d'écriture. (§5.3)
- Moteur NestJS : un constructeur par type, unique appelant de `post_transaction` (seul point d'écriture en base),
  sauf cinq fonctions SQL (`take_deposit`, `refund_deposit`, `forfeit_deposit`, `refund_cash_due`, `preload_media`). (§5.4, §2.2)
- Calculs : entiers en unités mineures, arrondi demi vers l'extérieur, un arrondi par frais, taxe extraite une
  fois par transaction et par bénéficiaire ; 19 cas normatifs. (§5.5)
- Règles de frais (`fee_rule`) pour les quatre flux ; assiette `GROSS` ou `NET_OF_REFUNDS`. (§5.6)
- Erreurs métier : SQLSTATE `CL001` à `CL024` traduits en `ProblemCode` stables (RFC 9457). (§5.7)
- Scénario de référence de 48 transactions à rejouer par l'API, jusqu'à `CLOSED` et `LOCKED`. (§5.8)

### 2.2 Configuration, contrats, détenteur des fonds (§4)
- Cascade plateforme → prestataire → organisateur → événement → participation, versionnée ; bornée par le
  profil de législation (refus à l'enregistrement d'une configuration qui viole la loi). (§4.1)
- Paramètres : `wallet_scope`, `funds_holder` (choix obligatoire), `issuer`, `identity_mode`, `activation_modes`,
  `spend_order`, `refund_deadline`, `sync_deadline_hours`, plafonds carte, `breakage_destination`, etc. (§4.2)
- Contrats versionnés `PLATFORM_OPERATOR` et `OPERATOR_ORGANIZER` (porteurs des pertes, part de casse, assiette, contestations). (§4.3)
- Détenteur des fonds : `ORGANIZER`, `OPERATOR` ou `THIRD_PARTY` ; même modèle comptable. (§4.4)

### 2.3 Portefeuilles (§6)
- Portefeuille séparé du support ; comptes payé (remboursable) et offert (non remboursable). (§6.1)
- Ordre de consommation `PROMO_FIRST` / `PAID_FIRST`. (§6.2)
- Plafonds réglementaires ; niveau d'identification calculé (KYC au guichet, 4 derniers caractères de la pièce). (§6.3)
- Plusieurs devises : un portefeuille par devise sur un même bracelet. (§6.4)
- Règles du réseau limité (pas de transfert, pas de retrait sauf remboursement, pas d'intérêt, durée limitée). (§6.5)

### 2.4 Bracelets NFC (§7)
- MIFARE Ultralight EV1, format B 1.0 (28 octets, CRC), identité opaque, aucun montant sur la puce. (§7.1, §7.2)
- Mot de passe propre à chaque bracelet, dérivé par KMS (SP 800-108), stocké chiffré (AES-256-GCM, DEK enveloppée). (§7.3, §7.4)
- Personnalisation ; lecture à chaque passage avec `READ_SIG`, compteur, détection de copie ; un passage = une écriture. (§7.5, §7.6)
- Lots (kind, clé partagée ou dédiée, préchargement, caution, politique de réutilisation), cycle de vie. (§7.7)
- Cycle de vie du bracelet, activation (`DESK`, `SELF_APP`, `FIRST_TOPUP`), code de rattachement imprimé, remplacement. (§7.8)
- Caution en mode C (sur le solde) ou D (à part) ; ordre imposé au guichet de retour. (§7.9)
  Le serveur enchaîne les étapes du guichet de retour (caution, crédits offerts, solde, restitution) : livré par la
  mission 9, la mission 4 servant la restitution seule (décision du porteur du 15/10/2026, ADR-91, OP-N51).
- Cadrage de la mission 4 (porteur, 13/10/2026) : la bibliothèque de format existe en TypeScript et en Dart dès la
  mission 4 ; les routes de terminal et de festivalier y sont servies derrière un port d'identité, l'enrôlement réel
  des terminaux venant en mission 5a et les comptes festivaliers avec leur mission ; le KMS est un port avec un faux,
  l'adaptateur AWS réel venant quand la région et les comptes seront arrêtés (OP-N11) ; la caution payée à part se
  règle en espèces tant que la mission 6 (PSP) n'est pas livrée. Les routes back-office des lots, des clés, de la
  personnalisation et de la liste noire sont à ajouter au contrat.

### 2.5 Terminaux et encaissement (§8)
- Modes `CATALOG_POS`, `KEYPAD_TPE`, `TOPUP_DESK` (`PAIRED_TPE` refusé en V1). Catalogue à prix TTC fixe. (§8.1)
- Enrôlement sans MDM par code à usage unique ; clés dans le Keystore ; vendeurs par code PIN ; révocation. (§8.2)
- Paiement par QR (`MERCHANT_QR`, `CUSTOMER_QR`), toujours en ligne. (§8.3)
- Découpage (16/10/2026) : la mission 5a livre l'identité réelle du terminal (jeton d'appareil, mTLS, requêtes signées),
  les codes d'enrôlement (S5), l'enrôlement, la révocation, la configuration servie et le battement de cœur ; la
  mission 5b livre les vendeurs (S2), le catalogue et les lignes de vente (S18), le paiement par bracelet et par QR,
  l'annulation et l'identification au guichet (S24). Le schéma de référence n'a ni tables ni routes de contrat pour
  le catalogue et les vendeurs : la mission 5b les ajoute. Héritage de la mission 5a : l'enrôlement d'un terminal sur
  un événement clos ou un point de vente supprimé doit être refusé (OP-N74, ADR-120).
- Cadrage de la mission 5a (porteur, 19/10/2026) : jeton lié, mTLS et signature de chaque requête exigés ensemble sur
  les routes de terminal (contradiction avec §10.3 signalée) ; attestation vérifiée à l'enrôlement sur Android et iOS ;
  routes back-office des terminaux (liste, suspension, réactivation, révocation) ajoutées au contrat ; OP-N50 levée en 5a.
  Au plan (19/10/2026) : mTLS vérifié dans les processus ; terminaux Android 12 au moins ; `serial` unique par
  prestataire (ADR-109) ; grâce de 60 s au rafraîchissement d'un jeton (OP-N65) ; limite iOS consignée (OP-N64).
  À l'analyse (19/10/2026) : tout terminal est enrôlé pour un événement (code d'enrôlement lié à un événement).
- Cadrage de la mission 5b (porteur, 22/10/2026) : périmètre complet (vendeurs, catalogue, paiement par bracelet en un
  aller-retour ou en deux temps, annulation, QR commerçant et client, identification au guichet, OP-N74). Le PIN d'un
  vendeur (6 chiffres) est vérifié par le serveur, qui ouvre une session de vendeur liée au terminal (12 h au plus) et
  attribue lui-même chaque vente ; aucune empreinte de PIN ne quitte le serveur ; 5 échecs, comptés par vendeur sur
  tous les terminaux, bloquent le vendeur jusqu'au déblocage par le commerçant. Le PIN hors ligne est tranché par la
  mission 7. Seul le vendeur de la vente l'annule depuis le terminal d'origine dans la fenêtre, sinon un
  `SUPERVISOR`. Le prix d'une ligne de vente doit être celui du catalogue de la configuration servie au terminal ou le
  prix actuel. OP-N74 : enrôlement refusé dès `CLOSING` pour `CATALOG_POS` et `KEYPAD_TPE`, permis en `TOPUP_DESK`
  jusqu'à `CLOSED` ; `CLOSED` et point de vente supprimé refusent tout. Révocation d'une identification à deux
  (contrat ; §6.3 dit « un administrateur », contradiction signalée).
- Recharges (Wave, Orange Money, carte, espèces), remboursements (mobile, virement, espèces, espèces dues), OTP. (§8.5)
- App festivalier : compte par téléphone, rattachement, perte, consultation anonyme du solde. (§8.5)

### 2.6 En ligne, hors ligne, passerelle locale (§9, `sync_protocol.md`)
- Snapshot signé, plafonds hors ligne par politique (`offline_policy`), refus par défaut. (§9.1 à §9.4)
- Numérotation `seq` par terminal, lots de 500 opérations, registre des numéros, trous de séquence. (§9.5)
- Conflits à la synchronisation : commerçant garanti, part non couverte en compte d'attente. (§9.6)
- Passerelle locale qui prend l'autorité de débit pendant une coupure (bascule, époque, reprise forcée). (§9.7)

### 2.7 API (§10, `openapi.yaml`)
- `/v1`, problem+json, pagination par curseur, `Idempotency-Key` obligatoire sur toute écriture. (§10.1, §10.2)
- Authentification par type d'appelant ; jeton d'approbation pour la seconde personne au guichet. (§10.3)
- Endpoints back-office à ajouter au contrat (organisateurs, événements, catalogues, lots, clôture, versements…). (§10.4)

### 2.8 Argent réel : PSP, caisses, rapprochements, versements (§11)
- Adaptateurs Wave, Orange Money, PayDunya, Stripe ; configurations PSP par organisateur, choix par événement. (§11.1)
- Sessions de caisse d'espèces, écarts. (§11.2)
- Rapprochement ligne à ligne des relevés. (§11.3)
- Versements manuels en V1, à deux personnes, export CSV. (§11.4)

### 2.9 Cycle de l'événement et clôture (§12)
- `DRAFT` → `LIVE` → `CLOSING` → `RECONCILING` → `SETTLING` → `REFUND_WINDOW` → `CLOSED`, par `set_event_status` seulement. (§12.1)
- Droit de place, synchronisations tardives, casse réversible, clôture avec soldes restants. (§12.1)
- Contrôles permanents planifiés et liste fermée des types d'anomalie. (§12.2)
- Relevés et export comptable configurable (`account_mapping`). (§12.3)

### 2.10 Double validation et rôles (§3.2)
- Rôles humains de `PLATFORM_ADMIN` à `CUSTOMER`. Actions à deux personnes : jeton sur place au guichet,
  demande puis approbation au back-office (`approval_request`, 24 h).
- Personnes du personnel authentifiées par le serveur d'identité OIDC (jeton court ; connexion et rafraîchissement
  chez le serveur d'identité) ; prestataire et rôles déduits des données de la plateforme, jamais du jeton.
- Gestion des personnes et des rôles par portée (plateforme, prestataire, organisateur, événement, commerçant) via
  des routes du back-office ajoutées au contrat, chaque action journalisée ; amorçage du premier
  `PLATFORM_ADMIN` par une commande d'exploitation. (décidé le 08/10/2026, mission 2)
- Journal d'audit chaîné par empreintes (une chaîne par prestataire) et scellé périodiquement, sur le modèle du
  scellement du grand livre ; copie des scellements d'audit hors de la base avec celle du grand livre (mission 9).
  (décidé par le porteur du projet le 08/10/2026)

### 2.11 Sécurité et données personnelles (§13)
- RLS par prestataire, `assert_tenant`, clés dans KMS, journal d'audit, scellement du journal toutes les 5 min.

## 3. Hors périmètre (V1)

- Caisses tierces : intentions de paiement, `PAIRED_TPE`, webhooks sortants, SDK de lecture (V2, ADR-43). (§1.3)
- Contrôle d'accès, billetterie, bracelet-billet (ADR-41).
- Versements automatiques (calcul, export et enregistrement seulement).
- Portail web festivalier ; paiement NFC sur iOS (QR uniquement).
- Puces anti-clonage cryptographiques (Ultralight AES, NTAG 424 DNA).
- Conversion de devises à l'intérieur d'un grand livre.
- Remboursement par carte ; vérification d'identité en ligne (interface prévue, non implémentée). (§8.5, §6.3)
- Variantes, remises et stock au catalogue. (§8.1)
- Outils de sécurité automatiques en CI (reporté, OP-N37). (§13.6)

## 4. Acteurs et systèmes externes

**Acteurs humains** (§3.2) : `PLATFORM_ADMIN`, `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `SUPERVISOR`, `CASHIER`,
`MERCHANT_ADMIN`, `VENDOR`, `CUSTOMER`.

**Systèmes externes.**
- AWS KMS (dérivation, chiffrement enveloppe, signature des snapshots), Secrets Manager, RDS PostgreSQL 17,
  S3 Object Lock (copie des scellements). (§1.2, §13)
- PSP : Wave Business, Orange Money, PayDunya, Stripe (webhooks signés, relevés). (§11.1)
- Envoi des codes à usage unique : WhatsApp puis deux fournisseurs SMS (fournisseurs à choisir sur devis). (§8.5, ADR-66)
- Serveur d'identité OIDC pour l'authentification du personnel et les jetons d'approbation ; produit à choisir. (§3.2, §10.3)
- Banque (virements, relevés), fournisseur d'impression des bracelets (fichier de commande, correspondance code ↔ UID). (§7.8, §11)
- Passerelle locale sur site (mini-PC, Docker). (§9.7)

**Contraintes d'intégration** : webhooks vérifiés, stockés bruts, idempotents ; adaptateurs PSP derrière une
interface commune ; types TypeScript et Dart générés depuis `openapi.yaml`.

## 5. Contraintes techniques connues

- **Stack** (§1.2) : API NestJS (TypeScript) ; PostgreSQL ≥ 17 sur AWS RDS ; back-office React/Next.js ;
  apps terminal et festivalier en Flutter ; passerelle NestJS en Docker ; monorepo imposé (§2.1).
  Versions et choix d'implémentation : `docs/08-pile-logicielle.md` (référence arrêtée le 09/10/2026, ADR-78 :
  l'existant prime ; Redis, Prisma, Fastify et Nginx écartés).
- **Architecture** (§2.2) : point d'écriture unique `post_transaction` ; fonctions métier en base ;
  `set_config('app.operator_id', …, true)` par transaction ; idempotence partout ; types générés ; région paramétrable ; UTC.
- **Performance** (§15) : 200 terminaux, 50 ventes/s site, 20/s stand, démontrés à deux fois ; serveur seul p95 ≤ 200 ms ;
  bout en bout p95 ≤ 1,2 s ; transaction SQL ≤ 60 s.
- **Sécurité** (§13) : RLS forcée, KMS, rôles IAM séparés, Keystore, SQLCipher, scellement externe, audit externe avant pilote.
- **Réglementaire** : instrument à usage limité (ADR-48, sous condition d'avis juridique) ; plafonds BCEAO provisoires ;
  TVA 18 % provisoire ; SYSCOHADA indicatif ; données en `eu-west-3` provisoirement.
- **Critères d'acceptation** (§16) : pgTAP (400 + 64 assertions), 19 cas moteur en TS, scénario rejoué par l'API,
  vecteurs bracelet en TS et Dart, charge, coupure, tests de `sync_protocol.md` §13, cloisonnement sur toutes les routes.

## 6. Flux critiques identifiés

1. Paiement en ligne par bracelet en un seul aller-retour (`register_tap` → `post_transaction` → `consume_tap`). (§7.6)
2. Paiement hors ligne puis synchronisation par lot, avec garantie du commerçant. (§9.3 à §9.6)
3. Bascule d'autorité vers la passerelle et retour. (§9.7)
4. Recharge PSP : demande, webhook signé, écriture `TOPUP`, prise de caution due. (§8.5, §11.1)
5. Recharge et remboursement en espèces au guichet, avec seconde personne au-delà du seuil. (§8.5)
6. Activation, rattachement par code imprimé, perte et remplacement d'un bracelet. (§7.8)
7. Guichet de retour : caution, crédits offerts, solde, espèces dues, restitution. (§7.9)
8. Clôture d'un événement jusqu'à `CLOSED` et `LOCKED`, puis réclamations tardives. (§12.1)
9. Double validation back-office : demande puis approbation. (§3.2)
10. Enrôlement d'un terminal. (§8.2)

## 7. Glossaire métier

Repris de SPECIFICATION, annexe A : pool, prestataire, détenteur des fonds, émetteur, casse, compte chaud,
compte de contrepartie, snapshot, marge de recharge, droit net, position soldée, passage (`tap_id`),
espèces dues, passerelle, époque d'autorité, `seq`, PSP, HT/TTC. Les définitions font foi dans l'annexe A.

## 8. Découpage anticipé en missions

Découpage validé le 07/10/2026 (détail et commandes dans `PROMPTS-A-ENVOYER.md`), dans l'ordre de dépendance :

1. Fondations du grand livre et de l'API
2. Identité, rôles et double validation
3. Configuration, parties et événements
4. Bracelets NFC (format, clés, lots, cycle de vie)
5. Terminaux, découpée en deux missions le 16/10/2026 (décision du porteur) :
   5a. Identité et enrôlement des terminaux (avec les dettes de sécurité héritées de la mission 4)
   5b. Terminaux et paiement en ligne (vendeurs, catalogue, paiement par bracelet et par QR, identification au guichet)
6. Recharges, caisses et PSP
7. Hors ligne (snapshots et lots)
8. Passerelle locale
9. Remboursements, versements et clôture
10. App festivalier
11. Back-office web
12. App terminal (après la validation NFC sur vrais bracelets)
13. Recette V1

**Héritages de la mission 4 (bracelets NFC, 14/10/2026)** — besoin à reprendre par les missions suivantes, détail
dans `docs/POINTS_OUVERTS.md` et `docs/DECISIONS_ADR.md` (ADR-83 à ADR-101 ; missions d'OP-N41, OP-N44, OP-N45,
OP-N46, OP-N50 et OP-N54 proposées par l'agent et confirmées par le porteur le 15/10/2026) :
- mission 5a : identité réelle du terminal, requêtes signées (OP-N42) ; fonctions SECURITY DEFINER de la base
  protégées contre les tables temporaires de l'appelant (`pg_temp` ou `TEMPORARY` retiré), pour fermer un
  contournement probable du cloisonnement entre prestataires (OP-N59, ADR-96, bloque la production) ; droits
  d'exécution des fonctions du schéma accordés rôle par rôle, sans héritage de `PUBLIC` (OP-N44) ; lecture qui a
  confirmé un rattachement refusée par `consume_tap` (OP-N50) ; empreinte de requête à clé au registre d'idempotence,
  pour qu'un code imprimé ne se retrouve pas par essais (OP-N54, ADR-99) ;
- mission 5a, suite (correctif post-fusion n° 1 ; confirmé par le porteur le 16/10/2026) :
  retrait d'une clé dédiée possible seulement pendant un travail de retrait approuvé, y compris
  pour la personnalisation, et demande approuvée périmée refusée à l'inscription (OP-N62, ADR-102) ;
  clé d'accord d'un terminal écrite à l'enrôlement seulement, jamais réécrite par la connexion de
  l'API (OP-N63, ADR-105, bloque la production) ;
- mission 6 : compte de caisse ouvert avec la session ; sans lui, aucune espèce n'entre ni ne sort au guichet des
  bracelets (OP-N49) ;
- mission 7 : snapshots hors ligne inscrits par une fonction qui calcule elle-même la version, pour qu'une version
  plantée ne bloque plus les snapshots suivants (OP-N57) ; historique des politiques hors ligne écrit par son seul
  déclencheur, aux droits du propriétaire (OP-N58) ; deux faiblesses du kit relevées pendant la mission 4, qui
  bloquent toutes deux la production (décision du porteur du 15/10/2026) ; adaptateur AWS KMS réel du service de clés
  des bracelets, écrit avec celui de la signature des snapshots, après le choix de la région (OP-N41, bloque la
  production) ; droit par défaut global qui retire à `PUBLIC` l'exécution des fonctions futures, y compris créées à
  la main hors de `migrate.ts` (OP-N68, ADR-111, mission 5a) ; numérotation, présence et affectation d'un terminal
  écrites par des fonctions de la base, plus directement par l'API (OP-N69, ADR-112, mission 5a) ; adaptateurs réels
  de l'autorité des terminaux et du signataire des jetons d'appareil, avec celui d'OP-N41 (OP-N73, ADR-119,
  mission 5a, bloque la production) ; rôle de maintenance dédié aux purges des nonces et des essais d'enrôlement
  (OP-N75, ADR-114, mission 5a) ;
- mission 9 : enchaînement du guichet de retour (caution, crédits offerts, solde, restitution), servi par la mission 9
  (décision du porteur du 15/10/2026, OP-N51, ADR-91) ; rendu des espèces dues d'un bracelet remplacé (OP-N55,
  ADR-100) ;
- mission 10 : identité réelle du festivalier (OP-N43), liste et déclaration de perte de ses bracelets ; le
  rattachement par code, la demande en attente et l'activation depuis l'app sont déjà servis côté serveur.
- mission 10, suite (mission proposée par l'agent le 16/10/2026, à confirmer par le porteur) :
  rotation du secret d'empreinte des codes imprimés (`CLAIM_CODE_HMAC_KEY`) sans réimpression, par
  une double empreinte pendant une période bornée (OP-N47, ADR-104) ;
- mission 11 : décision d'une demande d'approbation liée à une preuve signée de la personne qui décide (serveur
  d'identité réel ou signature du valideur), pour que la base ne croie plus le valideur que lui passe l'API (OP-N56,
  ADR-94) ; lots de bracelets créés et modifiés par des fonctions seulement, sans `INSERT`/`UPDATE` direct de l'API
  sur `media_batch` ni statut de bracelet sans motif (OP-N60, ADR-97, bloque la production) ;
- mission 12 : signature d'originalité NXP vérifiée aussi par le serveur à la personnalisation, avec la clé publique
  NXP et les signatures réelles de la validation de la puce (OP-N46) ;
- mission 12, suite : activation et remplacement envoient la lecture complète du bracelet dans la
  requête (`tap`, `new_media_tap`), pas un identifiant de lecture (ADR-103) ;
- mission 12, héritée de la mission 5a : sur iOS, signer les requêtes par assertion App Attest (ou preuve
  équivalente) pour prouver la clé de signature dans la Secure Enclave ; d'ici là iOS reste borné au QR (OP-N64,
  ADR-106, décision du porteur du 19/10/2026) ; le port d'attestation iOS renvoie le `keyId` App Attest, stocké par le
  serveur, et l'app passe `iosClientDataHash` tel quel à `attestKey` ;
- mission 13 : preuve que la clôture d'un lot, le rattrapage du préchargement et le rechiffrement vont au bout sur un
  lot de 5 000 bracelets (NFR-008, OP-N61, ADR-98, décision du porteur du 15/10/2026, bloque la production) ;
  aiguillage des routes vers leur processus décrit et vérifié sur l'environnement de recette (OP-N45) ; grâce de 60 s
  au rafraîchissement d'un jeton d'appareil réexaminée selon les pertes réseau mesurées (OP-N65, ADR-108, mission 5a) ;
  identité de l'app Android lue dans la liste logicielle de Key Attestation, réexaminée sur les appareils cibles
  (OP-N67, ADR-110, mission 5a) ; limite de débit en amont sur l'enrôlement des terminaux, sans compte (OP-N72,
  ADR-117, mission 5a, confirmé par le porteur le 21/10/2026) ; essai d'`@peculiar/asn1-android` 2.10.0 et d'App Attest réel sur
  les appareils cibles ; à la mise en production, purge des lignes `api_idempotency` antérieures à T + 720 h (OP-N54,
  OP-N71) et réglage de `DEVICE_REQUEST_AUTHORITIES` (ADR-113).

## 9. Notes non classées

- **Points ouverts non bloquants pour le code mais bloquants pour la production** : OP-N3 (taxes, SYSCOHADA),
  OP-N11 (région AWS), OP-N12 (conservation) ; OP-N13 (algorithme de signature) à vérifier par l'agent. (POINTS_OUVERTS §2)
- **Actions préalables du porteur du projet** : validation de la puce sur de vrais bracelets et campagne de mesure NFC
  **avant le code de l'app terminal** (actions 1 et 2) ; accès de test PSP (action 11) ; devis OTP (action 10). (POINTS_OUVERTS §7)
- **Décisions de cadrage (7 octobre 2026)** : le découpage Spec Kitty couvre toute la V1 ; aucun code applicatif
  n'existe avant la première mission (un premier essai écrit hors Spec Kitty a été supprimé) ; la validation de la
  puce et la campagne NFC (actions 1 et 2) ne sont pas faites, donc la mission « app terminal » vient en dernier,
  avec cette condition préalable.
- **Environnement local** : PostgreSQL 17 installé, pgTAP et `pg_prove` absents ; Docker absent ; Flutter présent.
