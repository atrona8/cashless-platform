// Les cas normatifs de packages/ledger-sql/moteur_ecritures_reference.py, repris tels quels (critère V1 n° 2).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractTax, fee, InsufficientFundsError, roundDiv, spendSplit, splitShare } from '../../../src/ledger/money';

type Line = [account: string, amount: bigint];

const pair = ({ ht, tax }: { ht: bigint; tax: bigint }): [bigint, bigint] => [ht, tax];

function balanced(lines: Line[]): Line[] {
  expect(lines.reduce((sum, [, value]) => sum + value, 0n)).toBe(0n);
  return lines;
}

// Assembleurs locaux au test, calqués sur purchase_lines / offline_sync_lines (les constructeurs arrivent en WP07).
function purchaseLines(amount: bigint, promo: bigint, paid: bigint, commissionBps: bigint, taxBps: bigint): Line[] {
  const { fromPromo, fromPaid } = spendSplit({ amount, promoBalance: promo, paidBalance: paid, promoFirst: true, mode: 'ONLINE' });
  const lines: Line[] = [];
  if (fromPromo) lines.push(['L-WAL-X', fromPromo]);
  if (fromPaid) lines.push(['L-WAL-P', fromPaid]);
  lines.push(['L-MCH', -amount]);
  const com = fee(amount, { rateBps: commissionBps });
  if (com) {
    const { ht, tax } = extractTax(com, taxBps);
    lines.push(['L-MCH', com], ['L-ORG-COM', -ht]);
    if (tax) lines.push(['L-ORG-TVA', -tax]);
  }
  return balanced(lines);
}

function offlineSyncLines(amount: bigint, paid: bigint, commissionBps: bigint, taxBps: bigint, promo = 0n): Line[] {
  const { fromPromo, fromPaid, uncovered } = spendSplit({
    amount,
    promoBalance: promo,
    paidBalance: paid,
    promoFirst: true,
    mode: 'OFFLINE',
  });
  const com = fee(amount, { rateBps: commissionBps });
  const { ht, tax } = extractTax(com, taxBps);
  const lines: Line[] = [
    ['L-WAL-X', fromPromo],
    ['L-WAL-P', fromPaid],
    ['S-ATTENTE', uncovered],
    ['L-MCH', -amount],
    ['L-MCH', com],
    ['L-ORG-COM', -ht],
    ['L-ORG-TVA', -tax],
  ];
  return balanced(lines).filter(([, value]) => value !== 0n);
}

