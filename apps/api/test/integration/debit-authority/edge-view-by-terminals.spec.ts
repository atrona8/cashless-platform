// `edge_base_url` et époque vus par les terminaux (mission passerelle-locale, lot WP11, T051 ; FR-003, FR-013).
// `GET /device/config` et le battement de cœur annoncent `debit_authority` : après `GRANTED`, `ACTIVE`, rendu demandé,
// abandon et reprise forcée, l'URL est celle de la passerelle courante tant que l'autorité est `EDGE`, nulle sinon ;
// l'époque monte aux bons moments (e+1, e+2) ; un terminal d'un autre événement ne la voit pas. Aucun défaut : le
// service de configuration n'est pas modifié.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { withOwner } from '../../support/db';
import { TestTerminal, type TerminalResponse } from '../../support/test-terminal';
import { ownerRows } from '../../support/media-fixtures';
import { DebitWorld } from './debit-authority-world';

jest.setTimeout(240_000);

describe('autorité de débit vue par les terminaux (WP11, T051)', () => {
  let dw: DebitWorld;
  let own: TestTerminal;
  let foreign: TestTerminal;
  let foreignLedger = '';

  beforeAll(async () => {
    dw = await DebitWorld.create();
    const { pw } = dw;
    own = (await pw.terminal({ mode: 'TOPUP_DESK' })).t;
    // Autre événement du même prestataire, avec son grand livre et son terminal.
    const eventId = randomUUID();
    foreignLedger = await withOwner(async (db) => {
      await db.query(
        `INSERT INTO event (id, operator_id, organizer_id, name, currency, timezone, jurisdiction_id,
                            funds_holder)
         SELECT $2::uuid, operator_id, organizer_id, 'Autre événement', currency, timezone,
                jurisdiction_id, funds_holder FROM event WHERE id = $1`,
        [pw.w.ids.eventA, eventId],
      );
      await db.query(`SELECT set_config('app.operator_id', $1, false)`, [pw.w.ops.a]);
      const { rows } = await db.query<{ ledger: string }>(
        'SELECT open_event_ledger($1) AS ledger',
        [eventId],
      );
      foreign = await new TestTerminal('ANDROID').enroll(db, {
        operatorId: pw.w.ops.a,
        eventId,
        posId: null,
        mode: 'TOPUP_DESK',
        ca: pw.ca,
      });
      return rows[0]!.ledger;
    });
    await foreign.issueToken(pw.tokens);
  });
  afterAll(async () => {
    await dw?.close();
  });
  beforeEach(async () => {
    await dw.reset();
  });

  const config = (t: TestTerminal): Promise<TerminalResponse> =>
    t.request(dw.pw.api.baseUrl, dw.pw.api.tls.serverCaPem, {
      method: 'GET',
      path: '/device/config',
    });
  const beat = (t: TestTerminal): Promise<TerminalResponse> =>
    t.request(dw.pw.api.baseUrl, dw.pw.api.tls.serverCaPem, {
      method: 'POST',
      path: '/device/heartbeat',
      body: {
        device_time: new Date().toISOString(),
        snapshot_version: null,
        last_local_seq: 0,
        pending_operations: 0,
        pending_exposure: 0,
        battery_percent: 80,
        app_version: '1.0.0',
      },
    });
  /** Ce que le terminal lit : configuration et battement concordent. */
  const seen = async (t: TestTerminal) => {
    const c = await config(t);
    const b = await beat(t);
    expect(c.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.debit_authority).toEqual(c.body.debit_authority);
    return c.body.debit_authority as {
      ledger_id: string;
      authority: string;
      epoch: number;
      edge_gateway_id: string | null;
      edge_base_url: string | null;
    };
  };

  it('GRANTED puis ACTIVE : URL de la passerelle courante, époque e+1 (inchangée à l’accusé)', async () => {
    const start = await seen(own);
    expect(start).toMatchObject({
      authority: 'CENTRAL',
      edge_base_url: null,
      edge_gateway_id: null,
    });
    const gateway = await dw.gateway();
    const handover = await dw.grant(gateway);
    const granted = await seen(own);
    expect(granted).toMatchObject({
      ledger_id: dw.ledger,
      authority: 'EDGE',
      epoch: start.epoch + 1,
      edge_gateway_id: gateway.id,
      edge_base_url: gateway.lanUrl,
    });
    await dw.ack(gateway, handover);
    expect(await seen(own)).toEqual(granted);
  });

  it('rendu demandé : toujours EDGE, même URL et même époque ; abandon du rendu : idem', async () => {
    const { gateway } = await dw.edgeActive();
    const before = await seen(own);
    await dw.change(dw.pw.w.operatorAdminA, { target: 'CENTRAL', reason: 'Retour' });
    expect(await seen(own)).toEqual(before);
    await dw.change(dw.pw.w.operatorAdminA, { target: 'CENTRAL', reason: 'Abandon' });
    expect(await seen(own)).toEqual(before);
    expect(before.edge_base_url).toBe(gateway.lanUrl);
  });

  it('bascule non accusée abandonnée : URL nulle, époque e+2', async () => {
    const start = await seen(own);
    await dw.grant(await dw.gateway());
    await dw.change(dw.pw.w.operatorAdminA, { target: 'CENTRAL', reason: 'Annulée' });
    expect(await seen(own)).toMatchObject({
      authority: 'CENTRAL',
      epoch: start.epoch + 2,
      edge_gateway_id: null,
      edge_base_url: null,
    });
  });

  it('reprise forcée : URL nulle, époque e+1 de plus après la bascule active', async () => {
    await dw.edgeActive();
    const active = await seen(own);
    const asked = await dw.change(dw.pw.w.operatorAdminA, {
      target: 'CENTRAL',
      reason: 'Panne',
      force: true,
      gateway_confirmed_offline: true,
    });
    const done = await dw.bo(
      'POST',
      `/approval-requests/${String(asked.body.approval_request_id)}/approve`,
      dw.operatorAdmin2,
      {},
    );
    expect(done.status).toBe(200);
    expect(await seen(own)).toMatchObject({
      authority: 'CENTRAL',
      epoch: active.epoch + 1,
      edge_base_url: null,
      edge_gateway_id: null,
    });
  });

  it('un terminal d’un autre événement ne voit ni l’URL ni l’époque de la passerelle', async () => {
    await dw.edgeActive();
    const other = await seen(foreign);
    expect(other).toMatchObject({
      ledger_id: foreignLedger,
      authority: 'CENTRAL',
      edge_base_url: null,
      edge_gateway_id: null,
    });
    expect(other.ledger_id).not.toBe(dw.ledger);
    const ledgerEpoch = await ownerRows<{ authority_epoch: number }>(
      'SELECT authority_epoch FROM ledger WHERE id = $1',
      [foreignLedger],
    );
    expect(other.epoch).toBe(ledgerEpoch[0]!.authority_epoch);
  });
});
