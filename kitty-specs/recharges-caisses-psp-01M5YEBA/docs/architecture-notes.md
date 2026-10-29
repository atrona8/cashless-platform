# Notes d'architecture — mission recharges-caisses-psp-01M5YEBA

> État : **relue le 29/10/2026, 14 lots approuvés** ; recalé sur le code de la lane
> `kitty/mission-recharges-caisses-psp-01M5YEBA-lane-m` (plan : `plan.md`, `research.md` R-01 à R-20, `data-model.md`,
> `contracts/`). Les écarts sont listés en bas de page.

## Composant(s) introduit(s) ou modifié(s) par cette mission
- **API publique** (`apps/api`, NestJS 11) : modules `cash-sessions/` (dont `TerminalOrPersonGuard` : terminal + personne,
  ou personne seule, pour la fermeture et la lecture), `topups/cash/`, `topups/psp/`, `psp-configurations/`, `webhooks/`
  (corps brut, taille, signature, horodatage), `chargebacks/` (contestations, contestation tardive, déblocage) ; ports
  `PspAdapter` et `PspSecretStore` avec un faux par fournisseur (`WAVE`, `ORANGE_MONEY`, `PAYDUNYA`, `STRIPE`) et un faux
  coffre ; `counter-access.ts` et les routes de caution, d'espèces dues et de libération servent la session ; découpage
  `TOPUP_CASH` limité au hors ligne. Les routes `initiatePspTopup` et `cancelPspTopup` enchaînent des transactions courtes
  et l'appel au PSP hors transaction, la dernière étant l'`IdempotentTx` de la route (garde RISK-2 sans exception).
- **Processus `psp-poller`** (`main.psp-poller.ts`, `PspPollerProcessModule`, modèle `ProcessWorker`, `--once` ou `--list`,
  lancé par l'ordonnanceur externe ; rôle de base `cashless_app`, pas de rôle dédié) : trois travailleurs, interrogation des
  recharges `PENDING` et expiration, reprise des notifications `UNMATCHED` et `RETRY` (dont la contestation introuvable
  après 24 h : `PSP_MISMATCH`), purge des corps bruts de plus de 400 jours. Codes de sortie d'alerte 2, 3 et 4. Refuse de
  démarrer en production tant que les PSP ou le coffre sont des faux (`assertProcessIsSafe`).
- **Base** (`packages/ledger-sql`, migrations `0036` à `0042`) : `cash_session`, `cash_desk`, `cash_session_count`,
  `cash_session_tx`, `psp_configuration`, `event_psp_selection`, `psp_topup`, `psp_event`, `psp_webhook_rejection`,
  `psp_chargeback` (10 tables, `0036` à `0038`) ; garde de caisse sur `posting` ; comptes `A-PSP-*` créés par
  `open_psp_accounts` ; écritures par fonctions SECURITY DEFINER seulement ; droits par colonne (`secret_ref`, `body`) ;
  extensions de listes fermées (`fee_rule.scope_type`, `anomaly.kind`, `approval_request.action`). Hors plan : `0039`
  (cause d'un blocage par contestation), `0040` (ordre des verrous de fermeture : terminal, session, solde), `0041`
  (`take_deposit_from_balance`, `refund_deposit_from_balance` ; OP-N84 levé), `0042` (`wallet.other_block`, déclencheur
  `wallet_block_cause_guard`).
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
| Verrous de fermeture dans l'ordre terminal, session, solde (`0040`) | Une fermeture et une recharge espèces simultanées s'interbloquaient (`40P01`, NFR-008) | Réessai côté API |
| Plus de fonction de caution à compte libre pour `cashless_app` ; variantes de session et `*_from_balance` (`0041`) | Un compte désigné par l'appelant contournait la session (OP-N84 levé) | Octroi provisoire (plan WP05) |
| `wallet.other_block` et déclencheur : un blocage par contestation ne lève jamais un blocage d'une autre cause (`0039`, `0042`, ADR-134) | Le déblocage « contestation » remettait `ACTIVE` un portefeuille perdu ou fraudé | Marqueur sur la contestation seulement (`0039`) |
| Verrou consultatif `psp-topup:<id>` pour le traitement d'un paiement (droits inchangés) | `FOR UPDATE` direct aurait élargi les droits de `cashless_app` | `FOR UPDATE` sur `psp_topup` |
| Vue `CASHIER` d'une session sans `cash_diff_anomaly_id` | Son existence révélerait le théorique (comptage à l'aveugle) | Champ servi |

## Lien avec la synthèse globale
Contribue à : `docs/04-architecture-diagram.md`, table « Décisions notables » ; `docs/03-context-diagram.md` (PSP et coffre en faux, OP-N81).

## Écarts entre le plan et le code livré
- Quatre migrations de plus que prévu (`0039` à `0042`, voir ci-dessus), toutes des renforcements décidés par le porteur le 29/10/2026.
- Routes `initiate` et `cancel` sous `IdempotentTx` (le plan acceptait une exception à RISK-2 ; le porteur l'a refusée).
- Succès tardif après annulation : crédité s'il est recevable (le plan le classait « non crédité » ; ADR-133 et OP-N82 le
  décrivent encore ainsi dans la lane : texte à aligner après confirmation du porteur).
- Dépendances : aucune ajoutée, comme prévu. Contrat : 11 chemins et 12 opérations ajoutés (161 et 192 au total).

## Nécessaire pour cette mission ? Oui — nouveau processus, nouvelles tables, deux ports et une garde de base.
## Complet ? Oui, recalé sur le code livré (review du 29/10/2026), à confirmer par le porteur.
## Validé par : en attente du porteur (proposition de l'Agent, 29/10/2026)
