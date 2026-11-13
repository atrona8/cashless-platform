import { checkCompliance } from '../../src/offline-rules/compliance';
import type { ComplianceInput } from '../../src/offline-rules/types';

const TOL = 120_000;
const AT = new Date('2026-10-30T12:00:00Z');
const GEN = new Date('2026-10-30T10:00:00Z');
const HOUR = 3_600_000;

const ok = (): ComplianceInput => ({
  exempt: false,
  type: 'PURCHASE',
  amount: 1000n,
  occurredAtCorrected: AT,
  tolMs: TOL,
  walletCurrency: 'XOF',
  eventCurrency: 'XOF',
  device: { statusAtOccurred: 'ACTIVE', vendorSessionOpen: true },
  tapConfigId: 'cfg-1',
  configInForce: {
    configId: 'cfg-1',
    offlineEnabled: true,
    maxPerSale: 5000n,
    maxPerMedia: 20000n,
    maxPerDevice: 100000n,
  },
  exposure: { mediaCumulative: 0n, deviceCumulative: 0n },
  snapshot: {
    version: 5n,
    registeredAt: GEN,
    envelopedForDevice: true,
    generatedAt: GEN,
    validUntil: new Date(GEN.getTime() + 10 * HOUR),
    maxSnapshotAgeMs: 4 * HOUR,
  },
  ackFloor: 4n,
  mediaAtVersion: {
    present: true,
    mediaUsable: true,
    batchUsable: true,
    walletUsable: true,
    batchBelongsToEvent: true,
  },
  packVerified: true,
  reversalTarget: null,
});
const make = (f: (i: ComplianceInput) => void): ComplianceInput => {
  const i = ok();
  f(i);
  return i;
};
const reasonOf = (i: ComplianceInput) => {
  const r = checkCompliance(i);
  return r.ok ? 'OK' : r.reason;
};

