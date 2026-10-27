# Notes d'architecture — mission recharges-caisses-psp-01M5YEBA

> État : **plan finalisé le 27/10/2026** ; décisions telles que planifiées (`plan.md`, `research.md` R-01 à R-20,
> `data-model.md`, `contracts/`). À recaler sur le code livré.

## Composant(s) introduit(s) ou modifié(s) par cette mission
- **API publique** (`apps/api`, NestJS 11) : modules `cash-sessions/`, `topups/cash/`, `topups/psp/`, `psp-configurations/`,
  `webhooks/` (corps brut, taille, signature, horodatage), `chargebacks/` ; ports `PspAdapter` et `PspSecretStore` avec un
  faux par fournisseur (`WAVE`, `ORANGE_MONEY`, `PAYDUNYA`, `STRIPE`) et un faux coffre ; `counter-access.ts` et les routes
  de caution, d'espèces dues et de libération servent la session ; découpage `TOPUP_CASH` limité au hors ligne.
- **Travailleur `psp-poller`** (`main.psp-poller.ts`, modèle `ProcessWorker`, `--once` par l'ordonnanceur externe) :
  interrogation des recharges `PENDING`, expiration, reprise des notifications `UNMATCHED` et `RETRY`.
- **Base** (`packages/ledger-sql`, migrations `0036` à `0038`) : `cash_session`, `cash_desk`, `cash_session_count`,
  `cash_session_tx`, `psp_configuration`, `event_psp_selection`, `psp_topup`, `psp_event`, `psp_webhook_rejection`,
  `psp_chargeback` ; garde de caisse sur `posting` ; comptes `A-PSP-*` ; écritures par fonctions SECURITY DEFINER seulement ;
  droits par colonne (`secret_ref`, `body`) ; extensions de listes fermées (`fee_rule.scope_type`, `anomaly.kind`,
  `approval_request.action`).
- **Dépendances** : aucune nouvelle (HMAC-SHA256 et `timingSafeEqual` de `node:crypto` ; `axios` attend les adaptateurs réels).

## Décisions d'architecture prises dans cette mission
| Décision | Justification | Alternative envisagée |
|---|---|---|
| Une caisse par terminal `TOPUP_DESK`, créée par la base à la première session | ADR-89 ; une caisse = un tiroir = un poste | Compte fourni par le back-office (rendu d'espèces sur la caisse d'un autre poste) |
| Garde de caisse en base : aucune écriture sur une caisse inscrite sans session `OPEN` | Aucune espèce hors contrôle, quelle que soit la route | Contrôle dans l'API seule |
| Comptage à l'aveugle, fermeture par un `SUPERVISOR` n'ayant pas compté | Un agent seul ajusterait le compté au théorique | `SUPERVISOR` seul (contrat) |
| Sessions tenues depuis le terminal (3 preuves + personne) | Un jeton d'agent volé n'ouvre pas une caisse à distance | Jeton de personne seul (contrat) |
| Recharge espèces en ligne : refus au-delà du plafond ; découpage réservé au hors ligne, avec anomalie | SPECIFICATION §5.3, §5.7 ; défaut du moteur corrigé | Découper pour toute source |
| Notification : vérifier, conserver brute si authentifiée, puis traiter ; refus signalés sans stockage du corps | Concilie §11.1 et le contrat sans exposer la base au volume non authentifié | Stocker tout corps reçu |
| Aucun crédit sans notification authentifiée ; paiement non créditable : `FAILED`, anomalie `PSP_TOPUP_NOT_CREDITED` portant le montant | Pas d'argent créé ni perdu en silence ; remboursement hors plateforme (OP-N82) | Écriture d'attente (reportée, mission 9) |
| Clés d'écriture qualifiées par la configuration ; référence marchande = `psp_topup_id` | Plus sûres que le contrat ; corrélation sans ambiguïté | Clés du contrat |
| Faux PSP et faux coffre refusés au démarrage en production ; en production, fournisseur « indisponible » | Règle 2 de `CLAUDE.md` ; le processus public démarre avec les espèces | Adaptateurs réels dans cette mission (reportés par le porteur, OP-N81, ADR-131) |
| `secret_ref` seulement en base, lié au titulaire ; secrets lus par le port | Aucun secret en base, en environnement ni en journal (ADR-125) | Secret chiffré en base |
| Frais PSP : règle de portée `PSP_CONFIGURATION` (ADR-133) | Frais selon la configuration de la recharge | Convention `PSP:<canal>` d'ADR-82 |

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » ; `docs/03-context-diagram.md` (PSP et coffre en faux, OP-N81).

## Nécessaire pour cette mission ? Oui — nouveau travailleur, nouvelles tables, deux ports et une garde de base.
## Complet ? Oui au stade plan — à recaler sur le code livré (à confirmer par le porteur).
## Validé par : en attente du porteur (proposition de l'Agent, 27/10/2026)
