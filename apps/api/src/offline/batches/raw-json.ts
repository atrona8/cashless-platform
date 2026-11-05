// Lecture JSON d'un lot avec contrôle des numéros sur le TEXTE SOURCE (mission 7, lot WP18, contrôle 2 de
// `batches.md` ; interfaces.md § 8). `JSON.parse` convertit tout entier en nombre à virgule flottante : un numéro
// au-delà de 2^53 - 1 serait arrondi en silence, et l'empreinte du terminal ne retomberait plus sur celle du serveur.
// Le `reviver` reçoit `context.source` (Node 22 et plus) : le littéral exact de chaque nombre.
//
// Pour une clé de `seqFields`, un littéral qui n'est pas un entier décimal positif ou nul (fractionnaire, exposant,
// négatif) ou qui dépasse 2^53 - 1 est refusé : `400 VALIDATION_FAILED` avec un pointeur JSON (`/operations/3/seq`),
// JAMAIS la valeur reçue.
import { ProblemException } from '../../errors/problem';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const INTEGER_LITERAL = /^(?:0|[1-9][0-9]*)$/;

interface Context {
  source?: string;
}
interface Offence {
  holder: object;
  key: string;
}

const refuse = (detail: string): ProblemException =>
  new ProblemException('VALIDATION_FAILED', { status: 400, detail });

/** Échappement d'un segment de pointeur JSON (RFC 6901). */
const segment = (key: string | number): string =>
  String(key).replace(/~/g, '~0').replace(/\//g, '~1');

/** Chemin de `target` depuis `root` (recherche par identité) ; `null` s'il n'y est pas. */
function pathOf(root: unknown, target: object): string | null {
  if (root === target) return '';
  if (typeof root !== 'object' || root === null) return null;
  const entries = Array.isArray(root) ? root.map((v, i) => [i, v] as const) : Object.entries(root);
  for (const [key, value] of entries) {
    const found = pathOf(value, target);
    if (found !== null) return `/${segment(key)}${found}`;
  }
  return null;
}

export function parseWithSafeIntegers(text: string, seqFields: readonly string[]): unknown {
  const fields = new Set(seqFields);
  let offence: Offence | null = null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, function (this: object, key: string, value: unknown, ctx?: Context) {
      if (offence === null && fields.has(key) && typeof value === 'number') {
        const source = ctx?.source;
        if (source === undefined || !INTEGER_LITERAL.test(source) || BigInt(source) > MAX_SAFE)
          offence = { holder: this, key };
      }
      return value;
    });
  } catch {
    throw refuse('Le corps n’est pas un JSON valide.');
  }
  if (offence !== null) {
    const found = offence as Offence;
    const holderPath = pathOf(parsed, found.holder);
    throw refuse(
      `Numéro invalide (entier de 0 à 2^53 - 1 attendu) : ${holderPath ?? ''}/${segment(found.key)}`,
    );
  }
  return parsed;
}
