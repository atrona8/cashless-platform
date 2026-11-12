// WP21 / OP-N109 : borne de parité. (1) Les règles partagées donnent, sur les ventes de la
// référence, les commissions et taxes exactes du scénario (le central rejoue avec le même code).
// (2) `apps/gateway` ne contient aucune règle de frais, de partage ou de plafond hors de
// `@cashless/shared-rules` : un test qui échoue si l'une apparaît.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extractTax, fee, spendSplit } from '@cashless/shared-rules';

interface Tx {
  no: number;
  type: string;
  lines: { account: string; amount: number }[];
}
const scenario = JSON.parse(
  readFileSync(join(__dirname, '../../../../packages/ledger-sql/scenario_reference.json'), 'utf8'),
) as { transactions: Tx[] };

const MERCHANT_BPS: Record<string, bigint> = {
  'L-MCH-FOOD': 1200n,
  'L-MCH-TEE': 1000n,
  'L-MCH-BAR': 0n,
};
const TAX_BPS = 1800n;

describe('mêmes scénarios de référence sur le code partagé', () => {
  const sales = scenario.transactions.filter((t) => t.type === 'PURCHASE' && t.no !== 22);
  it.each(sales.map((t) => [t.no, t] as const))(
    'vente %i : commission et taxe de la référence',
    (_no, tx) => {
      const wallet = tx.lines.find((l) => l.account.startsWith('L-WAL-'))!;
      const merchant = tx.lines.find((l) => l.account.startsWith('L-MCH-') && l.amount < 0)!;
      const bps = MERCHANT_BPS[merchant.account]!;
      const commission = fee(BigInt(wallet.amount), { rateBps: bps });
      const commissionLine = tx.lines.find((l) => l.account.startsWith('L-MCH-') && l.amount > 0);
      expect(commission).toBe(BigInt(commissionLine?.amount ?? 0));
      if (commission > 0n) {
        const { ht, tax } = extractTax(commission, TAX_BPS);
        expect(ht).toBe(BigInt(-tx.lines.find((l) => l.account === 'L-ORG-COM')!.amount));
        expect(tax).toBe(BigInt(-tx.lines.find((l) => l.account === 'L-ORG-TVA')!.amount));
      }
    },
  );
  it('spendSplit : crédits offerts d’abord, puis payés (vente 20 et 21 du portefeuille W06)', () => {
    const s = spendSplit({
      amount: 5_000n,
      promoBalance: 5_000n,
      paidBalance: 0n,
      promoFirst: true,
      mode: 'ONLINE',
    });
    expect(s).toEqual({ fromPromo: 5_000n, fromPaid: 0n, uncovered: 0n });
  });
});

describe('aucune règle de frais, de partage ou de plafond hors de shared-rules', () => {
  const root = join(__dirname, '../../src');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) files.push(path);
    }
  };
  walk(root);
  // Définitions de calcul qui n'ont leur place que dans le paquet partagé.
  const FORBIDDEN: [RegExp, string][] = [
    [/\bfunction\s+(fee|splitShare|extractTax|roundDiv|spendSplit)\b/, 'fonction de calcul copiée'],
    [/\bBPS_SCALE\s*=/, 'échelle de points de base redéfinie'],
    [/\bcommission[A-Za-z_]*\s*=\s*[^;]*\*/, 'commission calculée localement'],
    [/\bpspFee|\bplatformFee|\bmerchantFee\b/, 'frais calculés localement'],
  ];
  it('le source de la passerelle ne redéfinit aucune de ces règles', () => {
    expect(files.length).toBeGreaterThan(20);
    const found: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const [re, why] of FORBIDDEN) if (re.test(text)) found.push(`${file} : ${why}`);
    }
    expect(found).toEqual([]);
  });
  it('les ventes importent leurs règles de @cashless/shared-rules', () => {
    const payments = readFileSync(join(root, 'operations/sales/payments.service.ts'), 'utf8');
    expect(payments).toMatch(/from '@cashless\/shared-rules'/);
  });
});
