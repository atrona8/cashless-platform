// T115 / SC-005, US7 : reprise forcée à deux personnes après la perte de la passerelle.
// Passerelle arrêtée (kill), `force: true` + `gateway_confirmed_offline: true`, approbation d'une
// SECONDE personne : passerelle révoquée, époque +1, bascule `FORCED`, en moins de 5 minutes une
// fois les deux personnes présentes. Aucune opération acquittée par un terminal n'est perdue : le
// journal du terminal renvoyé au central rend `DUPLICATE` pour les opérations déjà rejouées (sans
// anomalie), `EDGE_REPLAY_FAILED` (avec le montant) pour une référence inconnue, et `TOPUP_CASH` en
// anomalie `NON_COMPLIANT_OPERATION` avec le montant (décision 4). Refus d'une reprise forcée à une
// seule personne.
import 'reflect-metadata';
import { performance } from 'node:perf_hooks';
import { ProcessingWorld } from '../../../api/test/integration/offline/processing-fixtures';
import {
  calibrateDbClock,
  dbNow,
  onlineRef,
} from '../../../api/test/integration/edge/journal/journal-support';
import { withOwner } from '../../../api/test/support/db';
import { TwoProcessBench, until } from '../support/two-process-bench';
import { activateEdge, report } from '../support/load-support';

let bench: TwoProcessBench;
afterAll(async () => bench?.close());

const central = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => bench.centralQuery<T>(sql, params);

const LIMIT_MS = 5 * 60_000;

