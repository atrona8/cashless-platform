---
affected_files: []
cycle_number: 1
mission_slug: passerelle-locale-01M6NM1S
reproduction_command:
reviewed_at: '2026-11-10T14:02:12Z'
reviewer_agent: claude
wp_id: WP14
---

# WP14 : relecture, cycle 1 (rejet : une preuve manquante)

Code et migration corrects ; un mutant survit.

**1. (bloquant, preuve manquante) Le second appel du processeur n'est prouvé par aucun test.**
`offline-operation.processor.ts`, bloc `if (type === 'ONLINE_REF')` après la conformité (~l. 244) : supprimer
`await resolveOnlineRef(...)` laisse `test/integration/edge/journal` vert (20/20). Ce chemin est celui d'une
`ONLINE_REF` en statut `CONFIRMED` dont la transaction est introuvable (R-30.1) pendant une reprise forcée. Correction :
ajouter à `online-ref-unknown.spec.ts` un cas reprise forcée + `online_status: CONFIRMED` avec un `online_transaction_id`
inconnu : `VOID / ONLINE_NOT_EXECUTED` comme avant, `ONLINE_CONFIRMED_MISSING` conservée, et la décision écrite : une
`EDGE_REPLAY_FAILED` s'ajoute (une seule par clé) ; hors reprise forcée, aucune. Le mutant (retrait de l'appel) doit
alors échouer. Si l'on juge l'appel inutile (anomalie déjà ouverte), le retirer et le dire : il ne doit pas rester non prouvé.

**2. (mineur, à consigner, non bloquant)** `findForcedTakeover` n'a que la borne basse (conforme à R-23) : une `ONLINE_REF`
inconnue datée d'après la fin de la reprise (autorité revenue au central) ouvre aussi une anomalie. Bruit possible, aucune
perte ; à noter dans POINTS_OUVERTS si le porteur veut une borne haute.

Mutants tués : acquittement (`edge_seq_at_activation`), clé `#deposit`, registre d'idempotence en ligne, borne 3,
passerelle `REVOKED`, appel `resolveForcedTopup`, idempotence de `0068` (pgTAP 9), exigence de clé d'origine (pgTAP 5-6).
