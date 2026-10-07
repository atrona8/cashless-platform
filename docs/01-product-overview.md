# Description produit — orientée fonctionnelle

> Statut de complétude : voir `06-docs-status.md`. Dernière mise à jour motivée par :
> initialisation du 07/10/2026 (à partir de `PRD.md`, lui-même tiré de `SPECIFICATION.md` v1.2).
> Le détail normatif de chaque règle est dans `docs/SPECIFICATION.md` (section citée entre parenthèses).

## Vision
Un système de paiement fermé (cashless) multi-tenant pour festivals, concerts et lieux permanents : le festivalier
paie avec un bracelet NFC ou un QR code, même quand le réseau tombe, et le système tient une comptabilité exacte,
en partie double, de l'argent encaissé et dû à chaque intervenant (§1.1).

## Personas
| Persona | Objectifs | Frustrations actuelles |
|---|---|---|
| Festivalier (`CUSTOMER`, ou anonyme) | Payer vite, connaître son solde, récupérer son reste à la fin | Files d'attente aux caisses, soldes perdus, remboursement opaque |
| Vendeur (`VENDOR`) | Encaisser en une seconde, même sans réseau | Terminal qui refuse quand le réseau tombe |
| Caissier de guichet (`CASHIER`) | Recharger, poser une caution, rembourser, remplacer un bracelet | Erreurs de caisse, contrôle à deux personnes lourd |
| Commerçant (`MERCHANT_ADMIN`) | Être payé de toutes ses ventes, hors ligne comprises | Ventes hors ligne contestées, relevés incomplets |
| Organisateur (`ORGANIZER_ADMIN`, `SUPERVISOR`) | Configurer l'événement, maîtriser le risque hors ligne, clôturer et verser | Clôture longue, écarts entre caisses, PSP et ventes |
| Prestataire cashless (`OPERATOR_ADMIN`) | Fournir bracelets et terminaux à plusieurs organisateurs, isolés entre eux | Données mélangées, clés de bracelets exposées |
| Plateforme (`PLATFORM_ADMIN`) | Superviser les prestataires, percevoir la redevance | Visibilité sur l'ensemble |

*(Frustrations déduites du contexte : la spécification décrit les exigences, pas les irritants actuels.)*

## Périmètre fonctionnel actuel
Aucun domaine n'est encore implémenté au 07/10/2026 : seuls existent la spécification, le schéma SQL de référence
avec ses tests pgTAP, le contrat OpenAPI et le banc NFC prototype. Les missions associées seront renseignées au
fil du découpage (`PROMPTS-A-ENVOYER.md`).

### Grand livre et moteur d'écritures
- Description : comptabilité en partie double par pool d'argent ; un seul point d'écriture (`post_transaction`) ;
  calculs entiers des frais, taxes et partages ; erreurs métier stables (§5).
- Statut : 📋 planifié (schéma de référence et tests pgTAP fournis par le kit)
- Mission(s) associée(s) : à définir

### Configuration, contrats et détenteur des fonds
- Description : cascade versionnée plateforme → prestataire → organisateur → événement → commerçant, bornée par
  le profil de législation ; contrats ; détenteur des fonds par événement (§4).
- Statut : 📋 planifié
- Mission(s) associée(s) : à définir

### Portefeuilles, identification et plafonds
- Description : portefeuille séparé du bracelet, crédits payés et offerts, plafonds réglementaires, identification
  au guichet, plusieurs devises, règles du réseau limité (§6).
- Statut : 📋 planifié
- Mission(s) associée(s) : à définir

### Bracelets NFC
- Description : format B, mot de passe par bracelet dérivé par KMS et stocké chiffré, personnalisation, lecture
  avec détection de copie, lots, cycle de vie, code de rattachement imprimé, caution (§7).
- Statut : 📋 planifié
- Mission(s) associée(s) : à définir

### Terminaux et encaissement
- Description : caisse à catalogue, TPE clavier, guichet de recharge ; enrôlement sans MDM ; paiement QR ;
  recharges, remboursements (§8).
