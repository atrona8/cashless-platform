// Balayage des secrets avec canari (mission 6, lot WP14, T070 ; SC-006 ; NFR-005, A5, A22 ; modèle :
// payment-secrets.spec.ts). Les secrets du faux coffre (adaptateur, notification courant et précédent) et les valeurs
// de signature envoyées reçoivent des marqueurs aléatoires propres à la suite. Après un parcours qui touche tout ce
// qui porte un secret, chaque marqueur est cherché sous toutes ses formes (texte, hexadécimal comme `bytea`, base64)
// dans TOUTES les tables (dont `api_idempotency`, `audit_log`, `psp_event`, `anomaly`, `psp_webhook_rejection`), dans
// tout ce qui part au journal (Logger de Nest, console, sorties) et dans toutes les réponses, y compris d'erreur : 0.
// Le corps d'une notification REFUSÉE n'apparaît nulle part (seule son empreinte SHA-256 est au journal). Contrôle du
// balayage : les empreintes attendues sont au journal, les configurations en base, les canaris dans le coffre : le
// test échoue s'il ne cherche rien. Droit par colonne : `secret_ref` et `psp_event.body` illisibles sous cashless_app.
// Écritures directes en base : amorçage seulement (suspension d'une configuration pour le cas « suspendue »).
import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fakeEvents, signFakeNotification } from '../../../src/psp/fake/fake-notification-signer';
import { APP_URL, connect } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import type { TerminalResponse } from '../../support/test-terminal';
import { ChargebackWorld } from '../chargebacks/chargeback-fixtures';
import {
  ageTopup,
  captureLogs,
  closeBacklog,
  startPoller,
  type PollerProcess,
} from '../webhooks/webhook-fixtures';

jest.setTimeout(400_000);

const tag = () => randomBytes(8).toString('hex');
const CANARY = {
  current: `CNRYcur${tag()}`,
  previous: `CNRYprev${tag()}`,
  adapter: `CNRYadp${tag()}`,
  wrong: `CNRYwrong${tag()}`,
  refusedBody: `BODYMARK${tag()}`,
};

const forms = (value: string): string[] => [
  value,
  Buffer.from(value, 'utf8').toString('hex'),
  Buffer.from(value, 'utf8').toString('base64'),
];

