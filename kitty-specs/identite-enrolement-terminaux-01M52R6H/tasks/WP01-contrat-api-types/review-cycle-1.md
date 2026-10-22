---
affected_files: []
cycle_number: 1
mission_slug: identite-enrolement-terminaux-01M52R6H
reproduction_command: spec-kitty agent tasks move-task WP01 --to approved --mission identite-enrolement-terminaux-01M52R6H
reviewed_at: '2026-10-19T12:11:37Z'
reviewer_agent: claude
wp_id: WP01
---

Approved by claude: Relecture indépendante : approuvé. 33 opérations de terminal recensées par script, toutes avec UNE entrée réunissant deviceMtls+deviceToken+deviceSignature (guichet : + humanBearer dans la même entrée ; routes mixtes : triple preuve OU humanBearer/posClient). refreshDeviceToken = deviceMtls seul (renforcement prévu), enrollDevice security: []. DeviceAdmin sans public_key/agreement_public_key/cert_sha256. ADR-107 cité (info.description, deviceSignature), ADR-108 pour la grâce de 60 s. getMedia aligné sur CounterAuth (code de la mission 4). Codes/messages fr-en neutres. check du contrat relancé : types TS et Dart à jour. Non bloquant : normalisation hors carte oneOf Timestamp|null -> [string,null] date-time (TagKey, TagKeyJob, MediaAdmin) non justifiée dans le commit ; X-Request-Id facultatif sur les routes mixtes pour un terminal (décrit seulement).