describe('SC-005 : reprise forcée', () => {
  it('perte de la passerelle : reprise à deux en moins de 5 minutes, rien de perdu', async () => {
    bench = await TwoProcessBench.start();
    const w = bench.world;
    const till = await w.terminal();
    const media = await w.media(2, 10_000_000);
    const body = () => w.catalogBody(till, { tap: w.tap(media[0]!) }, [[0, 1]]);

    // Premier cycle : la vente S1 est rejouée au central (sa clé y est inscrite).
    await activateEdge(bench, [media[0]!.walletId]);
    const s1 = till.t.seqKey();
    expect((await bench.gwPay(till, body(), { key: s1 })).status).toBe(201);
    await bench.releaseToCentral();
    await until(
      'premier rendu',
      async () =>
        (
          await central<{ status: string }>(
            `SELECT status FROM debit_authority_handover
              WHERE ledger_id = $1 AND direction = 'TO_CENTRAL' ORDER BY requested_at DESC LIMIT 1`,
            [bench.ledgerId],
          )
        )[0]?.status === 'COMPLETED',
      180_000,
      200,
    );
    // Second cycle : S2 est acquittée au terminal mais jamais vidée (la passerelle est perdue).
    await bench.refreshEpoch();
    await activateEdge(bench, [media[0]!.walletId]);
    const s2 = till.t.seqKey();
    expect((await bench.gwPay(till, body(), { key: s2 })).status).toBe(201);
    const epochBefore = bench.epoch;
    await bench.gateway!.kill('SIGKILL');

    const second = await withOwner((db) =>
      w.w.idp.createPerson(db, {
        operatorId: bench.operatorId,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: bench.operatorId }],
      }),
    );
    const forceBody = {
      target: 'CENTRAL',
      reason: 'Passerelle détruite',
      force: true,
      gateway_confirmed_offline: true,
    };
    // Sans confirmation « hors ligne » : refusé, rien de créé.
    const unconfirmed = await bench.human('POST', `/ledgers/${bench.ledgerId}/debit-authority`, {
      ...forceBody,
      gateway_confirmed_offline: false,
    });
    expect(unconfirmed.status).toBe(422);

    const asked = await bench.human(
      'POST',
      `/ledgers/${bench.ledgerId}/debit-authority`,
      forceBody,
    );
    expect(asked.status).toBe(202);
    const requestId = String(asked.body.approval_request_id);
    // Une seule personne ne suffit pas : l'auteur n'approuve pas sa propre demande.
    const self = await bench.human('POST', `/approval-requests/${requestId}/approve`, {});
    expect(self.status).toBeGreaterThanOrEqual(403);
    expect(self.status).toBeLessThan(500);
    expect(
      (
        await central<{ debit_authority: string }>(
          'SELECT debit_authority FROM ledger WHERE id = $1',
          [bench.ledgerId],
        )
      )[0]!.debit_authority,
    ).toBe('EDGE');

    const t0 = performance.now();
    const done = await bench.human('POST', `/approval-requests/${requestId}/approve`, {}, second);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'EXECUTED' });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(LIMIT_MS);
    const ledger = (
      await central<{ debit_authority: string; authority_epoch: string }>(
        'SELECT debit_authority, authority_epoch::text FROM ledger WHERE id = $1',
        [bench.ledgerId],
      )
    )[0]!;
    expect(ledger.debit_authority).toBe('CENTRAL');
    expect(Number(ledger.authority_epoch)).toBe(epochBefore + 1);
    expect(
      (
        await central<{ status: string }>('SELECT status FROM edge_gateway WHERE id = $1', [
          bench.gatewayId,
        ])
      )[0]!.status,
    ).toBe('REVOKED');
    const forced = await central<{ status: string }>(
      `SELECT status FROM debit_authority_handover WHERE ledger_id = $1 AND status = 'FORCED'`,
      [bench.ledgerId],
    );
    expect(forced.length).toBeGreaterThanOrEqual(1);
    report('SC-005 reprise forcée', { ms: Math.round(elapsed), limiteMs: LIMIT_MS });

    // Journal du terminal renvoyé : S1 (déjà rejouée) DUPLICATE, S2 (jamais vidée, référence
    // inconnue) anomalie EDGE_REPLAY_FAILED avec son montant, recharge espèces : refus + anomalie.
    await calibrateDbClock();
    const pw = new ProcessingWorld();
    pw.pw = w;
    const first = till.t.nextBatchSeq;
    expect(first).toBeLessThanOrEqual(1);
    const ops = [
      onlineRef('activateMedia', { amount: 1000 }),
      onlineRef('activateMedia', { amount: 4000 }),
      {
        type: 'TOPUP_CASH',
        occurred_at: new Date(dbNow() - 5_000).toISOString(),
        amount: 30_000,
        currency: 'XOF',
      },
    ];
    const batch = till.t.buildBatch(ops, {
      ledgerId: bench.ledgerId,
      epoch: epochBefore + 1,
      fromSeq: 1,
    });
    const res = await till.t.submitBatch(w.api.baseUrl, w.api.tls.serverCaPem, batch);
    const results = pw.results(res);
    expect(results[0]).toMatchObject({ status: 'DUPLICATE' });
    expect(results[1]).toMatchObject({ status: 'ACCEPTED', effect: 'NONE' });
    expect(results[2]).toMatchObject({ status: 'REJECTED', effect: 'NONE' });
    const anomalies = await central<{ kind: string; seq: string; amount: string }>(
      `SELECT kind, seq::text, amount::text FROM anomaly WHERE device_id = $1 ORDER BY seq`,
      [till.t.deviceId],
    );
    expect(anomalies.filter((a) => a.kind === 'EDGE_REPLAY_FAILED')).toEqual([
      expect.objectContaining({ seq: '2', amount: '4000' }),
    ]);
    expect(anomalies.filter((a) => a.kind === 'NON_COMPLIANT_OPERATION')).toEqual([
      expect.objectContaining({ seq: '3', amount: '30000' }),
    ]);
    // Le central débite de nouveau (les numéros 1 à 3 sont pris par le journal du terminal).
    till.t.seqKey();
    const back = await w.pay(till, w.catalogBody(till, { tap: w.tap(media[1]!) }, [[0, 1]]), {
      epoch: String(epochBefore + 1),
    });
    expect(back.status).toBe(201);

    // La vente S1 n'a ouvert aucune anomalie (DUPLICATE sans bruit).
    expect(anomalies.some((a) => a.seq === '1')).toBe(false);
    expect(s1).toBeTruthy();
    expect(s2).toBeTruthy();
  }, 900_000);
});
