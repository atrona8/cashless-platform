# Notes d'architecture — mission terminaux-paiement-en-ligne-01M52QB9

> État : **planifiée** (plan finalisé le 22/10/2026, `640f3eb`). Rédigé au plan ; à recaler après les relectures.

## Composant(s) introduit(s) ou modifié(s) par cette mission
- **API publique** (`apps/api`, NestJS 11) : modules `vendors/` (back-office, sessions par PIN), `catalog/`
  (catalogue versionné), `payments/` (paiement, consultation, annulation), `payment-requests/` (QR commerçant et
  client) ; garde exclusive « terminal ou personne » ; prestataire tiré du terminal pour l'idempotence d'une route de
  terminal seul ; `VENDOR_PIN_SECRET` et vérification d'`argon2` au démarrage.
- **Dépendance nouvelle** : `argon2@0.44.0` (document 08 ; binaires N-API précompilés, provenance SLSA vérifiée,
  `ignore-scripts=true` respecté).
- **Base** (`packages/ledger-sql`, migrations `0031` à `0035`) : tables S2 (`vendor`, sessions, essais de PIN) et S18
  (catalogue, versions, lignes de vente), attribution des ventes, détail des demandes QR ; fonctions SECURITY DEFINER
  pour chaque écriture ; index unique « une seule annulation » ; `consume_tap` et `set_device_status` remplacées ;
  `record_device_seq` accordée à l'API ; OP-N74 dans `create_device_enrollment_code` et `enroll_device`.
- **Approbation sur place** (`approval/onsite/`) : variante pour un appelant terminal (session de vendeur), action
  `SALE_REVERSAL` à deux personnes au back-office.

## Décisions d'architecture prises dans cette mission
| Décision | Justification | Alternative envisagée |
|---|---|---|
| PIN vérifié par le serveur, session de vendeur liée au terminal, attribution par la base d'après la session | Aucune empreinte de PIN sur le terminal ; relevés par vendeur fiables | PIN vérifié sur le terminal (empreinte volable avec l'appareil) |
| argon2id avec secret hors base (`VENDOR_PIN_SECRET`) | Un PIN de 6 chiffres se retrouve depuis une empreinte volée sans secret | argon2id seul |
| « Compter d'abord » : essai compté et validé avant la vérification, hors verrou | Blocage atomique au 5e échec, même sous essais simultanés ou plantage | Compteur dans la transaction de vérification (annulable) |
| Catalogue en versions immuables ; prix de la version courante ou de la dernière servie au terminal | Pas de vente à un prix inventé ni de refus la minute qui suit un changement de prix | Prix actuel seul ; toute version déjà servie (élargissement, écarté à la passe contradictoire) |
| Paiement en une transaction : numéro du terminal, terminal, session, lecture, portefeuille, moteur, lignes, passage | §7.6 : tout ou rien ; ordre global des verrous contre les interblocages | Fonction SQL unique (le moteur d'écritures est en TypeScript) |
| Fenêtre d'annulation mesurée à l'heure de la base ; heure du terminal bornée à ±120 s | Un terminal à l'horloge avancée n'allonge pas sa fenêtre | Heure envoyée par le terminal |
| Demandes QR écrites par la base, routes à jeton sans réponse rejouée | Usage unique et aucun jeton en clair, même dans le registre d'idempotence | Écritures directes, réponse rejouée |
| Côté festivalier du QR derrière le port d'identité du festivalier | Pas d'identité réelle avant la mission 10 ; aucun faux en production | Reporter le QR côté festivalier |
| Identification au guichet reportée à la mission 10 | Pas de numéro vérifié ni de lien agent-festivalier en base | Servir avec deux contrôles en dette |

## Écarts au plan (sens)
- Renforcements : annulation unique en base ; demandes QR et identification retirées aux écritures directes de l'API ;
  réaffectation et réglages d'un terminal (`event_id`, `pos_id`, `app_mode`, `nfc_enabled`, `personal_phone`) retirés
  à l'API.
- Limite acceptée et consignée : OP-N76 / ADR-121 (la base croit l'API pour la vérification du PIN), levée avec
  OP-N56 en mission 11.
- OP-N43 complété (routes de paiement QR côté festivalier) ; OP-N74 levé par la mission.

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions d'architecture notables » et domaine « Terminaux et
encaissement ».

## Nécessaire pour cette mission ? Oui — la mission ajoute quatre modules, une dépendance, cinq migrations et touche les droits de la base.
## Complet ? Oui pour le plan — à recaler sur le code livré.
## Validé par : Agent, par délégation du porteur (22/10/2026)
