# Relecture WP11, cycle 2 : un seul constat (mineur mais demande explicite)

Constat 1 : `PRD.md` l. 114-115 dit encore « Révocation d'une identification à deux (contrat ; §6.3 dit « un
administrateur », contradiction signalée) ». Faux depuis l'amendement du 23/11/2026 (OP-N164 levé). Remplacer par
« (contrat et SPECIFICATION §6.3 point 5, amendé le 23/11/2026, OP-N164 levé) ». Rien d'autre.

Verifie OK : constats 1 a 3 du cycle 1 corriges (liste de relecture complete : seuls `jest.config.cjs` et
`check.test.mjs` hors liste, sans droit ni secret) ; amendement §6.3 point 5 date, minimal, renvoie a ADR-227 et
OP-N164, coherent avec `revokeKycVerification` (deux personnes, roles, motif, auteur de la demande) ; OP-N164 LEVE
dans POINTS_OUVERTS, ADR-227/231, PRD l. 148 et 489, PROMPTS, preuves ; aucune formule « non amendee » restante hors
PRD l. 115 ; 422 reste dans ADR-225 (non constat) ; tests cites (revoke.spec.ts l. 161, tests_claim_key_version l. 298)
existent.
