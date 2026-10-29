# Specification Quality Checklist: Hors ligne : snapshots et lots

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-29
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — les noms de fonctions de la base, de codes d'anomalie, de statuts et d'erreurs sont des termes du domaine fixés par les sources normatives (`sync_protocol.md`, schéma, `openapi.yaml`)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — les points ouverts sont posés en hypothèses explicites (section Assumptions) et à confirmer par le porteur
- [x] Requirements are testable and unambiguous
- [x] Requirement types are separated (Functional / Non-Functional / Constraints)
- [x] IDs are unique across FR-###, NFR-###, and C-### entries
- [x] All requirement rows include a non-empty Status value
- [x] Functional requirements carry a Delivery value ([build]/[ratchet]/[folded]) and a No-op passable? value (toutes à « no »)
- [x] Non-functional requirements include measurable thresholds — NFR-003 et NFR-004 sont des seuils proposés, à confirmer au plan
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded (C-009)
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification
- [x] Every decision of the porteur (29/10/2026) is recorded with its identifier in the Decisions section
- [x] Source contradictions are listed, none resolved silently (8 contradictions)
- [x] Débits de sécurité (règle de CLAUDE.md) : aucun faux en production (NFR-008, C-007), dette nommée (C-008, FR-041), garde de caisse intacte (C-013, NFR-014)

## Notes

- Décisions du porteur du 29/10/2026 : quatre décisions (`01M645SWY4PETSJE3PJ7YXKYTP`, `01M647M2MDHBNDZ1AVC93PFR16`, `01M647M9W14H6E7BWZDRWPGNDZ`, `01M647MH0SF6Q7KTM3CMXQZR0B`) reprises dans la section Decisions.
- Points que le porteur devrait confirmer ou trancher : (1) tracé exact de l'évolution de la garde de caisse pour rattacher une recharge à une session fermée (règle 1 de CLAUDE.md, avant codage) ; (2) forme du « montant en attente » d'une recharge sans session ; (3) routes de politique hors ligne à ajouter au contrat ; (4) seuils NFR-003 et NFR-004 ; (5) pas de suspension automatique après 24 h de trou.
- Fichiers à faire relire par une personne au plan (règle 4 de CLAUDE.md) : droits de la base (OP-N57, OP-N58, OP-N68, OP-N69, OP-N75), rôle de maintenance, port de clés et signature des snapshots, garde de caisse.
