// `coveredCap` du moteur (mission 7, WP19) : la table de conflit plafonne la part prélevée sur le portefeuille d'une
// vente hors ligne. Montants bigint exacts. Jamais de plafond en ligne.
import { buildPurchase } from '../../../src/ledger/builders/festival/purchase';
import { spendSplit } from '@cashless/shared-rules';
import { commandFingerprint } from '../../../src/ledger/ledger-engine.service';
import type { BuildContext, LedgerCommand, ResolvedConfig } from '../../../src/ledger/types';

const base = { amount: 9000n, promoBalance: 0n, paidBalance: 6000n, promoFirst: true } as const;

describe('spendSplit hors ligne avec coveredCap', () => {
  it('borne la part couverte, le reste va au compte d’attente', () => {
    expect(spendSplit({ ...base, mode: 'OFFLINE', coveredCap: 4000n })).toEqual({
      fromPromo: 0n,
      fromPaid: 4000n,
      uncovered: 5000n,
    });
  });
  it('plafond nul : manque entier', () => {
    expect(spendSplit({ ...base, mode: 'OFFLINE', coveredCap: 0n })).toEqual({
      fromPromo: 0n,
      fromPaid: 0n,
      uncovered: 9000n,
    });
  });
  it('plafond négatif : traité comme zéro, jamais de part négative', () => {
    const s = spendSplit({ ...base, mode: 'OFFLINE', coveredCap: -5n });
    expect([s.fromPromo, s.fromPaid, s.uncovered]).toEqual([0n, 0n, 9000n]);
  });
  it('plafond plus grand que le montant ou que les soldes : sans effet', () => {
    const free = spendSplit({ ...base, mode: 'OFFLINE' });
    expect(spendSplit({ ...base, mode: 'OFFLINE', coveredCap: 10n ** 12n })).toEqual(free);
    expect(free).toEqual({ fromPromo: 0n, fromPaid: 6000n, uncovered: 3000n });
    expect(
      spendSplit({ ...base, amount: 2000n, mode: 'OFFLINE', coveredCap: 5000n }).uncovered,
    ).toBe(0n);
  });
  it('promo d’abord : le plafond s’applique à la somme', () => {
    const s = spendSplit({
      amount: 9000n,
      promoBalance: 2000n,
      paidBalance: 6000n,
      promoFirst: true,
      mode: 'OFFLINE',
      coveredCap: 5000n,
    });
    expect(s).toEqual({ fromPromo: 2000n, fromPaid: 3000n, uncovered: 4000n });
  });
  it('jamais de plafond en ligne : solde insuffisant refusé, couverture entière sinon', () => {
    expect(() => spendSplit({ ...base, mode: 'ONLINE', coveredCap: 100n })).toThrow();
    const s = spendSplit({ ...base, amount: 5000n, mode: 'ONLINE', coveredCap: 100n });
    expect(s).toEqual({ fromPromo: 0n, fromPaid: 5000n, uncovered: 0n });
  });
});

describe('buildPurchase et coveredCap', () => {
  const config = {
    parties: { platformId: 'p', operatorId: 'o', organizerId: 'g' },
    taxBps: 0n,
    commissions: {},
    spendOrder: 'PROMO_FIRST',
  } as unknown as ResolvedConfig;
  const ctx: BuildContext = { config, balances: { promo: 0n, paid: 6000n } };
  const command = (source: 'ONLINE' | 'OFFLINE_SYNC', coveredCap?: bigint) =>
    ({
      type: 'PURCHASE',
      idempotencyKey: 'K:0001',
      occurredAt: new Date(),
      source,
      ledgerId: 'l',
      currency: 'XOF',
      payload: {
        walletId: 'w',
        participationId: 'm',
        amount: 5000n,
        ...(coveredCap === undefined ? {} : { coveredCap }),
      },
    }) as LedgerCommand<'PURCHASE', never>;

  it('hors ligne : portefeuille +couvert, S-ATTENTE le reste, commerçant le total', () => {
    const lines = buildPurchase(command('OFFLINE_SYNC', 2000n) as never, ctx);
    const by = (purpose: string) =>
      lines
        .filter((l) => 'purpose' in l.account && l.account.purpose === purpose)
        .reduce((s, l) => s + l.amount, 0n);
    expect(by('WALLET_PAID')).toBe(2000n);
    expect(by('SUSPENSE')).toBe(3000n);
    expect(by('MERCHANT')).toBe(-5000n);
  });
  it('en ligne : coveredCap ignoré', () => {
    const lines = buildPurchase(command('ONLINE', 1n) as never, ctx);
    expect(
      lines.find((l) => 'purpose' in l.account && l.account.purpose === 'WALLET_PAID')?.amount,
    ).toBe(5000n);
  });
  it('coveredCap entre dans l’empreinte de commande', () => {
    const a = commandFingerprint(command('OFFLINE_SYNC', 2000n) as never);
    const b = commandFingerprint(command('OFFLINE_SYNC', 3000n) as never);
    const c = commandFingerprint(command('OFFLINE_SYNC') as never);
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
