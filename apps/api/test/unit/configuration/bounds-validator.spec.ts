// Unitaires : bornes d'une modification (§4.1, R-06, contracts/configuration.md), messages FR/EN (NFR-005) et
// « qui règle quoi » (FR-010).
import {
  assertSettableBy,
  assertWithinBounds,
  findViolations,
  type BoundsContext,
} from '../../../src/configuration/bounds-validator';
import { MESSAGE_RULES, violationMessage } from '../../../src/configuration/messages';
import {
  SETTINGS_CATALOG,
  type ResolvedConfigView,
} from '../../../src/configuration/settings-catalog';
import { ProblemException } from '../../../src/errors/problem';

const EVENT: BoundsContext = { level: 'EVENT' };
const rules = (changes: Record<string, unknown>, context: BoundsContext = EVENT) =>
  findViolations(changes, context).map((v) => `${v.field}:${v.rule}`);
const caught = (fn: () => unknown): ProblemException => {
  try {
    fn();
  } catch (error) {
    return error as ProblemException;
  }
  throw new Error('aucune erreur levée');
};

describe('bornes fixes du catalogue', () => {
  const ints = [...SETTINGS_CATALOG.values()].filter((d) => d.type.kind === 'int');

  it.each(ints.map((d) => [d.key, d.type] as const))(
    '%s : bornes incluses acceptées, voisines refusées',
    (key, type) => {
      if (type.kind !== 'int') return;
      // Les deux délais en ligne sont liés : la valeur testée seule ne doit pas déclencher la règle croisée.
      const current = { online_connect_timeout_ms: 1000, online_total_timeout_ms: 6000 };
      const context: BoundsContext = { level: 'EVENT', current };
      const alone = (value: number) =>
        findViolations({ [key]: value }, context).filter((v) => v.rule === 'catalog.range');
      expect(alone(type.min)).toEqual([]);
      expect(alone(type.max)).toEqual([]);
      expect(alone(type.min - 1)).toEqual([
        {
          field: key,
          rule: 'catalog.range',
          requested: type.min - 1,
          limit: [type.min, type.max],
          source: 'catalog',
        },
      ]);
      expect(alone(type.max + 1)).toHaveLength(1);
    },
  );

  it('types refusés : flottant, texte, nul', () => {
    expect(rules({ sync_deadline_hours: 1.5 })).toEqual(['sync_deadline_hours:catalog.type']);
    expect(rules({ sync_deadline_hours: '72' })).toEqual(['sync_deadline_hours:catalog.type']);
    expect(rules({ name: '  ' })).toEqual(['name:catalog.type']);
    expect(rules({ jurisdiction_id: null })).toEqual(['jurisdiction_id:catalog.type']);
    expect(rules({ contract_id: null, starts_at: null })).toEqual([]);
    expect(rules({ starts_at: 'demain' })).toEqual(['starts_at:catalog.type']);
  });

  it('montants : entiers en unités mineures, jamais négatifs ni flottants', () => {
    expect(rules({ cash_refund_single_max: 0, refund_new_number_max: '900000000000' })).toEqual([]);
    expect(rules({ cash_refund_single_max: -1 })).toEqual(['cash_refund_single_max:catalog.range']);
    expect(rules({ cash_refund_single_max: 10.5 })).toEqual([
      'cash_refund_single_max:catalog.type',
    ]);
    expect(rules({ card_topup_daily_max_per_card: '12e3' })).toEqual([
      'card_topup_daily_max_per_card:catalog.type',
    ]);
  });

  it('énumérations et listes', () => {
    expect(
      rules({ identity_mode: 'ACCOUNT_REQUIRED', activation_modes: ['DESK', 'SELF_APP'] }),
    ).toEqual([]);
    expect(rules({ identity_mode: 'OPTIONAL' })).toEqual(['identity_mode:catalog.enum']);
    expect(rules({ activation_modes: [] })).toEqual(['activation_modes:catalog.enum']);
    expect(rules({ activation_modes: ['DESK', 'DESK'] })).toEqual([
      'activation_modes:catalog.enum',
    ]);
    expect(rules({ activation_modes: ['KIOSK'] })).toEqual(['activation_modes:catalog.enum']);
    expect(rules({ wallet_scope: 'ORGANIZER' })).toEqual(['wallet_scope:catalog.enum']);
  });

  it('politique de remboursement : forme contrôlée', () => {
    expect(rules({ refund_policy: { open: true, fee_amount: 500, channels: ['CASH'] } })).toEqual(
      [],
    );
    expect(rules({ refund_policy: { open: 'oui' } })).toEqual(['refund_policy:catalog.type']);
    expect(rules({ refund_policy: { open: true, channels: ['CHEQUE'] } })).toEqual([
      'refund_policy:catalog.type',
    ]);
    expect(rules({ refund_policy: { open: true, fee_amount: -1 } })).toEqual([
      'refund_policy:catalog.type',
    ]);
  });

  it('clé inconnue, clé d’un autre niveau', () => {
    expect(rules({ status: 'LIVE' })).toEqual(['status:catalog.unknown_key']);
    expect(rules({ cash_refund_single_max_cap: 100 })).toEqual([
      'cash_refund_single_max_cap:catalog.level',
    ]);
    expect(rules({ sync_deadline_hours: 72 }, { level: 'OPERATOR' })).toEqual([
      'sync_deadline_hours:catalog.level',
    ]);
    expect(rules({ spend_order: 'PAID_FIRST' }, { level: 'PLATFORM' })).toEqual([]);
    expect(rules({ psp_fee_bearer: 'CUSTOMER' }, { level: 'PLATFORM' })).toEqual([
      'psp_fee_bearer:catalog.level',
    ]);
  });

  it('détenteur des fonds et émetteur : seulement en DRAFT', () => {
    expect(
      rules(
        { funds_holder: 'OPERATOR', issuer: 'OPERATOR' },
        { level: 'EVENT', eventStatus: 'DRAFT' },
      ),
    ).toEqual([]);
    expect(
      rules(
        { funds_holder: 'OPERATOR', issuer: 'OPERATOR' },
        { level: 'EVENT', eventStatus: 'LIVE' },
      ),
    ).toEqual(['funds_holder:catalog.draft_only', 'issuer:catalog.draft_only']);
  });

  it('règles croisées : délais en ligne, dates', () => {
    expect(
      rules(
        { online_connect_timeout_ms: 3000 },
        { level: 'EVENT', current: { online_total_timeout_ms: 3000 } },
      ),
    ).toEqual(['online_connect_timeout_ms:catalog.connect_lt_total']);
    expect(rules({ online_connect_timeout_ms: 3000, online_total_timeout_ms: 4000 })).toEqual([]);
    expect(
      rules(
        { ends_at: '2026-07-09T00:00:00Z' },
        { level: 'EVENT', current: { starts_at: '2026-07-10T00:00:00Z' } },
      ),
    ).toEqual(['ends_at:catalog.dates']);
  });
});

