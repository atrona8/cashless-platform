// WP21 / T097 : les ventes du scénario de référence (packages/ledger-sql/scenario_reference.json,
// jamais modifié) rejouées sur la passerelle. Montants prélevés, soldes et répartition payé/offert
// égaux à ceux de la référence. Les transactions qui ne sont pas une vente de bracelet sont
// listées avec leur raison (aucun saut silencieux).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeBench, type Bench } from './_support/harness';
import { balanceOf, newTill, reverse, tapAndPay, type Till } from './_support/helpers';

interface Tx {
  no: number;
  type: string;
  source: string;
  label: string;
  lines: { account: string; amount: number }[];
}
const scenario = JSON.parse(
  readFileSync(join(__dirname, '../../../../packages/ledger-sql/scenario_reference.json'), 'utf8'),
) as { transactions: Tx[] };

/** Raison pour laquelle une transaction de la référence n'est pas une vente servie ici. */
function notApplicable(tx: Tx): string | null {
  if (tx.no === 22) return 'vente hors ligne rejouée au central (OFFLINE_SYNC) : WP10 et WP25';
  switch (tx.type) {
    case 'PURCHASE':
    case 'REVERSAL':
      return null;
    case 'TOPUP':
    case 'TOPUP_CASH':
    case 'PROMO_CREDIT':
      return 'recharge : le solde arrive du central par réplication (état de départ du test)';
    case 'ACTIVATION_FEE':
    case 'DEPOSIT_TAKEN':
    case 'DEPOSIT_REFUNDED':
    case 'DEPOSIT_FORFEITED':
      return 'activation et caution : WP22';
    case 'WALLET_REFUND':
      return 'remboursement du solde : écriture du central (indisponible pendant EDGE)';
    default:
      return 'écriture de clôture, de versement ou de back-office : le central seul';
  }
}

const walletLine = (tx: Tx) => tx.lines.find((l) => l.account.startsWith('L-WAL-'));

let b: Bench;
let till: Till;
beforeAll(async () => {
  b = await makeBench({ failureFloorMs: 5 });
  till = await newTill(b);
});
afterAll(async () => b.close());

it('chaque transaction non applicable est nommée avec sa raison', () => {
  const skipped = scenario.transactions
    .map((t) => [t.no, notApplicable(t)] as const)
    .filter(([, reason]) => reason !== null);
  expect(skipped.length).toBeGreaterThan(0);
  for (const [, reason] of skipped) expect(reason).toMatch(/\S/);
  const served = scenario.transactions.filter((t) => notApplicable(t) === null).map((t) => t.no);
  expect(served).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
});

it('ventes et annulation de la référence : débits, soldes et parts payée/offerte égaux', async () => {
  const wallets = new Map<
    string,
    {
      id: string;
      bracelet: Awaited<ReturnType<Bench['newBracelet']>>;
      counter: number;
      expected: number;
      promo: boolean;
    }
  >();
  // État de départ : ce que le central a déjà écrit avant la première vente (transactions 1 à 9).
  const before = new Map<string, number>();
  for (const tx of scenario.transactions.filter((t) => t.no < 10))
    for (const l of tx.lines)
      if (l.account.startsWith('L-WAL-'))
        before.set(l.account, (before.get(l.account) ?? 0) - l.amount);
  for (const [account, balance] of before) {
    const promo = account.endsWith('-X');
    const bracelet = await b.newBracelet({
      paid: promo ? 0 : balance,
      promo: promo ? balance : 0,
    });
    wallets.set(account, { id: bracelet.walletId, bracelet, counter: 0, expected: balance, promo });
  }
  const sales = new Map<string, string>(); // `${compte}:${montant}` -> transaction_id
  for (const tx of scenario.transactions.filter((t) => notApplicable(t) === null)) {
    const line = walletLine(tx)!;
    const w = wallets.get(line.account)!;
    if (tx.type === 'PURCHASE') {
      w.counter += 1;
      const product = await b.newProduct(till.device, line.amount);
      till.productId = product;
      const res = await tapAndPay(b, till, w.bracelet, w.counter, { amount: line.amount });
      expect(res.status).toBe(201);
      w.expected -= line.amount;
      sales.set(`${line.account}:${line.amount}`, res.json!.transaction_id as string);
      expect(res.json!.amount).toBe(line.amount);
      expect(res.json!.balance_after).toMatchObject(
        w.promo
          ? { spendable: w.expected, paid: 0, promo: w.expected }
          : { spendable: w.expected, paid: w.expected, promo: 0 },
      );
    } else {
      // REVERSAL : la référence rend exactement la vente d'origine (même compte, même montant).
      const id = sales.get(`${line.account}:${-line.amount}`)!;
      expect(id).toBeDefined();
      const res = await reverse(b, till, id);
      expect(res.status).toBe(201);
      expect(res.json!.amount).toBe(-line.amount);
      w.expected -= line.amount;
    }
    expect(await balanceOf(b, w.id)).toBe(w.expected);
  }
});
