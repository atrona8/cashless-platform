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
// Mission durcissements-serveur (WP08, FR-009) : le champ `iban` (et `destination_iban`) est
// masqué, et tout IBAN nu, avec ou sans espaces, en majuscules ou minuscules, l'est par sa forme
// (passe par valeur, avant les passes par champ). Pas de contrôle modulo 97 : une saisie invalide
// reste sensible. Faux positifs acceptés (mieux vaut masquer trop) : tout mot de 2 lettres, 2
// chiffres puis 11 à 30 caractères alphanumériques (identifiant technique long) ; un mot de 4
// caractères collé à un IBAN à espaces peut être avalé. Les UUID, dates, montants et références
// `CL0xx` ne sont pas touchés.
// OP-N156 (renforcement, décisions du 19/11/2026) : l'IBAN nu tolère aussi le tiret et l'espace
// insécable entre groupes, et deux IBAN collés (sans séparateur) sont masqués d'un bloc ; un
// UUID dont le début ressemble à un IBAN est exclu explicitement. Le numéro de mobile money
// (`msisdn`, `phone`, `mobile`, avec n'importe quel préfixe ou suffixe `_number`) est masqué par
// nom de champ ; en texte libre, tout numéro international `+` suivi de 7 à 15 chiffres (E.164,
// avec espaces, points, tirets ou espaces insécables entre chiffres) l'est aussi. Faux positif
// accepté : un nombre signé de 7 chiffres ou plus (`+1250000`). Les décalages horaires (`+00:00`,
// `+01:00`) et les montants courts ne sont pas touchés. Les numéros nationaux sans `+` ne sont
// pas reconnus en texte libre (le code n'accepte que l'E.164).

export const REDACTED = '[masqué]';

/** Champs et en-têtes dont la valeur n'est jamais journalisée. */
export const REDACTED_FIELDS = Object.freeze([
  'pin',
  'token',
  'customer_qr_token',
  'qr_payload',
  'x-approval-token',
  'iban',
]);

// IBAN nu : 2 lettres, 2 chiffres, puis soit 11 à 30 caractères alphanumériques d'un tenant, soit
// des groupes de 4 (espaces simples tolérés) et un dernier groupe court contenant un chiffre (pour
// ne pas avaler le mot qui suit l'IBAN dans une phrase).
const UUID_START = '(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const BARE_IBAN = new RegExp(
  `\\b${UUID_START}[A-Z]{2}[0-9]{2}(?:[A-Za-z0-9]{11,30}|(?:[ \\u00a0-]?[A-Za-z0-9]{4}){2,7}` +
    `(?:[ \\u00a0-](?=[A-Za-z]*[0-9])[A-Za-z0-9]{1,4})?)\\b`,
  'gi',
);
// Deux IBAN (ou plus) collés : un bloc de 2 à 3 unités de 15 à 34 caractères.
const GLUED_IBAN =
  /\b[A-Z]{2}[0-9]{2}[A-Za-z0-9]{11,30}(?:[A-Z]{2}[0-9]{2}[A-Za-z0-9]{11,30})+\b/gi;
// Numéro de mobile money en texte libre : `+` puis 7 à 15 chiffres (séparateurs tolérés).
const INTL_PHONE = /(?<![A-Za-z0-9])\+[1-9](?:[ \u00a0.-]?[0-9]){6,14}(?![0-9])/g;
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

// Champs du numéro de mobile money : n'importe quel préfixe (`payer_msisdn`, `payerMsisdn`).
const PHONE_FIELDS = '[A-Za-z0-9]*[-_]?(?:msisdn|phone|mobile)(?:[-_]?(?:number|num|no))?';
const PHONE_JSON = new RegExp(
  `("${PHONE_FIELDS}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^,}\\]\\s]+)`,
  'gi',
);
const PHONE_TEXT = new RegExp(`(?<![A-Za-z0-9])(${PHONE_FIELDS}\\s*[:=]\\s*)([^\\s&,;"]+)`, 'gi');

/** Texte sans empreinte argon2 ni valeur des champs secrets. */
export function redactSecrets(text: string): string {
  return text
    .replace(GLUED_IBAN, REDACTED)
    .replace(BARE_IBAN, REDACTED)
    .replace(INTL_PHONE, REDACTED)
    .replace(PHONE_JSON, (_m, prefix: string) => `${prefix}"${REDACTED}"`)
    .replace(PHONE_TEXT, (_m, prefix: string) => `${prefix}${REDACTED}`)
    .replace(ARGON2_PHC, REDACTED)
    .replace(JSON_FIELD, (_m, prefix: string) => `${prefix}"${REDACTED}"`)
    .replace(TEXT_FIELD, (_m, prefix: string) => `${prefix}${REDACTED}`);
}
