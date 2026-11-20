// Mission 9b, règle 3 de CLAUDE.md : tests qui échouent si la limite d'un écart accepté s'élargit.
//   - OP-N140 levé (mission 11a, WP08/WP09) : `redact.ts` masque l'IBAN, les IBAN sont chiffrés ;
//   - OP-N145 (mission 11a, WP02/WP03/WP09) : l'`INSERT` direct d'une demande de remboursement
//     n'est ouvert qu'à `cashless_app`, sur 16 colonnes ; la base refuse tout état final.
import { REDACTED, REDACTED_FIELDS, redactSecrets } from '../../../src/errors/redact';
import { withOwner } from '../../support/db';
import { fundedCustomer } from '../refunds/create-fixtures';
import { createRefundWorld, type RefundWorld } from '../refunds/refund-flow-fixtures';

jest.setTimeout(300_000);

describe('OP-N140 levé : errors/redact.ts masque l’IBAN', () => {
  const iban = 'SN08SN0100152000048500003035';
  it('l’IBAN est masqué (JSON, clé=valeur) ; liste de WP08 (ancienne + iban)', () => {
    expect(redactSecrets(`{"iban":"${iban}"}`)).not.toContain(iban);
    expect(redactSecrets(`{"iban":"${iban}"}`)).toContain(REDACTED);
    expect(redactSecrets(`iban=${iban}`)).not.toContain(iban);
    expect([...REDACTED_FIELDS]).toEqual([
      'pin',
      'token',
      'customer_qr_token',
      'qr_payload',
      'x-approval-token',
      'iban',
    ]);
  });
  it('les secrets déjà couverts restent masqués', () => {
    expect(redactSecrets('"pin":"123456"')).toBe(`"pin":"${REDACTED}"`);
  });
});

describe('OP-N145 : qui peut écrire dans refund_request', () => {
  it('INSERT réservé à cashless_app ; aucun DELETE ; UPDATE de cashless_app borné aux colonnes de transition', async () => {
    const { grants, columns } = await withOwner(async (db) => {
      const g = await db.query<{ grantee: string; privilege_type: string }>(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = 'refund_request'
            AND grantee NOT IN ('postgres')`,
      );
      const c = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE table_schema = 'public' AND table_name = 'refund_request'
            AND grantee = 'cashless_app' AND privilege_type = 'UPDATE' ORDER BY column_name`,
      );
      return { grants: g.rows, columns: c.rows.map((r) => r.column_name) };
    });
    const insertGrantees = grants
      .filter((g) => g.privilege_type === 'INSERT')
      .map((g) => g.grantee);
    // Plus aucun INSERT de table (WP03) : le droit est par colonne, vérifié ci-dessous.
    expect(insertGrantees).toEqual([]);
    expect(grants.filter((g) => ['DELETE', 'TRUNCATE'].includes(g.privilege_type))).toEqual([]);
    // Décision 19 : un droit par colonne (GRANT INSERT (status) ...) n'apparaît pas dans role_table_grants ;
    // has_column_privilege le voit, droits hérités compris, pour chaque rôle cashless_* et chaque colonne.
    const perColumn = await withOwner((db) =>
      db.query<{ role: string; column_name: string; priv: string }>(
        `SELECT r.rolname AS role, a.attname AS column_name, priv
           FROM pg_roles r
           CROSS JOIN pg_attribute a
           CROSS JOIN unnest(ARRAY['INSERT', 'DELETE']) AS priv
          WHERE r.rolname LIKE 'cashless\\_%' AND NOT r.rolsuper
            AND a.attrelid = 'public.refund_request'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND (   (priv = 'INSERT' AND has_column_privilege(r.rolname, a.attrelid, a.attnum, 'INSERT'))
                 OR (priv = 'DELETE' AND has_table_privilege(r.rolname, a.attrelid, 'DELETE')))`,
      ),
    );
    const byPriv = (priv: string) => [
      ...new Set(perColumn.rows.filter((r) => r.priv === priv).map((r) => r.role)),
    ];
    expect(byPriv('INSERT')).toEqual(['cashless_app']);
    expect(byPriv('DELETE')).toEqual([]);
    // Exactement les 16 colonnes de WP03 pour cashless_app, aucune autre (14 refusées).
    const granted = await withOwner((db) =>
      db.query<{ column_name: string; ok: boolean }>(
        `SELECT a.attname AS column_name,
                has_column_privilege('cashless_app', a.attrelid, a.attnum, 'INSERT') AS ok
           FROM pg_attribute a
          WHERE a.attrelid = 'public.refund_request'::regclass
            AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attname`,
      ),
    );
    expect(granted.rows.filter((r) => r.ok).map((r) => r.column_name)).toEqual(
      [
        'currency',
        'customer_id',
        'estimated_amount',
        'event_id',
        'extra_check_required',
        'fee',
        'hold_until',
        'iban',
        'ledger_id',
        'method',
        'msisdn',
        'new_number',
        'operator_id',
        'requested_by',
        'status',
        'wallet_id',
      ].sort(),
    );
    expect(granted.rows.filter((r) => !r.ok)).toHaveLength(14);
    expect(columns).toEqual(
      [
        'status',
        'updated_at',
        'holder_decision',
        'holder_decided_at',
        'approval_request_id',
        'approved_by',
        'transaction_id',
        'external_reference',
        'failure_reason',
        'reject_reason',
        'reversal_transaction_id',
        'confirmed_by',
        'confirmed_at',
        'estimated_amount',
        'fee',
      ].sort(),
    );
  });
});

