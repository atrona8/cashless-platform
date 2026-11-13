# Decision Moment `01M6NMFMSPACCWAAHP9X4FGK8V`

- **Mission:** `passerelle-locale-01M6NM1S`
- **Origin flow:** `specify`
- **Slot key:** `specify.security.gateway-key-store`
- **Input key:** `gateway_key_store`
- **Status:** `resolved`
- **Created:** `2026-11-05T10:36:13.494673+00:00`
- **Resolved:** `2026-11-05T10:39:36.780220+00:00`
- **Opened by:** `cli`
- **Other answer:** `false`

## Question

Où vivent la clé de signature et les secrets de la passerelle, tant qu'aucun matériel réel n'est disponible ?

## Options

- Port de stockage matériel avec faux refusé en production, adaptateur réel en 12b
- Other

## Final answer

Port de stockage matériel, faux logiciel refusé au démarrage en production, adaptateur réel (TPM ou équivalent) en mission 12b. Dette nommée (OP, ADR, test, report 12b). Risque présenté et accepté par le porteur le 05/11/2026 : passerelle non utilisable en production avant la 12b.

## Rationale

_(none)_

## Change log

- `2026-11-05T10:36:13.494673+00:00` — opened
- `2026-11-05T10:39:36.780220+00:00` — resolved (final_answer="Port de stockage matériel, faux logiciel refusé au démarrage en production, adaptateur réel (TPM ou équivalent) en mission 12b. Dette nommée (OP, ADR, test, report 12b). Risque présenté et accepté par le porteur le 05/11/2026 : passerelle non utilisable en production avant la 12b.")
