# Cas d'usage : mission routes-backoffice-01M86KT6

> État : **plan finalisé le 24/11/2026, rien n'est codé** (mission 11b « Routes serveur du back-office », plan commité `d92b4133`, artefacts `612a4291`).
> Source : `spec.md`, `plan.md`, `research.md`, `contracts/backoffice-routes.md`. **Les ajouts au contrat A1 à A6 et les décisions D4, D7, D9, D10 de `research.md`
> sont validés par le porteur le 24/11/2026** ; D1 à D3 sont décidées par lui (24/11/2026), D5, D6 et D8 acceptées avec l'alignement technique. Diagrammes `/illustre`
> (police sans empattement, rendus relus), sources et générateur dans [`diagrams/`](diagrams/) (`generate.py`).

## Cas d'usage propres à cette mission

![Cas d'usage des routes du back-office](diagrams/usecase-routes-backoffice.png)

Sources : [`usecase-routes-backoffice.excalidraw`](diagrams/usecase-routes-backoffice.excalidraw), [`usecase-routes-backoffice.svg`](diagrams/usecase-routes-backoffice.svg).

| Cas d'usage | Acteur | Règle prévue | Opération prévue (ajout au contrat) |
|---|---|---|---|
| Savoir qui je suis et ce que je peux faire | Personnel connecté | Profil : identité, rôles et portées, rien d'autre ; sans rôle actif : profil vide, pas d'erreur ; festivalier et terminal refusés ; chaque opération du contrat déclare ses rôles, un contrôle automatique échoue si la déclaration dérive (matrice échantillon, D3) | `GET /staff/me` (A1), extension `x-roles` sur les 227 opérations (A2, **forme à trancher : sur chaque opération, recommandée, ou table unique**) |
| Lister et ouvrir les ventes | Administrateur dans sa portée (organisateur, événement, commerçant) | Filtres point de vente, commerçant, vendeur, période, statut ; curseur, 200 maximum ; vente annulée marquée avec la référence de l'annulation ; administrateur de commerçant : ses ventes seulement (filtre en requête, D6) ; hors portée : 404 | `GET /events/{event_id}/sales`, `GET /sales/{transaction_id}` (A3) |
| Lister et classer les anomalies | Administrateur de prestataire ou d'organisateur | Liste filtrée (type, statut, événement, période) ; classement « traitée » avec motif obligatoire, **sans aucune écriture au grand livre**, seulement pour 10 types (D1) ; les autres : `422 VALIDATION_FAILED`, `reason ANOMALY_KIND_NOT_CLASSIFIABLE` ; déjà traitée : `409 CONFLICT_STATE` ; classement par fonction de la base, droit direct de clore retiré à l'application (D4, **à valider**) | `GET /anomalies`, `POST /anomalies/{anomaly_id}/classification` (A4) |
| Retrouver un bracelet ou un portefeuille | Personnel dans sa portée | Par UID ou code imprimé, ou par portefeuille ; statut, événement, soldes ; hors portée : vide sans indice ; ancien code d'un bracelet réattribué : rien | `GET /search/media`, `GET /search/wallets/{wallet_id}` (A5) |
| Chercher un festivalier par numéro exact | Administrateur dans sa portée, superviseur | `POST`, numéro E.164 exact, jamais dans l'URL ; vendeur et caissier refusés ; aucune recherche partielle ; numéro masqué en réponse ; 20 par minute et par personne (D8) ; audit sans le numéro, ni en clair ni en empreinte (D7, **à valider**) | `POST /search/customers` (A5) |
| Tenir les modèles de téléphone | Administrateur plateforme (écriture), autres administrateurs (lecture) | Table de plateforme, niveau `RECOMMENDED` ou `TOLERATED`, date de mesure ; sur la fiche et la liste des terminaux : `RECOMMENDED`, `TOLERATED` ou `UNTESTED` ; **aucun refus d'enrôlement** ; modèle déclaré par le terminal, donc informatif (D2, accordé ; D9, **à valider**) | `GET /phone-models`, `PUT` et `DELETE /phone-models/{manufacturer}/{model}` (A6), `device_model` facultatif sur l'enrôlement et le signal de vie (accordé), `device_model` et `nfc_level` facultatifs sur les réponses des terminaux (**à confirmer**) |

Hors périmètre : écrans (mission 11), résolutions d'anomalie qui écrivent de l'argent (mission suivante, type par type, à consigner), nouveaux types d'anomalie (C-005).

## Lien avec la synthèse globale

Contribue à : `docs/02-use-case-diagram.md`, domaines « Administration et exploitation » (lectures, classement, recherche) et « Terminaux et encaissement » (niveau NFC des modèles) ; aucun domaine nouveau, aucun renommage ni fusion de cas d'usage globaux.

## Nécessaire pour cette mission ? Oui : six cas d'usage nouveaux et quatre acteurs (réponse proposée par l'Agent le 24/11/2026, validée par le porteur le 24/11/2026).
## Complet ? Oui pour le plan : refus et motifs distincts en texte, liste des 10 types classables dans `research.md` D1 ; à relire quand les ajouts au contrat seront tranchés (réponse proposée par l'Agent le 24/11/2026, validée par le porteur le 24/11/2026).
## Validé par : réponse proposée par l'Agent le 24/11/2026, validée par le porteur le 24/11/2026.
