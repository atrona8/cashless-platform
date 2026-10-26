# Cas d'usage — mission terminaux-paiement-en-ligne-01M52QB9

> État : **relue, 14 lots approuvés (26/10/2026) ; accept/merge à venir**. Rédigé au plan (22/10/2026, `640f3eb`),
> recalé le 26/10/2026 sur le code livré (lane `n`, WP01 à WP14 fusionnés).

## Cas d'usage propres à cette mission

![Cas d'usage de l'encaissement en ligne](diagrams/usecase-encaissement.png)

Sources : [`usecase-encaissement.excalidraw`](diagrams/usecase-encaissement.excalidraw), [`usecase-encaissement.svg`](diagrams/usecase-encaissement.svg).

| Cas d'usage | Acteur | Règle principale (livrée) | Route |
|---|---|---|---|
| Gérer les vendeurs | `MERCHANT_ADMIN` (son commerce), `OPERATOR_ADMIN` | PIN de 6 chiffres, empreinte argon2id avec secret hors base ; nouveau PIN = déblocage ; désactivation ferme les sessions ; le terminal ne voit que les vendeurs actifs et non bloqués | `GET/POST /merchants/{id}/vendors`, `GET /vendors/{id}`, `POST /vendors/{id}/pin`, `POST /vendors/{id}/status` |
| Gérer le catalogue | `ORGANIZER_ADMIN` ; `MERCHANT_ADMIN` si délégué | Prix TTC fixe, taux par article, libellés FR/EN ; chaque modification crée une version immuable ; lecture d'une version ; politique de délégation | 7 opérations `/points-of-sale/{id}/catalog…`, `/catalog-categories/…`, `/catalog-items/…` |
| Ouvrir sa session (PIN) | Vendeur, sur le terminal | Un essai à la fois par terminal (`429`), essai compté avant la vérification ; 5 échecs bloquent jusqu'au commerçant ; une session par terminal, 12 h ; `401` neutre ; PIN mal formé `422` ; un renvoi de la même clé `409` | `GET /vendor-sessions/vendors`, `POST /vendor-sessions`, `DELETE /vendor-sessions/current` |
| Encaisser par bracelet | Vendeur | Un aller-retour, tout ou rien ; `X-Authority-Epoch` obligatoire ; lignes au prix de la version courante ou dernière servie ; vente attribuée par la session ; deux temps par `tap_id` ; un refus ne consomme pas le passage | `POST /payments`, `GET /payments/{id}` |
| Encaisser par QR | Vendeur | QR commerçant (jeton 128 bits, 60 s, rendu une fois dans `qr_payload`) ou QR client (12 caractères, 60 s) ; usage unique garanti par la base ; seule l'empreinte est gardée ; attente de la réponse jusqu'à 25 s | `POST/GET /payment-requests…`, `POST /payments` |
| Annuler sa vente | Vendeur de la vente | Terminal d'origine, vendeur, puis fenêtre de l'événement mesurée à l'heure de la base ; une seule annulation (base) ; `422 REVERSAL_NOT_ALLOWED`, `409 REVERSAL_WINDOW_EXPIRED`, `409 ALREADY_REVERSED` | `POST /payments/{id}/reversal` |
| Payer un QR | Festivalier (app) | Port d'identité du festivalier : faux en test, refusé en production ; réel en mission 10 ; jeton en en-tête `X-Payment-Request-Token`, refus sans oracle (`404`/`409`/`422` uniques) | `POST /payment-requests/{id}/pay`, `POST /me/customer-qr-tokens`, lecture et annulation par le jeton |
| Annuler hors fenêtre | `SUPERVISOR` ; `ORGANIZER_ADMIN` au back-office | Au terminal : `SUPERVISOR` par jeton sur place (`X-Approval-Token`, lié à la vente, usage unique). Au back-office : un `SUPERVISOR` ou `ORGANIZER_ADMIN` de l'événement demande (`202`, demande `SALE_REVERSAL`, rien au grand livre), une seconde personne distincte approuve et exécute (ADR-122, ADR-129) | idem, puis `POST /approval-requests/{id}/approve` |

Hérité de la mission 5a, **levé** (OP-N74, ADR-120, migration 0035) : l'enrôlement d'une caisse est refusé quand
l'événement est `CLOSED` (et dès `CLOSING` pour les modes catalogue et clavier) ; le guichet reste possible. Ce n'est pas un
cas d'usage nouveau : il durcit « Émettre un code d'enrôlement » et « S'enrôler » (domaine « Terminaux »).

Écarts plan → réalisé (tous dans le sens d'un renforcement ou d'un alignement sur le contrat) : annulation au back-office
par demande à deux personnes et `202` (le plan parlait d'un `403` ; ADR-129) ; codes `422`/`409` d'annulation et `422` du
QR client (ADR-123) ; PIN mal formé en `422` ; QR de lecture et d'annulation du festivalier par en-tête, `404` unique ;
liste du terminal sans vendeur bloqué ; `ORGANIZER_ADMIN` peut demander l'annulation (droit plus large accepté, ADR-122).

Reporté à la mission 10 (décision du porteur au plan) : identification d'un festivalier au guichet.

## Lien avec la synthèse globale
Contribue à : `docs/02-use-case-diagram.md`, domaine « Terminaux et encaissement » (vue terrain : « Encaisser une
vente », « Annuler une vente » ; vue administration : « Gérer vendeurs et catalogue » ; vue festivalier : « Payer par
QR »).

## Nécessaire pour cette mission ? Oui — la mission introduit les vendeurs, le catalogue, le paiement et l'annulation.
## Complet ? Oui — recalé le 26/10/2026 sur le code livré (à confirmer par le porteur).
## Validé par : en attente du porteur (proposition de l'Agent, 26/10/2026)