- Statut : 📋 planifié (app terminal conditionnée à la validation NFC sur vrais bracelets)
- Mission(s) associée(s) : à définir

### Hors ligne et passerelle locale
- Description : snapshot signé, plafonds hors ligne, lots numérotés, conflits, passerelle locale qui prend
  l'autorité de débit pendant une coupure (§9, `sync_protocol.md`).
- Statut : 📋 planifié
- Mission(s) associée(s) : à définir

### Argent réel : PSP, caisses, rapprochements, versements
- Description : Wave, Orange Money, carte (PayDunya, Stripe) ; sessions de caisse ; rapprochements ; versements
  manuels à deux personnes (§11).
- Statut : 📋 planifié
- Mission(s) associée(s) : à définir

### Cycle de l'événement et clôture
- Description : statuts `DRAFT` à `CLOSED`, conditions de clôture vérifiées par la base, droit de place, casse
  réversible, contrôles permanents, relevés et export comptable (§12).
- Statut : 📋 planifié
- Mission(s) associée(s) : à définir

### App festivalier
- Description : compte par téléphone vérifié, solde et historique, recharge, paiement QR, rattachement, perte,
  remboursement ; consultation anonyme du solde par code (§8.5).
- Statut : 📋 planifié
- Mission(s) associée(s) : à définir

### Back-office web
- Description : interfaces plateforme, prestataire, organisateur, commerçant ; double validation par demande puis
  approbation (§1.2, §3.2, §10.4).
- Statut : 📋 planifié
- Mission(s) associée(s) : à définir

## Hors périmètre (confirmé)
- Caisses tierces : intentions de paiement, TPE associé (`PAIRED_TPE`), webhooks sortants, SDK (V2, ADR-43).
- Contrôle d'accès, billetterie, bracelet-billet (ADR-41).
- Versements automatiques ; portail web festivalier ; paiement NFC sur iOS.
- Puces anti-clonage cryptographiques ; conversion de devises dans un grand livre.
- Remboursement par carte ; vérification d'identité en ligne (interface prévue seulement).
- Variantes, remises et stock au catalogue.

## Glossaire métier
(Source : `SPECIFICATION.md`, annexe A, qui fait foi.)

| Terme | Définition |
|---|---|
| Pool | Réserve d'argent réel dans une devise, avec la liste des droits sur cet argent ; un grand livre |
| Prestataire | Opérateur cashless ; unité d'isolation des données (tenant) |
| Détenteur des fonds | Titulaire des comptes d'argent d'un événement |
| Émetteur | Partie qui doit les crédits aux festivaliers |
| Casse | Soldes non réclamés à l'échéance du délai de remboursement |
| Compte chaud | Compte à très fort volume, sans solde en cache ni verrou |
| Compte de contrepartie | Sous-compte de droit à solde normal débiteur (charges, versements reçus) |
| Snapshot | Liste signée des bracelets et soldes envoyée aux terminaux pour le hors ligne |
| Marge de recharge | Montant qu'une recharge peut encore créditer sans dépasser le plafond de solde ni le plafond mensuel |
| Droit net | Somme de tous les comptes de droits d'une partie dans un grand livre |
| Position soldée | Droit net nul pour une partie titulaire ; solde nul pour un compte sans titulaire |
| Passage (`tap_id`) | Lecture d'un bracelet enregistrée ; sert à une seule écriture |
| Espèces dues | Espèces encaissées hors ligne au-delà d'un plafond, à rendre au client |
| Passerelle | Serveur local d'un site qui peut prendre l'autorité de débit pendant une coupure |
| Époque d'autorité | Entier incrémenté à chaque bascule de l'autorité de débit |
| `seq` | Numéro d'opération d'un terminal, unique et croissant |
| PSP | Prestataire de services de paiement (Wave, Orange Money, carte) |
| HT, TTC | Hors taxe, toutes taxes comprises |

## Questions de nécessité/complétude posées lors de la dernière révision
- Nécessaire pour ce projet ? Voir `06-docs-status.md`.
- Complet au vu de l'état actuel du système ? Voir `06-docs-status.md`.
- Validé par : en attente.
