// Mission 9b, règle 3 de CLAUDE.md : tests qui échouent si la limite d'un écart accepté s'élargit.
//   - OP-N140 : `redact.ts` ne masque pas l'IBAN (comportement actuel figé) ;
//   - OP-N145 : l'`INSERT` direct d'une demande de remboursement n'est ouvert qu'à `cashless_app`.
// Quand la mission 11a lève ces points, mettre ces tests à jour avec la levée.
import { REDACTED, REDACTED_FIELDS, redactSecrets } from '../../../src/errors/redact';
import { withOwner } from '../../support/db';

jest.setTimeout(120_000);

describe('OP-N140 : limite de errors/redact.ts', () => {
  const iban = 'SN08SN0100152000048500003035';
  it('l’IBAN n’est pas masqué (limite connue) ; la liste des champs masqués est inchangée', () => {
    expect(redactSecrets(`{"iban":"${iban}"}`)).toContain(iban);
    expect(redactSecrets(`iban=${iban}`)).toContain(iban);
    expect([...REDACTED_FIELDS]).toEqual([
      'pin',
      'token',
      'customer_qr_token',
      'qr_payload',
      'x-approval-token',
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
    expect(insertGrantees).toEqual(['cashless_app']);
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
