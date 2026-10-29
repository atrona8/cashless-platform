// Codes de sortie d'alerte du processus `psp-poller` (mission 6, lot WP12, T063). Distincts de ceux du contrôle
// quotidien (2 et 3), qui vit dans un autre processus : l'ordonnanceur alerte sur tout code non nul.
/** Interrogation en échec (PSP injoignable ou erreur de traitement d'une recharge). */
export const ALARM_POLL_FAILURE = 2;
/** Événement conservé repris sans succès au-delà de 5 essais : plus repris automatiquement. */
export const ALARM_EVENT_RETRY_EXHAUSTED = 3;
/** Purge des corps bruts en échec. */
export const ALARM_PURGE_FAILED = 4;
