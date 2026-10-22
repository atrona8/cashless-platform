# Specification Quality Checklist: Encaissement en ligne

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-22
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Requirement types are separated (Functional / Non-Functional / Constraints)
- [x] IDs are unique across FR-###, NFR-###, and C-### entries
- [x] All requirement rows include a non-empty Status value
- [x] Non-functional requirements include measurable thresholds
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Comme pour les missions 1 à 5a, la spec nomme les objets normatifs du kit (codes d'erreur du contrat, tables S2,
  S18, `payment_request`, `kyc_verification`, fonctions `register_tap`, `consume_tap`, `post_transaction`, argon2id
  imposé par S2) : ce sont des exigences des sources normatives et des décisions du porteur, pas des choix
  d'implémentation. La forme des routes nouvelles, le moyen de retrouver le catalogue d'une configuration servie et
  les paramètres d'argon2id sont laissés au plan.
- Contradiction signalée (§0.3) : SPECIFICATION §6.3 permet à un administrateur seul de révoquer une identification ;
  `openapi.yaml` (`revokeKycVerification`) exige deux personnes. Le contrat prime et il est le plus sûr (C-011).
- `meta.json` (16/10/2026) décrit encore le périmètre d'avant le découpage ; ses champs sont immuables, la spec fait foi.
- Validation passée en une itération.
