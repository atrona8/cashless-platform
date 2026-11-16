---
affected_files: []
cycle_number: 2
mission_slug: remboursements-01M7AG5V
reproduction_command:
reviewed_at: '2026-11-16T10:41:08Z'
reviewer_agent: claude
wp_id: WP05
---

# WP05, cycle 1 : renvoyé pour une décision du porteur (16/11/2026)

La relecture a jugé le lot correct sur le fond : 22 suites et 290 tests, aucun constat bloquant. Le renvoi tient à la
décision 13 du porteur (`docs/passation-9a/contexte-9a.md`).

## 1. BLOQUANT : `FAILED` refusé à qui a proposé ou exécuté le remboursement (décision 13)

Constat : avec `outcome = FAILED`, une seule personne habilitée recrédite le portefeuille. Le valideur du
`REVERSAL` est nominal : il n'agit pas. Celui qui a proposé ou exécuté la sortie d'argent peut donc aussi la
recréditer. Si le festivalier a en réalité été payé, l'argent sort deux fois.

Correction attendue, sans aucun changement à `openapi.yaml` :
- `confirmRefundRequest` avec `FAILED` est refusé AVANT toute écriture si l'appelant est l'une de ces personnes :
  - l'auteur de la demande d'approbation (la personne qui a proposé) ;
  - `approved_by` de la demande (la personne qui a exécuté).
- Réponse : `403` avec un code déjà prévu par la réponse `Forbidden` du contrat. Vérifie le code dans
  `components/responses/Forbidden` et `src/errors/`, et n'en ajoute aucun.
- `PAID` reste ouvert à toute personne habilitée (aucune écriture).
- Ordre des contrôles :
  - rôles et portée (403/404) ;
  - état `PROCESSING` (409) ;
  - séparation des personnes (403) ;
  - garde EDGE ;
  - écriture.
  Si un autre ordre te paraît nécessaire, justifie-le.
- Le choix du valideur du `REVERSAL` (`interfaces.md` l. 114) reste tel quel. Vérifie qu'il est toujours distinct
  de l'auteur, puisque l'appelant n'est plus ni l'un ni l'autre.
- Tests attendus :
  - proposant → `FAILED` : 403, aucune écriture, demande `PROCESSING` ;
  - exécutant → `FAILED` : 403, idem ;
  - troisième personne → `FAILED` : 200, `REVERSAL` ;
  - proposant ou exécutant → `PAID` : 200 ;
  - le test existant de 20 `FAILED` simultanés tourne avec une troisième personne.
- Mettre à jour l'en-tête du service et la note de lane (décision 13).

## 2. Mineurs (à corriger si simple, sinon les signaler pour WP07)

- Compte `A-PSP-*` absent (`open_psp_accounts` non lancé) : l'approbation passe `FAILED` avec un message trompeur
  (« ni en service ni en clôture »). Rendre un message exact et ajouter un test : approbation `FAILED`, aucune
  écriture.
- L'audit de l'exécution est écrit avec `actorRole` nul : renseigner le rôle exercé.
