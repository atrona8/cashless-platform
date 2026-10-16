// Unitaires : valeurs provisoires de §17.2 (FR-003, C-006, R-07).
import {
  completeJurisdictionProfile,
  effectiveRefundDeadline,
  provisionalFields,
} from '../../../src/configuration/provisional-defaults';

describe('profil de législation complété', () => {
  it('Sénégal, rien de saisi : défauts provisoires, chacun avec la personne qui confirme', () => {
    const profile = completeJurisdictionProfile({ country_code: 'SN', valid_from: '2026-01-01' });
    expect(profile).toMatchObject({
      unidentified_monthly_limit: 200000,
      identified_monthly_limit: 2000000,
      max_wallet_balance: null,
      unidentified_max_balance: null,
      breakage_destination: 'ORGANIZER',
      min_refund_window_days: null,
      kyc_threshold: null,
      late_claim_years: 5,
    });
    expect(profile.rules.taxes).toEqual({ VAT: { rate_bps: 1800, inclusive: true } });
    expect(provisionalFields(profile.rules)).toEqual(
      expect.arrayContaining([
        { field: 'unidentified_monthly_limit', confirm_by: 'juriste' },
        { field: 'identified_monthly_limit', confirm_by: 'juriste' },
        { field: 'max_wallet_balance', confirm_by: 'juriste' },
        { field: 'breakage_destination', confirm_by: 'juriste' },
        { field: 'rules.taxes', confirm_by: 'expert-comptable' },
      ]),
    );
  });

  it('une valeur saisie, même nulle, n’est plus provisoire', () => {
    const profile = completeJurisdictionProfile({
      country_code: 'SN',
      valid_from: '2026-01-01',
      unidentified_monthly_limit: 150000,
      identified_monthly_limit: null,
      breakage_destination: 'LEGAL_ACCOUNT',
      rules: {
        taxes: { VAT: { rate_bps: 2000, inclusive: true } },
        provisional: [{ field: 'ancien', confirm_by: 'x' }],
      },
    });
    expect(profile.unidentified_monthly_limit).toBe(150000);
    expect(profile.identified_monthly_limit).toBeNull();
    const fields = provisionalFields(profile.rules).map((f) => f.field);
    expect(fields).toEqual(['max_wallet_balance', 'unidentified_max_balance']);
    expect(profile.rules.taxes).toEqual({ VAT: { rate_bps: 2000, inclusive: true } });
  });

  it('autre pays : aucun plafond ni taxe inventés, seule la destination de la casse est provisoire', () => {
    const profile = completeJurisdictionProfile({ country_code: 'CI', valid_from: '2026-01-01' });
    expect(profile.unidentified_monthly_limit).toBeNull();
    expect(profile.rules.taxes).toBeUndefined();
    expect(provisionalFields(profile.rules)).toEqual([
      { field: 'breakage_destination', confirm_by: 'juriste' },
    ]);
  });

  it('provisionalFields : tolère des règles sans liste', () => {
    expect(provisionalFields({})).toEqual([]);
    expect(provisionalFields(null)).toEqual([]);
    expect(provisionalFields({ provisional: ['x', { field: 'a' }] })).toEqual([]);
  });
});

describe('date limite de remboursement', () => {
  const end = new Date('2026-12-31T00:00:00Z');

  it('saisie : elle fait foi', () => {
    const explicit = new Date('2027-06-01T00:00:00Z');
    expect(effectiveRefundDeadline(explicit, end)).toEqual({ value: explicit, source: 'EXPLICIT' });
  });

  it('absente : fin + 30 jours, provisoire', () => {
    expect(effectiveRefundDeadline(null, end)).toEqual({
      value: new Date('2027-01-30T00:00:00Z'),
      source: 'PROVISIONAL_DEFAULT',
    });
  });

  it('ni date limite ni fin : aucune', () => {
    expect(effectiveRefundDeadline(null, null)).toBeNull();
  });
});
