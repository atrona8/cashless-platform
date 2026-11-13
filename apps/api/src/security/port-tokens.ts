// Jetons d'injection des ports de sécurité des terminaux (mission identite-enrolement-terminaux, plan IC-08, IC-09).
// Chaque port n'a aujourd'hui qu'un faux, refusé en production : `assertProcessIsSafe` (processes/bootstrap.ts) lit
// ces trois fournisseurs, en plus du service de clés et des identités, et refuse de démarrer si l'un est un faux.

/** Autorité des terminaux : émet le certificat client à partir d'un CSR vérifié (R-09). */
export const DEVICE_CA = Symbol('DEVICE_CA');

/** Signataire des jetons d'appareil : signe et vérifie un JWT ES256 (R-07). */
export const TOKEN_SIGNER = Symbol('TOKEN_SIGNER');

/** Vérificateur d'attestation Android et iOS (R-05, R-06). */
export const ATTESTATION_VERIFIER = Symbol('ATTESTATION_VERIFIER');

/**
 * Autorité des passerelles locales (mission passerelle-locale, WP10, interfaces.md § 4) : seconde autorité, distincte
 * de celle des terminaux, propre à l'écouteur du processus `edge`. Aujourd'hui seul un faux existe (refusé en
 * production : `assertProcessIsSafe`) ; l'adaptateur réel est la mission 12b.
 */
export const EDGE_CA = Symbol('EDGE_CA');