describe('maximum du prestataire', () => {
  const resolved: ResolvedConfigView = {
    cash_refund_single_max_cap: {
      value: 40000,
      level: 'OPERATOR',
      version: 3,
      config_version_id: 'v3',
      provisional: false,
    },
  };

  it('au plafond : accepté ; au-delà : refusé, avec la borne et sa source', () => {
    expect(findViolations({ cash_refund_single_max: 40000 }, { level: 'EVENT', resolved })).toEqual(
      [],
    );
    expect(findViolations({ cash_refund_single_max: 40001 }, { level: 'EVENT', resolved })).toEqual(
      [
        {
          field: 'cash_refund_single_max',
          rule: 'operator.cash_refund_single_max_cap',
          requested: 40001,
          limit: 40000,
          source: 'OPERATOR v3',
        },
      ],
    );
  });

  it('sans plafond fixé : seules les bornes fixes valent', () => {
    const none: ResolvedConfigView = {
      cash_refund_single_max_cap: {
        value: null,
        level: null,
        version: null,
        config_version_id: null,
        provisional: false,
      },
    };
    expect(
      findViolations({ cash_refund_single_max: 9_000_000 }, { level: 'EVENT', resolved: none }),
    ).toEqual([]);
  });
});

describe('borne du profil de législation', () => {
  const context: BoundsContext = {
    level: 'EVENT',
    jurisdiction: { country_code: 'SN', version: 1, min_refund_window_days: 90 },
    current: { ends_at: '2026-12-31T00:00:00.000Z' },
  };

  it('30 jours quand la loi en impose 90 : refusé, la violation cite règle, valeur, borne et profil', () => {
    expect(findViolations({ refund_deadline: '2027-01-30T00:00:00Z' }, context)).toEqual([
      {
        field: 'refund_deadline',
        rule: 'jurisdiction.min_refund_window_days',
        requested: '2027-01-30T00:00:00.000Z',
        limit: '2027-03-31T00:00:00.000Z',
        source: 'SN v1',
      },
    ]);
  });

  it('exactement 90 jours : accepté ; fin repoussée sans repousser la date limite : refusé', () => {
    expect(findViolations({ refund_deadline: '2027-03-31T00:00:00Z' }, context)).toEqual([]);
    const moved = findViolations(
      { ends_at: '2027-01-15T00:00:00Z' },
      { ...context, current: { ...context.current, refund_deadline: '2027-03-31T00:00:00Z' } },
    );
    expect(moved.map((v) => v.rule)).toEqual(['jurisdiction.min_refund_window_days']);
  });

  it('profil sans délai légal, ou date limite absente : rien à borner', () => {
    const free = {
      ...context,
      jurisdiction: { country_code: 'SN', version: 2, min_refund_window_days: null },
    };
    expect(findViolations({ refund_deadline: '2027-01-01T00:00:00Z' }, free)).toEqual([]);
    expect(findViolations({ refund_deadline: null }, context)).toEqual([]);
  });
});

