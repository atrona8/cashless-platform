// Décision 17 du porteur (relecture de WP13) : les bornes de période de l'export comptable sont des jours UTC,
// quel que soit le fuseau de la session. Avant la correction, `t.occurred_at >= $3::date` suivait `TimeZone`.
// Une écriture à 23:30 UTC et une à 00:30 UTC (le lendemain) doivent tomber chacune dans son jour UTC, sous une
// session dont le fuseau est en avance (Pacific/Auckland) comme en retard (America/Los_Angeles) sur UTC.
import { randomUUID } from 'node:crypto';
import { TenantTx } from '../../../src/db/tenant-tx';
import { AccountingExportService } from '../../../src/statements/accounting-export.service';
import { withOwner } from '../../support/db';
import { createStatementsWorld, type StatementsWorld } from '../statements/statements-world';

jest.setTimeout(240_000);

describe('export comptable : bornes de période en UTC (décision 17)', () => {
  let w: StatementsWorld;
  let service: AccountingExportService;
  let tx: TenantTx;
  const day1 = '2030-05-10';
  const day2 = '2030-05-11';
  const keys = { late: `utc-bounds:${randomUUID()}`, early: `utc-bounds:${randomUUID()}` };
  const ids: Record<'late' | 'early', string> = { late: '', early: '' };

  beforeAll(async () => {
    w = await createStatementsWorld();
    service = w.app.get(AccountingExportService, { strict: false });
    tx = w.app.get(TenantTx);
    // T1 met l'événement en service (LIVE) ; les écritures de ce test sont postées à des dates qui lui sont étrangères.
    await w.replayTo(1);
    const post = (key: string, at: string) =>
      withOwner(async (db) => {
        await db.query(`SELECT set_config('app.operator_id', $1, false)`, [w.fx.parties.OPE]);
        const { rows } = await db.query<{ id: string }>(
          `SELECT post_transaction($1, 'ADJUSTMENT', $2, $3::timestamptz, 'BACKOFFICE', jsonb_build_array(
             jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'S-ATTENTE'), 'amount', 700::bigint),
             jsonb_build_object('account_id', (SELECT id FROM account WHERE ledger_id = $1 AND code = 'L-ORG-COM'), 'amount', -700::bigint)),
             NULL, NULL, $4, $5) AS id`,
          [w.fx.ledgerId, key, at, w.fx.users.author, w.fx.users.approver],
        );
        return rows[0]!.id;
      });
    ids.late = await post(keys.late, `${day1}T23:30:00Z`);
    ids.early = await post(keys.early, `${day2}T00:30:00Z`);
  });
  afterAll(async () => w.close());

  /** Export de la période, dans une session dont le fuseau est `zone` (réglage local à la transaction). */
  const exportUnder = (zone: string, from: string, to: string) =>
    tx.run(w.fx.parties.OPE, async (client) => {
      await client.query(`SELECT set_config('TimeZone', $1, true)`, [zone]);
      const { rows } = await client.query<{ tz: string }>(
        "SELECT current_setting('TimeZone') AS tz",
      );
      expect(rows[0]!.tz).toBe(zone);
      return service.build(client, w.fx.parties.OPE, w.fx.parties.ORG, from, to);
    });
  const touched = (text: string) =>
    [ids.late, ids.early]
      .filter((id) => text.includes(id))
      .map((id) => (id === ids.late ? 'late' : 'early'));

  it.each(['Pacific/Auckland', 'America/Los_Angeles', 'UTC'])(
    'session en %s : 23:30 UTC reste le %s, 00:30 UTC le lendemain',
    async (zone) => {
      const first = await exportUnder(zone, day1, day1);
      expect(touched(first.text)).toEqual(['late']);
      expect(first.text).toContain(`,${day1},`);
      expect(first.text).not.toContain(`,${day2},`);
      const second = await exportUnder(zone, day2, day2);
      expect(touched(second.text)).toEqual(['early']);
      expect(second.text).toContain(`,${day2},`);
      const both = await exportUnder(zone, day1, day2);
      expect(touched(both.text).sort()).toEqual(['early', 'late']);
    },
  );

  it('la date affichée de chaque écriture est celle du jour UTC qui la borne', async () => {
    const { text } = await exportUnder('Pacific/Auckland', day1, day2);
    const lines = text.split('\r\n').filter((l) => l.includes(ids.late) || l.includes(ids.early));
    expect(lines.filter((l) => l.includes(ids.late)).every((l) => l.includes(`,${day1},`))).toBe(
      true,
    );
    expect(lines.filter((l) => l.includes(ids.early)).every((l) => l.includes(`,${day2},`))).toBe(
      true,
    );
  });
});
