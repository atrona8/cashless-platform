// Jetons d'injection des ports PSP (mission 6, WP07). Lus par `assertProcessIsSafe` (processes/bootstrap.ts).

/** Registre des adaptateurs PSP du processus (vide et indisponible en production, OP-N81). */
export const PSP_ADAPTERS = Symbol('PSP_ADAPTERS');

/** Coffre des secrets PSP du processus (indisponible en production, OP-N81). */
export const PSP_SECRET_STORE = Symbol('PSP_SECRET_STORE');
