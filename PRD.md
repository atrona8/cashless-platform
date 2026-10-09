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

### 2.5 Terminaux et encaissement (§8)
- Modes `CATALOG_POS`, `KEYPAD_TPE`, `TOPUP_DESK` (`PAIRED_TPE` refusé en V1). Catalogue à prix TTC fixe. (§8.1)
- Enrôlement sans MDM par code à usage unique ; clés dans le Keystore ; vendeurs par code PIN ; révocation. (§8.2)
- Paiement par QR (`MERCHANT_QR`, `CUSTOMER_QR`), toujours en ligne. (§8.3)
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
  Versions et choix d'implémentation : `docs/08-pile-logicielle.md` (document du porteur du 09/10/2026, en partie
  divergent des sources normatives : arbitrage en attente, OP-N39).
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
5. Terminaux et paiement en ligne
6. Recharges, caisses et PSP
7. Hors ligne (snapshots et lots)
8. Passerelle locale
9. Remboursements, versements et clôture
10. App festivalier
11. Back-office web
12. App terminal (après la validation NFC sur vrais bracelets)
13. Recette V1

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
