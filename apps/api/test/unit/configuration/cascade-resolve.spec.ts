// Unitaires : fusion des niveaux de la cascade (§4.1, FR-014). Le faux client rend les versions que la base aurait
// retenues à la date demandée ; la sélection par date est prouvée en intégration (cascade.spec.ts).
import type { AuditService } from '../../../src/audit/audit.service';
import { CascadeService, eventSnapshot, jsonValue } from '../../../src/configuration/cascade.service';
import type { ConfigLevel } from '../../../src/configuration/settings-catalog';
import type { TxClient } from '../../../src/db/tenant-tx';

const OPERATOR = '00000000-0000-4000-8000-0000000000a1';
const ORGANIZER = '00000000-0000-4000-8000-0000000000b1';
const EVENT = '00000000-0000-4000-8000-0000000000c1';
const PARTICIPATION = '00000000-0000-4000-8000-0000000000d1';
const AT = new Date('2026-06-01T00:00:00Z');

interface Fixture {
  versions?: Partial<Record<ConfigLevel, { version: number; settings: Record<string, unknown> }>>;
  event?: Record<string, unknown>;
}

function fakeClient(fixture: Fixture): TxClient {
  const rows = Object.entries(fixture.versions ?? {}).map(([level, v]) => ({
    id: `id-${level}-${v!.version}`,
    operator_id: level === 'PLATFORM' ? null : OPERATOR,
    scope_type: level,
    scope_id: 'x',
    version: v!.version,
    valid_from: new Date('2026-01-01T00:00:00Z'),
    settings: v!.settings,
  }));
  const query = (sql: string) => {
    if (sql.includes('DISTINCT ON')) return Promise.resolve({ rows, rowCount: rows.length });
    if (sql.includes('FROM event')) return Promise.resolve({ rows: fixture.event ? [fixture.event] : [], rowCount: fixture.event ? 1 : 0 });
    if (sql.includes('LIMIT 1')) {
      const has = fixture.versions?.EVENT !== undefined;
      return Promise.resolve({ rows: has ? [{}] : [], rowCount: has ? 1 : 0 });
    }
    throw new Error(`requête inattendue : ${sql}`);
  };
  return { query } as unknown as TxClient;
}

const service = new CascadeService({ record: () => Promise.resolve() } as unknown as AuditService);
const target = { operatorId: OPERATOR, organizerId: ORGANIZER, eventId: EVENT, participationId: PARTICIPATION };

describe('résolution de la cascade', () => {
  it('aucune version : défauts du catalogue, sans niveau', async () => {
    const view = await service.resolve(fakeClient({}), { operatorId: OPERATOR }, AT);
    expect(view.spend_order).toEqual({ value: 'PROMO_FIRST', level: null, version: null, config_version_id: null, provisional: false });
    expect(view.sync_deadline_hours?.value).toBe(72);
    expect(view.cash_refund_single_max_cap?.value).toBeNull();
    expect(view.funds_holder).toBeUndefined();
  });

  it('cinq niveaux : la valeur du niveau le plus précis qui définit la clé l’emporte', async () => {
    const view = await service.resolve(
      fakeClient({
        versions: {
          PLATFORM: { version: 4, settings: { spend_order: 'PAID_FIRST' } },
          OPERATOR: { version: 2, settings: { psp_fee_bearer: 'OPERATOR', cash_refund_single_max_cap: 40000 } },
          ORGANIZER: { version: 7, settings: { psp_fee_bearer: 'CUSTOMER' } },
          EVENT: { version: 3, settings: { sync_deadline_hours: 48 } },
          PARTICIPATION: { version: 1, settings: {} },
        },
        event: { sync_deadline_hours: 99 },
      }),
      target,
      AT,
    );
    expect(view.spend_order).toMatchObject({ value: 'PAID_FIRST', level: 'PLATFORM', version: 4, config_version_id: 'id-PLATFORM-4' });
    expect(view.psp_fee_bearer).toMatchObject({ value: 'CUSTOMER', level: 'ORGANIZER', version: 7 });
    expect(view.cash_refund_single_max_cap).toMatchObject({ value: 40000, level: 'OPERATOR', version: 2 });
    // Colonne de l'événement : l'instantané de la version en vigueur à la date fait foi, pas la colonne courante.
    expect(view.sync_deadline_hours).toMatchObject({ value: 48, level: 'EVENT', version: 3 });
  });

  it('une clé n’est lue qu’aux niveaux où elle se règle', async () => {
    const view = await service.resolve(
      fakeClient({ versions: { PLATFORM: { version: 1, settings: { psp_fee_bearer: 'CUSTOMER', cash_refund_single_max_cap: 1 } } } }),
      { operatorId: OPERATOR },
      AT,
    );
    expect(view.psp_fee_bearer).toMatchObject({ value: 'ORGANIZER', level: null });
    expect(view.cash_refund_single_max_cap?.level).toBeNull();
  });

  it('événement sans version (créé hors de l’API) : ses colonnes font foi', async () => {
    const view = await service.resolve(fakeClient({ event: { sync_deadline_hours: 24, cash_refund_single_max: 75000n } }), target, AT);
    expect(view.sync_deadline_hours).toEqual({ value: 24, level: 'EVENT', version: null, config_version_id: null, provisional: false });
    expect(view.cash_refund_single_max?.value).toBe(75000);
  });

  it('date limite de remboursement absente : fin + 30 jours, marquée provisoire', async () => {
    const event = { refund_deadline: null, ends_at: new Date('2026-12-31T00:00:00Z') };
    const view = await service.resolve(fakeClient({ versions: { EVENT: { version: 1, settings: { refund_deadline: null } } }, event }), target, AT);
    expect(view.refund_deadline).toEqual({ value: '2027-01-30T00:00:00.000Z', level: null, version: null, config_version_id: null, provisional: true });
    const set = await service.resolve(
      fakeClient({ versions: { EVENT: { version: 2, settings: { refund_deadline: '2027-06-01T00:00:00.000Z' } } }, event }),
      target,
      AT,
    );
    expect(set.refund_deadline).toMatchObject({ value: '2027-06-01T00:00:00.000Z', level: 'EVENT', provisional: false });
  });
});

describe('instantané d’un événement', () => {
  it('contient les réglages des colonnes, pas le détenteur des fonds ni les attributs', () => {
    const snapshot = eventSnapshot({
      name: 'Festival', funds_holder: 'ORGANIZER', sync_deadline_hours: 72, cash_refund_single_max: 50000n,
      refund_deadline: new Date('2027-01-30T00:00:00Z'), activation_modes: ['DESK'],
    });
    expect(snapshot).toMatchObject({ sync_deadline_hours: 72, cash_refund_single_max: 50000, refund_deadline: '2027-01-30T00:00:00.000Z', activation_modes: ['DESK'] });
    expect(snapshot).not.toHaveProperty('name');
    expect(snapshot).not.toHaveProperty('funds_holder');
    expect(snapshot.issuer).toBeNull();
  });

  it('montants : entier, ou texte au-delà de 2^53', () => {
    expect(jsonValue(12n)).toBe(12);
    expect(jsonValue(9007199254740993n)).toBe('9007199254740993');
    expect(jsonValue(undefined)).toBeNull();
  });
});
