// Masquage des secrets dans les journaux (mission 5b, lot WP08, T037 ; NFR-002, NFR-008, A3 ;
// contracts/vendors.md, « Empreinte du PIN »). Appliqué au `message` journalisé par `logProblem`.
//
// RÈGLE : aucun journal des corps ni des en-têtes de requête n'existe aujourd'hui. Tout futur
// journal de requête (corps, en-têtes, paramètres) DOIT passer par `redactSecrets` avant d'être
// écrit.
//
// Masqués : toute empreinte argon2 (`$argon2id$…`, et `$argon2i$`, `$argon2d$`), et la valeur des
// champs `pin`, `token`, `customer_qr_token`, `qr_payload` et de l'en-tête `X-Approval-Token`, sous
// forme JSON (`"pin":"123456"`), formulaire ou texte (`pin=123456`, `pin: 123456`) ; un nom
// préfixé (`refresh_token`, `device-token`) est masqué aussi (renforcement).

export const REDACTED = '[masqué]';

/** Champs et en-têtes dont la valeur n'est jamais journalisée. */
export const REDACTED_FIELDS = Object.freeze([
  'pin',
  'token',
  'customer_qr_token',
  'qr_payload',
  'x-approval-token',
]);

const ARGON2_PHC = /\$argon2(?:id|i|d)\$[A-Za-z0-9+/=$,.-]*/g;
const FIELDS = REDACTED_FIELDS.map((f) => f.replace(/[-_]/g, '[-_]')).join('|');
// "champ" : "valeur"  (JSON ; la valeur peut être une chaîne, un nombre ou un littéral)
const JSON_FIELD = new RegExp(
  `("(?:[A-Za-z0-9]*[-_])?(?:${FIELDS})"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^,}\\]\\s]+)`,
  'gi',
);
// champ=valeur, champ: valeur (formulaire, en-tête, texte libre) ; mot entier seulement.
const TEXT_FIELD = new RegExp(
  `(?<![A-Za-z0-9])((?:[A-Za-z0-9]*[-_])?(?:${FIELDS})\\s*[:=]\\s*)([^\\s&,;"]+)`,
  'gi',
);

/** Texte sans empreinte argon2 ni valeur des champs secrets. */
export function redactSecrets(text: string): string {
  return text
    .replace(ARGON2_PHC, REDACTED)
    .replace(JSON_FIELD, (_m, prefix: string) => `${prefix}"${REDACTED}"`)
    .replace(TEXT_FIELD, (_m, prefix: string) => `${prefix}${REDACTED}`);
}