describe('checkCompliance', () => {
  it('conforme', () => expect(checkCompliance(ok())).toEqual({ ok: true }));

  it.each<[string, (i: ComplianceInput) => void, string]>([
    ['#1 devise différente', (i) => void (i.walletCurrency = 'EUR'), 'CURRENCY_MISMATCH'],
    ['#1 devise absente', (i) => void (i.walletCurrency = null), 'CURRENCY_MISMATCH'],
    [
      '#2 terminal suspendu',
      (i) => void (i.device.statusAtOccurred = 'SUSPENDED'),
      'OFFLINE_NOT_ALLOWED',
    ],
    [
      '#2 terminal révoqué',
      (i) => void (i.device.statusAtOccurred = 'REVOKED'),
      'OFFLINE_NOT_ALLOWED',
    ],
    ['#2 terminal inconnu', (i) => void (i.device.statusAtOccurred = null), 'OFFLINE_NOT_ALLOWED'],
    [
      '#2 session de vendeur',
      (i) => void (i.device.vendorSessionOpen = false),
      'OFFLINE_NOT_ALLOWED',
    ],
    [
      '#2 offline_enabled faux',
      (i) => void (i.configInForce!.offlineEnabled = false),
      'OFFLINE_NOT_ALLOWED',
    ],
    [
      '#3 cumul terminal + 1',
      (i) => void (i.exposure.deviceCumulative = 99001n),
      'POLICY_LIMIT_EXCEEDED',
    ],
    ['#4 snapshot inconnu', (i) => void (i.snapshot = null), 'SNAPSHOT_VERSION_UNKNOWN'],
    [
      '#4 inscrit après occurred + tol',
      (i) => void (i.snapshot!.registeredAt = new Date(AT.getTime() + TOL + 1)),
      'SNAPSHOT_VERSION_UNKNOWN',
    ],
    [
      '#4 non enveloppé',
      (i) => void (i.snapshot!.envelopedForDevice = false),
      'SNAPSHOT_VERSION_UNKNOWN',
    ],
    ['#4 sous le plancher d’accusé', (i) => void (i.ackFloor = 6n), 'SNAPSHOT_VERSION_UNKNOWN'],
    [
      '#5 âge limite + 1 ms (maxAge)',
      (i) => void (i.occurredAtCorrected = new Date(GEN.getTime() + 4 * HOUR + TOL + 1)),
      'SNAPSHOT_TOO_OLD',
    ],
    [
      '#5 valid_until plus court',
      (i) => {
        i.snapshot!.validUntil = new Date(GEN.getTime() + HOUR);
        i.occurredAtCorrected = new Date(GEN.getTime() + HOUR + TOL + 1);
      },
      'SNAPSHOT_TOO_OLD',
    ],
    ['#6 bracelet absent', (i) => void (i.mediaAtVersion.present = false), 'MEDIA_NOT_IN_SNAPSHOT'],
    [
      '#7 bracelet inutilisable',
      (i) => void (i.mediaAtVersion.mediaUsable = false),
      'MEDIA_BLOCKED_IN_SNAPSHOT',
    ],
    [
      '#7 lot inutilisable',
      (i) => void (i.mediaAtVersion.batchUsable = false),
      'MEDIA_BLOCKED_IN_SNAPSHOT',
    ],
    [
      '#7 portefeuille inutilisable',
      (i) => void (i.mediaAtVersion.walletUsable = false),
      'MEDIA_BLOCKED_IN_SNAPSHOT',
    ],
    [
      '#8 autre événement',
      (i) => void (i.mediaAtVersion.batchBelongsToEvent = false),
      'MEDIA_WRONG_EVENT',
    ],
    ['#9 pack non vérifié', (i) => void (i.packVerified = false), 'PACK_NOT_VERIFIED'],
    ['#9 pack absent', (i) => void (i.packVerified = undefined), 'PACK_NOT_VERIFIED'],
    [
      '#10 cible absente',
      (i) => {
        i.type = 'REVERSAL';
        i.reversalTarget = null;
      },
      'REVERSAL_TARGET_NOT_FOUND',
    ],
    [
      '#10 cible d’un autre terminal',
      (i) => {
        i.type = 'REVERSAL';
        i.reversalTarget = { foundOnThisDevice: false, alreadyReversed: false };
      },
      'REVERSAL_TARGET_NOT_FOUND',
    ],
    [
      '#10 déjà annulée',
      (i) => {
        i.type = 'REVERSAL';
        i.reversalTarget = { foundOnThisDevice: true, alreadyReversed: true };
      },
      'ALREADY_REVERSED',
    ],
  ])('%s', (_n, f, reason) => {
    expect(reasonOf(make(f))).toBe(reason);
  });

  it('#3 configuration absente : refus, #2 en tête puisque offline_enabled est inconnu', () => {
    const r = checkCompliance(make((i) => void (i.configInForce = null)));
    expect(r).toEqual({
      ok: false,
      reason: 'OFFLINE_NOT_ALLOWED',
      detail: ['OFFLINE_DISABLED', 'POLICY_LIMIT_EXCEEDED'],
    });
  });

  describe('bornes (égal admis, +1 refusé)', () => {
    it.each<[string, (i: ComplianceInput) => void, boolean]>([
      ['max_per_sale exact', (i) => void (i.amount = 5000n), true],
      ['max_per_sale + 1', (i) => void (i.amount = 5001n), false],
      ['cumul bracelet exact', (i) => void (i.exposure.mediaCumulative = 19000n), true],
      ['cumul bracelet + 1', (i) => void (i.exposure.mediaCumulative = 19001n), false],
      ['cumul terminal exact', (i) => void (i.exposure.deviceCumulative = 99000n), true],
      ['cumul terminal + 1', (i) => void (i.exposure.deviceCumulative = 99001n), false],
      [
        'âge = min(maxAge, validUntil) + tol',
        (i) => void (i.occurredAtCorrected = new Date(GEN.getTime() + 4 * HOUR + TOL)),
        true,
      ],
      [
        'âge + 1 ms',
        (i) => void (i.occurredAtCorrected = new Date(GEN.getTime() + 4 * HOUR + TOL + 1)),
        false,
      ],
      [
        'inscrite à occurred + tol',
        (i) => void (i.snapshot!.registeredAt = new Date(AT.getTime() + TOL)),
        true,
      ],
      [
        'inscrite à occurred + tol + 1',
        (i) => void (i.snapshot!.registeredAt = new Date(AT.getTime() + TOL + 1)),
        false,
      ],
      ['version = plancher', (i) => void (i.ackFloor = 5n), true],
      ['plancher absent', (i) => void (i.ackFloor = null), true],
    ])('%s', (_n, f, expected) => {
      expect(checkCompliance(make(f)).ok).toBe(expected);
    });
  });

  it('une annulation n’est pas soumise aux plafonds, mais à la configuration', () => {
    const rev = make((i) => {
      i.type = 'REVERSAL';
      i.amount = 99999n;
      i.reversalTarget = { foundOnThisDevice: true, alreadyReversed: false };
    });
    expect(checkCompliance(rev).ok).toBe(true);
    rev.tapConfigId = 'cfg-0';
    expect(reasonOf(rev)).toBe('POLICY_LIMIT_EXCEEDED');
  });

  it('deux échecs : le premier en reason, le second en detail', () => {
    const r = checkCompliance(
      make((i) => {
        i.packVerified = false;
        i.walletCurrency = 'EUR';
      }),
    );
    expect(r).toEqual({ ok: false, reason: 'CURRENCY_MISMATCH', detail: ['PACK_NOT_VERIFIED'] });
  });

  it('#2 : le sous-motif est en tête de detail', () => {
    const r = checkCompliance(
      make((i) => {
        i.device.statusAtOccurred = 'SUSPENDED';
        i.packVerified = false;
      }),
    );
    expect(r).toEqual({
      ok: false,
      reason: 'OFFLINE_NOT_ALLOWED',
      detail: ['DEVICE_SUSPENDED', 'PACK_NOT_VERIFIED'],
    });
  });

  it('#2 : plusieurs sous-motifs', () => {
    const r = checkCompliance(
      make((i) => {
        i.device.statusAtOccurred = 'REVOKED';
        i.device.vendorSessionOpen = false;
      }),
    );
    expect(r).toEqual({
      ok: false,
      reason: 'OFFLINE_NOT_ALLOWED',
      detail: ['DEVICE_REVOKED', 'VENDOR_SESSION'],
    });
  });

  it('un échec #2 non premier voit ses sous-motifs dans detail', () => {
    const r = checkCompliance(
      make((i) => {
        i.walletCurrency = 'EUR';
        i.device.vendorSessionOpen = false;
      }),
    );
    expect(r).toEqual({
      ok: false,
      reason: 'CURRENCY_MISMATCH',
      detail: ['OFFLINE_NOT_ALLOWED', 'VENDOR_SESSION'],
    });
  });

  it('detail ne contient que des codes en majuscules (aucun montant, aucun identifiant)', () => {
    const r = checkCompliance(
      make((i) => {
        i.packVerified = false;
        i.amount = 123456n;
        i.tapConfigId = 'cfg-secret-0';
      }),
    );
    if (r.ok) throw new Error('attendu un refus');
    for (const d of r.detail) expect(d).toMatch(/^[A-Z_]+$/);
    expect(r.reason).toMatch(/^[A-Z_]+$/);
  });

  describe('exempt', () => {
    it('conforme sans autre calcul, même si tout serait en échec', () => {
      const i = make((x) => {
        x.exempt = true;
        x.packVerified = false;
        x.configInForce = null;
        x.snapshot = null;
      });
      expect(checkCompliance(i)).toEqual({ ok: true });
    });
    it('exempt faux : conformité complète', () => {
      expect(checkCompliance(make((x) => void (x.packVerified = false))).ok).toBe(false);
    });
  });

  describe('TOPUP_CASH', () => {
    it('refusé même si tout est conforme', () => {
      expect(checkCompliance(make((i) => void (i.type = 'TOPUP_CASH')))).toEqual({
        ok: false,
        reason: 'OFFLINE_NOT_ALLOWED',
        detail: ['TOPUP_CASH'],
      });
    });
    it('refusé aussi quand exempt', () => {
      expect(
        reasonOf(
          make((i) => {
            i.type = 'TOPUP_CASH';
            i.exempt = true;
          }),
        ),
      ).toBe('OFFLINE_NOT_ALLOWED');
    });
  });
});