describe('OP-N145 : insertion sous cashless_app (droits de colonne et déclencheur CL057)', () => {
  let r: RefundWorld;
  let walletId: string;
  beforeAll(async () => {
    r = await createRefundWorld();
    walletId = (await fundedCustomer(r.w, 25_000)).walletId;
  });
  afterAll(async () => {
    await r.app.close();
  });

  const BASE: Record<string, unknown> = {
    status: 'REQUESTED',
    method: 'WAVE',
    msisdn: '+221770000099',
    new_number: true,
    estimated_amount: 100,
    fee: 0,
    currency: 'XOF',
  };

  /** Insertion sous `cashless_app`, dans une transaction toujours annulée. */
  async function insertAsApp(over: Record<string, unknown>): Promise<{ code?: string }> {
    const row = {
      operator_id: r.w.ops.a,
      ledger_id: r.w.ids.ledgerA,
      event_id: r.w.ids.eventA,
      wallet_id: walletId,
      ...BASE,
      ...over,
    };
    const cols = Object.keys(row);
    return withOwner(async (db) => {
      await db.query('BEGIN');
      try {
        await db.query(`SELECT set_config('app.operator_id', $1, true)`, [r.w.ops.a]);
        await db.query('SET LOCAL ROLE cashless_app');
        await db.query(
          `INSERT INTO refund_request (${cols.join(', ')})
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          Object.values(row),
        );
        return {};
      } catch (error) {
        return { code: (error as { code?: string }).code };
      } finally {
        await db.query('ROLLBACK');
      }
    });
  }

  it('états initiaux AWAITING_HOLDER et REQUESTED : insertion permise', async () => {
    expect(await insertAsApp({ status: 'REQUESTED' })).toEqual({});
    expect(
      await insertAsApp({ status: 'AWAITING_HOLDER', hold_until: new Date(Date.now() + 36e5) }),
    ).toEqual({});
  });

  it.each(['PAID', 'CANCELLED', 'PROCESSING', 'REJECTED'])(
    'état %s à l’insertion : CL057 (colonnes accordées seules)',
    async (status) => {
      expect(await insertAsApp({ status })).toEqual({ code: 'CL057' });
    },
  );

  it.each(['approved_by', 'external_reference', 'transaction_id', 'confirmed_by'])(
    'colonne de transition %s citée : 42501',
    async (column) => {
      const value =
        column === 'external_reference' ? 'VIR-1' : '00000000-0000-4000-8000-000000000001';
      expect(await insertAsApp({ [column]: value })).toEqual({ code: '42501' });
    },
  );

  it('PAID avec une colonne non accordée : 42501', async () => {
    expect(await insertAsApp({ status: 'PAID', external_reference: 'VIR-1' })).toEqual({
      code: '42501',
    });
  });

  it('IBAN en clair sous cashless_app : refusé par le CHECK (23514)', async () => {
    const iban = 'SN08SN0100152000048500003035';
    expect(await insertAsApp({ method: 'BANK_TRANSFER', msisdn: null, iban })).toEqual({
      code: '23514',
    });
  });
});
