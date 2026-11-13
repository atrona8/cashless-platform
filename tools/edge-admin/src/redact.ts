// Masquage de tout ce qui ne doit jamais atteindre un journal ou une sortie (T067, règle « aucun secret en journal ») :
// mot de passe d'une URL de connexion, bloc PEM privé, nonce, jeton, empreinte complète (on garde les 8 premiers
// octets). Toute ligne écrite par l'outil passe par `redact`.

const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]*):[^\s@/]*@/gi;
const PRIVATE_PEM =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;
const KEYED_SECRET =
  /\b(nonce|password|passwd|pwd|secret|token)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const LONG_HEX = /\b([0-9a-f]{16})[0-9a-f]{48,}\b/gi;

export function redact(text: string): string {
  return text
    .replace(PRIVATE_PEM, '[clé privée masquée]')
    .replace(URL_PASSWORD, '$1:***@')
    .replace(KEYED_SECRET, '$1$2***')
    .replace(LONG_HEX, '$1…');
}

/** Empreinte pour affichage : les 8 premiers octets en hexadécimal. */
export function shortFingerprint(digest: Buffer): string {
  return `${digest.subarray(0, 8).toString('hex')}…`;
}
