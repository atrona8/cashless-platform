# Reprise, mission 8 (passerelle-locale-01M6NM1S)

État au 05/11/2026 : spécification et plan finis, sur `feat/passerelle-locale`. 39 FR, 13 NFR, 13 contraintes, 16 concerns. Passe
contradictoire : 29 constats traités (`research-adversarial.md`). Écarts : OP-N100 à OP-N110, ADR-155 à ADR-165. Aucun code.

Prochaine étape : `/spec-kitty.tasks` (lancé par le porteur), analyse, puis `spec-kitty next --agent claude --mission
passerelle-locale-01M6NM1S`. Un implémenteur et un relecteur distincts par lot, sous-agents en `sonnet`, tests en série par
l'orchestrateur. Commandes spec-kitty avec `LC_ALL=C LANG=C`.

## Où lire

- `contexte-m8.md` : décisions 1 à 18 du porteur (attention : FR à 039 et NFR à 013, pas 034 et 012).
- `kitty-specs/passerelle-locale-01M6NM1S/` : `research.md` (R-01 à R-30, fait foi), `data-model.md`, `contracts/`.
- `rapports/` : recherches et passe contradictoire. `docs/Mission-08-Passerelle-locale.docx` : document du porteur (`scripts/gen_8_doc.py`).

## À ne pas oublier

- Contrat stable, base `d2a7c538` : ajouts seulement sous `/edge/*`. Migrations à partir de `0058`.
- Valeurs : 50 000 XOF par vente, 500 000 XOF par terminal et par heure, `EDGE_PACK_DELAY` 30 min.
- À confirmer avec l'équipe terminal : un `401` sur un jeton du central déclenche bien un rafraîchissement ; `409 CONFLICT_STATE` pour `ARMED` et `STANDBY`.
- Au juriste : OP-N108 (dépassement temporaire d'un plafond au rejeu), et l'identification du client pour la mission 10c.