const CASES: [n: number, description: string, compute: () => unknown, expected: unknown][] = [
  [1, 'Commission 12 % sur vente de 6 000 XOF, TVA 18 %', () => pair(extractTax(fee(6000n, { rateBps: 1200n }), 1800n)), [610n, 110n]],
  [2, "Frais d'activation 5 x 1 000 XOF TTC, TVA 18 %", () => pair(extractTax(5000n, 1800n)), [4237n, 763n]],
  [3, 'Frais PSP Wave 1 % sur 20 000 XOF', () => fee(20_000n, { rateBps: 100n }), 200n],
  [4, 'Frais PSP Orange Money 1,5 % sur 15 000 XOF', () => fee(15_000n, { rateBps: 150n }), 225n],
  [5, 'Demi exact : 10 % de 1 005 XOF = 100,5 -> 101', () => fee(1005n, { rateBps: 1000n }), 101n],
  [6, 'Demi négatif : -100,5 -> -101 (symétrique)', () => roundDiv(-1005n * 1000n, 10_000n), -101n],
  [7, 'Commission 12 % sur 9,99 EUR (999 centimes), TVA 20 %', () => pair(extractTax(fee(999n, { rateBps: 1200n }), 2000n)), [100n, 20n]],
  [8, 'Frais bornés : 3 % de 1 000 avec minimum 100', () => fee(1000n, { rateBps: 300n, min: 100n }), 100n],
  [9, 'Frais bornés : 3 % de 1 000 000 avec maximum 20 000', () => fee(1_000_000n, { rateBps: 300n, max: 20_000n }), 20_000n],
  [10, 'Taxe à 0 % : tout en HT', () => pair(extractTax(720n, 0n)), [720n, 0n]],
  [11, 'Casse 20 000 XOF, organisateur 80 % (8 000 bps)', () => splitShare(20_000n, 8000n), [16_000n, 4_000n]],
  [12, 'Casse 999 XOF, organisateur 33,33 % : le reste au prestataire', () => splitShare(999n, 3333n), [333n, 666n]],
  [
    13,
    "Vente 1 000 avec 400 offerts + 5 000 payés, offerts d'abord, sans commission (taux 0)",
    () => purchaseLines(1000n, 400n, 5000n, 0n, 1800n),
    [
      ['L-WAL-X', 400n],
      ['L-WAL-P', 600n],
      ['L-MCH', -1000n],
    ],
  ],
  [
    14,
    'Vente hors ligne 9 000, solde 6 000, commission 12 %, TVA 18 %',
    () => offlineSyncLines(9000n, 6000n, 1200n, 1800n),
    [
      ['L-WAL-P', 6000n],
      ['S-ATTENTE', 3000n],
      ['L-MCH', -9000n],
      ['L-MCH', 1080n],
      ['L-ORG-COM', -915n],
      ['L-ORG-TVA', -165n],
    ],
  ],
  [15, 'Frais du prestataire 3 % sur recharges payées 100 000 (une seule fois, sur le total)', () => fee(100_000n, { rateBps: 300n }), 3000n],
  [
    16,
    'Redevance plateforme 20 % des frais HT du prestataire 5 085, TVA 18 %',
    () => pair(extractTax(fee(5085n, { rateBps: 2000n }), 1800n)),
    [862n, 155n],
  ],
  [
    18,
    'Deux droits de place 15 000 + 10 000 TTC dans une transaction, TVA 18 % : taxe extraite une fois sur la somme',
    () => pair(extractTax(15_000n + 10_000n, 1800n)),
    [21_186n, 3_814n],
  ],
  [
    19,
    "Vente hors ligne 9 000, 2 000 offerts + 5 000 payés, offerts d'abord, sans commission",
    () => offlineSyncLines(9000n, 5000n, 0n, 1800n, 2000n),
    [
      ['L-WAL-X', 2000n],
      ['L-WAL-P', 5000n],
      ['S-ATTENTE', 2000n],
      ['L-MCH', -9000n],
    ],
  ],
];

describe("cas normatifs du moteur d'écritures (moteur_ecritures_reference.py)", () => {
  it.each(CASES)('cas %i — %s', (_n, _description, compute, expected) => {
    expect(compute()).toEqual(expected);
  });

  it('cas 17 — vente en ligne 7 000 avec 400 offerts + 5 000 payés : INSUFFICIENT_FUNDS', () => {
    expect(() => purchaseLines(7000n, 400n, 5000n, 1200n, 1800n)).toThrow(InsufficientFundsError);
  });

  it('cas 13, 14, 19 : répartition offerts / payés seule', () => {
    expect(spendSplit({ amount: 1000n, promoBalance: 400n, paidBalance: 5000n, promoFirst: true, mode: 'ONLINE' })).toEqual({
      fromPromo: 400n,
      fromPaid: 600n,
      uncovered: 0n,
    });
    expect(spendSplit({ amount: 9000n, promoBalance: 0n, paidBalance: 6000n, promoFirst: true, mode: 'OFFLINE' })).toEqual({
      fromPromo: 0n,
      fromPaid: 6000n,
      uncovered: 3000n,
    });
    expect(spendSplit({ amount: 9000n, promoBalance: 2000n, paidBalance: 5000n, promoFirst: true, mode: 'OFFLINE' })).toEqual({
      fromPromo: 2000n,
      fromPaid: 5000n,
      uncovered: 2000n,
    });
  });

  it('garde de parité : la référence contient exactement les cas 1 à 16, 18 et 19', () => {
    const reference = readFileSync(join(__dirname, '../../../../../packages/ledger-sql/moteur_ecritures_reference.py'), 'utf8');
    const numbers = [...reference.matchAll(/^\s*\((\d+),\s*"/gm)].map((match) => Number(match[1]));
    const expected = [...Array.from({ length: 16 }, (_, i) => i + 1), 18, 19];
    expect(numbers).toEqual(expected);
    expect(CASES.map(([n]) => n)).toEqual(expected);
  });
});
