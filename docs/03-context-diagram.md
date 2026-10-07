# Diagramme de contexte statique

> Statut de complétude : voir `06-docs-status.md`. Notation C4 "Contexte" (niveau 1),
> supportée nativement par Mermaid (`C4Context`). Rendu en repli Mermaid (`excalidraw-diagram-skill` non installé).
> Dernière mise à jour : initialisation du 07/10/2026 (`SPECIFICATION.md` §1.2, §3, §11, §13 ; `PRD.md` §4).

## Vue d'ensemble

```mermaid
C4Context
    title Contexte système — Cashless Platform

    Person(fest, "Festivalier", "Paie, recharge, se fait rembourser")
    Person(staff, "Staff terrain", "Vendeurs, caissiers, superviseurs")
    Person(admins, "Administrateurs", "Plateforme, prestataire, organisateur, commerçant")

    System(cashless, "Cashless Platform", "Paiement fermé, grand livre, hors ligne")

    System_Ext(psp, "PSP", "Wave, Orange Money, PayDunya, Stripe")
    System_Ext(otp, "Envoi des codes", "WhatsApp, deux fournisseurs SMS")
    System_Ext(kms, "AWS KMS", "Clés des bracelets, signatures")
    System_Ext(s3, "Stockage scellements", "S3 Object Lock")
    System_Ext(idp, "Serveur d'identité", "OIDC, jetons d'approbation")
    System_Ext(bank, "Banque", "Virements, relevés")
    System_Ext(print, "Imprimeur bracelets", "Codes imprimés, correspondance UID")

    Rel(fest, cashless, "App, bracelet, QR")
    Rel(staff, cashless, "Terminaux Android et iOS")
    Rel(admins, cashless, "Back-office web")
    Rel(cashless, psp, "Paiements, webhooks, relevés")
    Rel(cashless, otp, "Codes à usage unique")
    Rel(cashless, kms, "Dérivation, chiffrement, signature")
    Rel(cashless, s3, "Copie des scellements")
    Rel(cashless, idp, "Authentification")
    Rel(cashless, bank, "Relevés importés")
    Rel(cashless, print, "Fichiers de commande")
```

## Acteurs et systèmes externes (tableau de référence)

| Acteur / système | Type | Rôle vis-à-vis du système |
|---|---|---|
| Festivalier | Personne | Charge un portefeuille, paie par bracelet NFC (Android) ou QR, récupère son solde ; anonyme ou avec compte |
| Staff terrain (`VENDOR`, `CASHIER`, `SUPERVISOR`) | Personne | Encaisse, recharge, gère cautions et bracelets, valide en seconde personne |
| Administrateurs (`PLATFORM_ADMIN`, `OPERATOR_ADMIN`, `ORGANIZER_ADMIN`, `MERCHANT_ADMIN`) | Personne | Configurent, supervisent, clôturent, versent, consultent les relevés |
| PSP (Wave Business, Orange Money, PayDunya, Stripe) | Système externe | Encaissent les recharges ; webhooks signés ; relevés à rapprocher |
| Envoi des codes (WhatsApp, SMS principal, SMS de repli) | Système externe | Livrent les codes à usage unique (fournisseurs à choisir, ADR-66) |
| AWS KMS | Système externe | Dérivation des mots de passe des bracelets, chiffrement enveloppe, signature des snapshots |
| AWS Secrets Manager | Système externe | Identifiants PSP et secrets de webhooks, rattachés au détenteur des fonds |
| S3 Object Lock (compte AWS distinct) | Système externe | Copie en écriture unique des scellements du journal |
| Serveur d'identité OIDC | Système externe | Jetons des personnes et jetons d'approbation sur place |
| Banque | Système externe | Virements des versements (hors système en V1), relevés importés |
| Imprimeur de bracelets | Système externe | Reçoit les codes de rattachement ; renvoie la correspondance code ↔ UID s'il encode les puces |

La passerelle locale (mini-PC sur site) fait partie du système : elle figure dans `04-architecture-diagram.md`.

## Questions de nécessité/complétude posées lors de la dernière révision
- Nécessaire pour ce projet ? Voir `06-docs-status.md`.
- Complet au vu des systèmes externes réellement intégrés à ce jour ? Voir `06-docs-status.md`.
- Validé par : en attente.