describe('refus : problème et messages', () => {
  const context: BoundsContext = {
    level: 'EVENT',
    jurisdiction: { country_code: 'SN', version: 1, min_refund_window_days: 90 },
    current: { ends_at: '2026-12-31T00:00:00.000Z' },
  };

  it('422 VALIDATION_FAILED, détail en français par défaut, toutes les violations jointes', () => {
    const problem = caught(() =>
      assertWithinBounds(
        { refund_deadline: '2027-01-30T00:00:00Z', sync_deadline_hours: 0 },
        context,
        'fr',
      ),
    );
    expect(problem).toBeInstanceOf(ProblemException);
    expect([problem.code, problem.status]).toEqual(['VALIDATION_FAILED', 422]);
    expect(problem.detail).toContain('sync_deadline_hours');
    expect((problem.extensions?.violations as unknown[]).length).toBe(2);
    expect(() => assertWithinBounds({ sync_deadline_hours: 72 }, context, 'fr')).not.toThrow();
  });

  it('le message cite la règle, la valeur demandée et la borne, en français et en anglais', () => {
    const [violation] = findViolations({ refund_deadline: '2027-01-30T00:00:00Z' }, context);
    const fr = violationMessage(violation!, 'fr');
    const en = violationMessage(violation!, 'en');
    for (const text of [fr, en]) {
      expect(text).toContain('jurisdiction.min_refund_window_days');
      expect(text).toContain('2027-01-30T00:00:00.000Z');
      expect(text).toContain('2027-03-31T00:00:00.000Z');
      expect(text).toContain('SN v1');
    }
    expect(fr).toContain('Date limite de remboursement');
    expect(en).toContain('Refund deadline');
    expect(fr).not.toEqual(en);
  });

  it('chaque règle a un message dans les deux langues, sans texte SQL, qui nomme la règle', () => {
    for (const rule of [...MESSAGE_RULES, 'regle.inconnue']) {
      const violation = { field: 'champ', rule, requested: 1, limit: 2, source: 'catalog' };
      for (const language of ['fr', 'en'] as const) {
        const text = violationMessage(violation, language);
        expect(text).toContain(rule);
        expect(text).not.toMatch(/SELECT|INSERT|CHECK|constraint|violates/i);
      }
      expect(violationMessage(violation, 'fr')).not.toEqual(violationMessage(violation, 'en'));
    }
  });
});

describe('qui règle quoi', () => {
  it('toutes les clés au rôle tenu : rend ce rôle', () => {
    expect(assertSettableBy(['name', 'refund_deadline'], 'EVENT', ['ORGANIZER_ADMIN'], 'fr')).toBe(
      'ORGANIZER_ADMIN',
    );
    expect(assertSettableBy(['sync_deadline_hours'], 'EVENT', ['OPERATOR_ADMIN'], 'fr')).toBe(
      'OPERATOR_ADMIN',
    );
    expect(assertSettableBy(['spend_order'], 'PLATFORM', ['PLATFORM_ADMIN'], 'fr')).toBe(
      'PLATFORM_ADMIN',
    );
  });

  it('clé d’un autre rôle : 403, dans les deux sens', () => {
    expect(
      caught(() => assertSettableBy(['sync_deadline_hours'], 'EVENT', ['ORGANIZER_ADMIN'], 'fr'))
        .code,
    ).toBe('FORBIDDEN');
    expect(caught(() => assertSettableBy(['name'], 'EVENT', ['OPERATOR_ADMIN'], 'fr')).code).toBe(
      'FORBIDDEN',
    );
    expect(
      caught(() => assertSettableBy(['spend_order'], 'OPERATOR', ['ORGANIZER_ADMIN'], 'fr')).code,
    ).toBe('FORBIDDEN');
    expect(
      caught(() =>
        assertSettableBy(['name', 'sync_deadline_hours'], 'EVENT', ['ORGANIZER_ADMIN'], 'fr'),
      ).code,
    ).toBe('FORBIDDEN');
  });

  it('clés de deux rôles, même tenus tous les deux : 422, deux demandes distinctes', () => {
    const problem = caught(() =>
      assertSettableBy(
        ['name', 'sync_deadline_hours'],
        'EVENT',
        ['ORGANIZER_ADMIN', 'OPERATOR_ADMIN'],
        'en',
      ),
    );
    expect([problem.code, problem.status]).toEqual(['VALIDATION_FAILED', 422]);
    expect(problem.detail).toContain('two separate requests');
    expect(problem.detail).toContain('catalog.mixed_roles');
  });

  it('clé inconnue : laissée au contrôle des bornes', () => {
    expect(assertSettableBy(['status'], 'EVENT', [], 'fr')).toBeUndefined();
  });
});
