// Outils communs aux constructeurs : contrôles d'entrée et assemblage des lignes.
import { extractTax } from '../../money';
import { BuildError, type AccountRef, type Line } from '../../types';

export function requirePositive(amount: bigint, what: string): bigint {
  if (amount <= 0n) throw new BuildError('VALIDATION_FAILED', `${what} : montant strictement positif requis`);
  return amount;
}

export function requireId(value: string | undefined, what: string): string {
  if (!value) throw new BuildError('VALIDATION_FAILED', `${what} manquant`);
  return value;
}

/** Ajoute une ligne si son montant est non nul (la base refuse les lignes nulles). */
export function push(lines: Line[], account: AccountRef, amount: bigint): void {
  if (amount !== 0n) lines.push({ account, amount });
}

/** Crédite un montant TTC en deux lignes : HT sur `htAccount`, taxe extraite sur `taxAccount` (omise si nulle). */
export function creditWithTax(lines: Line[], ttc: bigint, taxBps: bigint, htAccount: AccountRef, taxAccount: AccountRef): void {
  const { ht, tax } = extractTax(ttc, taxBps);
  push(lines, htAccount, -ht);
  push(lines, taxAccount, -tax);
}

/** Dernier contrôle d'un constructeur : au moins deux lignes et somme nulle (sinon, défaut du constructeur). */
export function balanced(lines: Line[]): Line[] {
  const sum = lines.reduce((total, line) => total + line.amount, 0n);
  if (lines.length < 2 || sum !== 0n) {
    throw new Error(`Constructeur défaillant : ${lines.length} lignes, somme ${sum}`);
  }
  return lines;
}
