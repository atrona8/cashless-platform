// Jeton du pool : réservé au dossier db/ (test d'architecture : aucun autre fichier de src/ ne l'importe).
export const PG_POOL = Symbol('PG_POOL');
/** Pool du rôle de la plateforme (`cashless_platform`) : même règle, utilisé par `PlatformTx` seulement. */
export const PG_PLATFORM_POOL = Symbol('PG_PLATFORM_POOL');