describe('SC-006 : aucun secret ni signature dans les tables, les journaux, les réponses', () => {
  let c: ChargebackWorld;
  let poller: PollerProcess;
  const responses: string[] = [];
  const signatures: string[] = [];
  let logs: ReturnType<typeof captureLogs>;
  let refusedHash = '';
  const cw = () => c.cw;
  const p = () => c.p;

  const keep = (res: TerminalResponse): TerminalResponse => {
    responses.push(res.text);
    return res;
  };
  const signatureOf = (headers: Record<string, string>) => {
    for (const value of Object.values(headers)) {
      signatures.push(value);
      const v1 = /v1=([0-9a-f]+)/.exec(value)?.[1];
      if (v1) signatures.push(v1);
    }
  };

  beforeAll(async () => {
    c = await ChargebackWorld.create();
    await closeBacklog();
    poller = await startPoller(c.w);
    const [config] = await ownerRows<{ secret_ref: string }>(
      'SELECT secret_ref FROM psp_configuration WHERE psp_configuration_id = $1',
      [p().configs.WAVE],
    );
    p().store.put(config!.secret_ref, {
      current: CANARY.current,
      previous: CANARY.previous,
      previousValidUntil: new Date(Date.now() + 3_600_000),
      adapter: CANARY.adapter,
    });
  }, 300_000);
  afterAll(async () => {
    logs?.restore();
    await poller?.close();
    await c?.close();
  });

  it('parcours qui touche tout ce qui porte un secret', async () => {
    logs = captureLogs();
    const op = cw().w.operatorAdminA;
    const org = cw().w.organizerAdminA;
    const organizerId = cw().w.ids.organizerA;
    // Configurations : création, lecture, liste (OPERATOR_ADMIN et ORGANIZER_ADMIN).
    const ref = `psp/${p().holderId}/canary-${tag()}`;
    keep(
      await cw().bo('POST', `/organizers/${organizerId}/psp-configurations`, op, {
        method: 'WAVE',
        provider: 'WAVE',
        holder_party_id: p().holderId,
        secret_ref: ref,
      }),
    );
    for (const who of [op, org]) {
      keep(await cw().bo('GET', `/organizers/${organizerId}/psp-configurations`, who));
      keep(await cw().bo('GET', `/psp-configurations/${p().configs.WAVE}`, who));
    }
    // Recharges : guichet (WAVE) et festivalier (CARD).
    const t = await cw().terminal();
    await cw().open(t, cw().w.cashierA);
    const wallet = await p().wallet();
    const desk = keep(
      await cw().term(t, 'POST', '/topups/psp', cw().w.cashierA, p().body(wallet.walletId)),
    );
    expect(desk.status).toBe(201);
    const row = (await p().read(String(desk.body.topup_id)))!;
    const w2 = await p().wallet();
    const card = keep(
      await p().cust(
        w2.customer,
        'POST',
        '/topups/psp',
        p().body(w2.walletId, { provider: 'CARD' }),
      ),
    );
    const cardRow = (await p().read(String(card.body.topup_id)))!;
    // Notifications acceptées (secret courant, puis secret précédent encore valide), rejouées.
    const good = fakeEvents.succeeded({
      id: `evt-${randomUUID()}`,
      merchantReference: row.topupId,
      paymentId: row.providerPaymentRef!,
      amount: Number(row.amount),
      currency: row.currency,
    });
    for (const secret of [CANARY.current, CANARY.previous]) {
      const signed = signFakeNotification({
        provider: 'WAVE',
        secret,
        event: { ...good, id: `evt-${randomUUID()}` },
      });
      signatureOf(signed.headers);
      keep(await c.w.raw(signed.rawBody.toString('utf8'), signed.headers, { method: 'WAVE' }));
    }
    const replayEvent = signFakeNotification({
      provider: 'WAVE',
      secret: CANARY.current,
      event: good,
    });
    signatureOf(replayEvent.headers);
    keep(await c.w.raw(replayEvent.rawBody.toString('utf8'), replayEvent.headers));
    keep(await c.w.raw(replayEvent.rawBody.toString('utf8'), replayEvent.headers));
    // Notifications refusées : signature fausse, horodatage faux, corps trop gros, fournisseur inconnu.
    const refusedEvent = fakeEvents.succeeded({
      id: `evt-${randomUUID()}`,
      merchantReference: CANARY.refusedBody,
      paymentId: 'pay-refused',
      amount: 1,
      currency: 'XOF',
    });
    const wrong = signFakeNotification({
      provider: 'WAVE',
      secret: CANARY.wrong,
      event: refusedEvent,
    });
    signatureOf(wrong.headers);
    refusedHash = createHash('sha256').update(wrong.rawBody).digest('hex');
    expect(keep(await c.w.raw(wrong.rawBody.toString('utf8'), wrong.headers)).status).toBe(401);
    const stale = signFakeNotification({
      provider: 'WAVE',
      secret: CANARY.current,
      event: refusedEvent,
      timestamp: Math.floor(Date.now() / 1000) - 7200,
    });
    signatureOf(stale.headers);
    keep(await c.w.raw(stale.rawBody.toString('utf8'), stale.headers));
    keep(await c.w.raw(JSON.stringify({ pad: CANARY.refusedBody.repeat(10_000) }), wrong.headers));
    // Configuration suspendue (amorçage) : même 404.
    await ownerRows(
      `UPDATE psp_configuration SET status = 'SUSPENDED' WHERE psp_configuration_id = $1`,
      [p().configs.ORANGE_MONEY],
    );
    const orange = signFakeNotification({
      provider: 'ORANGE_MONEY',
      secret: CANARY.current,
      event: refusedEvent,
    });
    signatureOf(orange.headers);
    keep(
      await c.w.raw(orange.rawBody.toString('utf8'), orange.headers, { method: 'ORANGE_MONEY' }),
    );
    await ownerRows(
      `UPDATE psp_configuration SET status = 'ACTIVE' WHERE psp_configuration_id = $1`,
      [p().configs.ORANGE_MONEY],
    );
    // Carte : succès, contestation ; travailleur d'interrogation.
    keep(
      await c.w.post(c.w.event(cardRow, { paymentId: cardRow.providerPaymentRef! }), {
        method: 'CARD',
      }),
    );
    keep(
      await c.w.post(
        fakeEvents.dispute({
          id: `evt-dp-${randomUUID()}`,
          merchantReference: cardRow.topupId,
          paymentId: cardRow.providerPaymentRef!,
          amount: Number(cardRow.amount),
          currency: cardRow.currency,
          disputeId: c.disputeId(),
          disputeAmount: 1000,
        }),
        { method: 'CARD' },
      ),
    );
    const pending = await p().topup();
    await ageTopup(pending.row.topupId);
    await poller.poller.runOnce();
    await poller.retry.runOnce();
  });

  it('contrôle du balayage : empreintes au journal, configurations en base, canaris dans le coffre', async () => {
    expect(refusedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(logs.text()).toContain(refusedHash);
    const [{ n }] = (await ownerRows<{ n: number }>(
      'SELECT count(*)::int AS n FROM psp_configuration WHERE secret_ref IS NOT NULL',
    )) as [{ n: number }];
    expect(n).toBeGreaterThanOrEqual(3);
    expect(await c.w.secretOf('WAVE')).toBe(CANARY.current);
    expect(signatures.length).toBeGreaterThanOrEqual(6);
    expect(responses.length).toBeGreaterThanOrEqual(15);
    expect(logs.lines.length).toBeGreaterThan(0);
  });

  it('aucun marqueur (secrets, signatures) ni corps refusé dans les réponses, les journaux, les tables', async () => {
    logs.restore();
    const secretMarkers = [CANARY.current, CANARY.previous, CANARY.adapter, CANARY.wrong].flatMap(
      forms,
    );
    const signatureMarkers = signatures.flatMap(forms);
    const bodyMarkers = forms(CANARY.refusedBody);
    const everywhere = [...secretMarkers, ...signatureMarkers];
    const text = (haystack: string, needles: string[]) =>
      needles.filter((n) => haystack.includes(n));
    expect(text(responses.join('\n'), [...everywhere, ...bodyMarkers])).toEqual([]);
    expect(text(logs.text(), [...everywhere, ...bodyMarkers])).toEqual([]);
    const tables = await ownerRows<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
    );
    expect(tables.length).toBeGreaterThan(40);
    const found: string[] = [];
    for (const { tablename } of tables) {
      // `psp_event.body` porte le corps d'une notification AUTHENTIFIÉE (par conception) : on n'y cherche que les
      // secrets et les signatures ; le corps REFUSÉ n'est cherché nulle part, y compris dans cette table.
      const needles = [...everywhere, ...bodyMarkers];
      const rows = await ownerRows<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${tablename}" x WHERE x::text LIKE ANY ($1::text[])`,
        [needles.map((n) => `%${n}%`)],
      );
      if (rows[0]!.n > 0) found.push(`${tablename} : ${rows[0]!.n}`);
    }
    expect(found).toEqual([]);
  });

  it('droit par colonne : secret_ref et psp_event.body illisibles sous cashless_app (42501)', async () => {
    const client = await connect(APP_URL);
    try {
      for (const sql of [
        'SELECT secret_ref FROM psp_configuration',
        'SELECT body FROM psp_event',
      ]) {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.operator_id', $1, true)`, [p().op]);
        await expect(client.query(sql)).rejects.toMatchObject({ code: '42501' });
        await client.query('ROLLBACK');
      }
    } finally {
      await client.end();
    }
  });
});
