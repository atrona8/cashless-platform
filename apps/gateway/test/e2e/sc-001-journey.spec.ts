// SC-001 / T113 : le parcours complet de `quickstart.md` § 6, en 17 étapes, avec DEUX processus
// (central et
// passerelle), DEUX bases et le relais coupable, sans autre intervention que les demandes
// d'administration.
// À la fin : soldes du central égaux à ceux de la passerelle, aucune anomalie inattendue.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  openCashSession,
  seedPersonalizedMedia,
  tapBody,
} from '../../../api/test/support/media-fixtures';
import { withOwner } from '../../../api/test/support/db';
import type {
  PayMedia,
  PayTerminal,
} from '../../../api/test/integration/payments/payments-fixtures';
import {
  anomalies,
  balanceDiff,
  centralBalances,
  chainsEqual,
  edgeSeqContinuity,
  localBalances,
} from '../support/sql-probes';
import { TwoProcessBench, until } from '../support/two-process-bench';

let bench: TwoProcessBench;
afterAll(async () => bench?.close());

const central = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => bench.centralQuery<T>(sql, params);
const local = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => bench.localQuery<T>(sql, params);

/** Échoue en montrant le corps de la réponse (un simple `toBe(201)` ne dit pas pourquoi). */
function must(res: { status: number; text: string }, ...statuses: number[]): void {
  if (!statuses.includes(res.status)) {
    throw new Error(
      `attendu ${statuses.join('|')}, reçu ${res.status} : ${res.text.slice(0, 400)}`,
    );
  }
}

describe('SC-001 : parcours de bout en bout', () => {
  let till: PayTerminal;
  let desk: PayTerminal;
  let media: PayMedia[];
  let deskSessionId = '';
  let freshMedia: Awaited<ReturnType<typeof seedPersonalizedMedia>>;
  const staff = () => ({ 'x-staff-authorization': `Bearer ${bench.world.w.cashierA.token}` });
  let deskSeq = 0;
  const deskKey = () => `${desk.t.serial}:${String((deskSeq += 1)).padStart(4, '0')}`;
  const deskRequest = (path: string, body: unknown, key = deskKey()) =>
    bench.gwRequest(
      desk,
      { method: 'POST', path, body, idempotencyKey: key },
      { ...staff(), 'x-authority-epoch': String(bench.epoch) },
    );

  it('1. inscription : passerelle ACTIVE, PRIMARY, démarrée', async () => {
    bench = await TwoProcessBench.start();
    const rows = await central('SELECT status, role FROM edge_gateway WHERE id = $1', [
      bench.gatewayId,
    ]);
    expect(rows[0]).toMatchObject({ status: 'ACTIVE', role: 'PRIMARY' });
    till = await bench.world.terminal();
    desk = await bench.world.terminal({ mode: 'TOPUP_DESK', session: false });
    media = await bench.world.media(2, 100_000);
  });

  it('2-3. session de caisse et session de vendeur ouvertes au central AVANT la bascule', async () => {
    const opened = await withOwner((db) =>
      openCashSession(db, {
        operatorId: bench.operatorId,
        deviceId: desk.t.deviceId,
        userId: bench.world.w.cashierA.userId,
      }),
    );
    deskSessionId = opened.sessionId;
    expect(till.sessionId).toBeTruthy();
    // Conditions de caution identiques pour tous les lots de l'événement : le flux ne porte pas le
    // lot d'un
    // bracelet, la passerelle ne sert la caution que si les conditions sont uniques (limite
    // assumée, DEPOSIT_TERMS).
    await withOwner((db) =>
      db.query(
        "UPDATE media_batch SET deposit_amount = 1000, deposit_mode = 'SEPARATE' WHERE event_id = $1",
        [bench.eventId],
      ),
    );
    const batch = bench.world.batchId;
    freshMedia = await withOwner((db) =>
      seedPersonalizedMedia(db, {
        operatorId: bench.operatorId,
        batchId: batch,
        kmsKeyRef: bench.world.w.keyRef.a,
        count: 2,
      }),
    );
  });

  it('3b. la session est ouverte nettement avant la bascule (usable_on_edge : opened_at < activated_at)', async () => {
    // `activated_at` est l'heure centrale de l'accusé arrondie à la seconde : une session ouverte
    // dans la même
    // seconde que la bascule ne serait pas « avant ». En recette, la caisse ouvre des heures avant
    // la coupure.
    await new Promise((r) => setTimeout(r, 3_000));
  });

  it('4-5. bascule (202, époque +1) puis accusé : handover ACTIVE, rien avant', async () => {
    const res = await bench.switchToEdge();
    expect(res.body).toMatchObject({ authority: 'EDGE', epoch: 1 });
    await bench.waitLocalState('ACTIVE', 60_000);
    const handovers = await central(
      'SELECT status AS state FROM debit_authority_handover WHERE ledger_id = $1 ORDER BY requested_at DESC LIMIT 1',
      [bench.ledgerId],
    );
    expect(handovers[0]!.state).toBe('ACTIVE');
    await until('sessions répliquées', async () =>
      (await local('SELECT 1 FROM edge_cash_session')).length > 0 ? true : null,
    );
  });

  it('6. vente : 409 DEBIT_AUTHORITY_EDGE au central, 201 sur la passerelle avec la même clé', async () => {
    const w = bench.world;
    const key = till.t.seqKey();
    const body = w.catalogBody(till, { tap: w.tap(media[0]!) }, [[0, 1]]);
    const refused = await w.pay(till, body, { key, epoch: String(bench.epoch) });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'DEBIT_AUTHORITY_EDGE', authority_epoch: 1 });
    expect(String(refused.body.edge_base_url)).toContain('https://');
    const sale = await bench.gwPay(till, body, { key });
    expect(sale.status).toBe(201);
  });

  it('7. guichet : activation avec caution en espèces, recharge espèces acceptées sur la session d’avant', async () => {
    const m = freshMedia[0]!;
    const at = () => new Date().toISOString();
    const activation = await deskRequest('/media/activations', {
      tap: tapBody(m, 1),
      channel: 'DESK',
      deposit_payment: { method: 'CASH' },
      occurred_at: at(),
    });
    must(activation, 200, 201);
    const topup = await deskRequest('/topups/cash', {
      amount: 7_000,
      currency: 'XOF',
      occurred_at: at(),
      tap: tapBody(m, 2),
    });
    must(topup, 200, 201);
  });

  const opCount = async (): Promise<number> =>
    Number((await local('SELECT count(*)::int AS n FROM edge_op'))[0]!.n);

  it('8. refus : caution sur solde, QR client (409 DEBIT_AUTHORITY_EDGE), restitution (rien d’écrit)', async () => {
    const w = bench.world;
    const before = await opCount();
    // Caution sur solde : activation SANS paiement en espèces de la caution.
    const fromBalance = await deskRequest('/media/activations', {
      tap: tapBody(freshMedia[1]!, 1),
      channel: 'DESK',
      occurred_at: new Date().toISOString(),
    });
    expect(fromBalance.status).toBe(409);
    expect(fromBalance.body).toMatchObject({ code: 'DEBIT_AUTHORITY_EDGE' });
    // Paiement par QR client sur la passerelle.
    const qr = await bench.gwPay(
      till,
      w.catalogBody(till, { customer_qr_token: 'q'.repeat(24) }, [[0, 1]]),
    );
    expect(qr.status).toBe(409);
    expect(qr.body).toMatchObject({ code: 'DEBIT_AUTHORITY_EDGE' });
    expect(await opCount()).toBe(before);
    // Restitution de caution. Passerelle : la route n'existe pas (rien d'écrit). Central : le bracelet
    // activé sur la passerelle n'y est pas encore connu (`422 MEDIA_NOT_ACTIVATED`, corps conforme au
    // contrat `DepositRequest`), rien n'est écrit non plus. Le `409 DEBIT_AUTHORITY_EDGE` d'une
    // restitution créditant un portefeuille (caution sur solde) n'est pas rejouable ici : la caution
    // sur solde est refusée dès l'activation (ci-dessus).
    const body = { tap: tapBody(freshMedia[0]!, 5), payment: { method: 'CASH' } };
    const onGateway = await deskRequest(`/media/${freshMedia[0]!.id}/deposit/refund`, body);
    expect(onGateway.status).toBeGreaterThanOrEqual(400);
    expect(onGateway.status).not.toBe(500);
    expect(await opCount()).toBe(before);
    const refund = await desk.t.request(
      bench.centralBaseUrl,
      bench.serverCa,
      {
        method: 'POST',
        path: `/media/${freshMedia[0]!.id}/deposit/refund`,
        body,
        idempotencyKey: desk.t.seqKey(),
      },
      { headers: { ...staff(), 'x-authority-epoch': String(bench.epoch) } },
    );
    must(refund, 409, 422);
    expect(refund.body).toMatchObject({ code: 'MEDIA_NOT_ACTIVATED' });
    const written = await central(
      "SELECT count(*)::int AS n FROM journal_transaction WHERE media_id = $1 AND type = 'DEPOSIT_REFUNDED'",
      [freshMedia[0]!.id],
    );
    expect(written[0]!.n).toBe(0);
  });

  it('9. suspension au central : appliquée sur la passerelle en moins de 5 s', async () => {
    const target = media[1]!.media.id;
    const started = Date.now();
    // Fonction du schéma (motif et auteur au journal des statuts), jamais un UPDATE direct.
    await central(
      "SELECT set_config('app.operator_id', $1, false), suspend_media($2, 'perdu', $3)",
      [bench.operatorId, target, bench.world.w.cashierA.userId],
    );
    await until(
      'blocage répliqué',
      async () =>
        (await local('SELECT status FROM edge_media WHERE media_id = $1', [target]))[0]?.status ===
        'SUSPENDED',
      5_000,
      100,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    const refused = await bench.gwPay(
      till,
      bench.world.catalogBody(till, { tap: bench.world.tap(media[1]!) }, [[0, 1]]),
    );
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });

  it('10-11. coupure du relais : la passerelle sert encore, puis retour CATCHING_UP puis ACTIVE', async () => {
    bench.relay.pause();
    const sale = await bench.gwPay(
      till,
      bench.world.catalogBody(till, { tap: bench.world.tap(media[0]!) }, [[0, 1]]),
    );
    expect(sale.status).toBe(201);
    await until(
      'état local ISOLATED',
      async () => (await bench.localAuthority())?.link_state === 'ISOLATED',
      120_000,
      500,
    );
    bench.relay.resume();
    const seen: string[] = [];
    await until(
      'retour du lien',
      async () => {
        const row = await bench.localAuthority();
        seen.push(String(row?.link_state));
        return row?.link_state === 'CONNECTED' && row?.state === 'ACTIVE';
      },
      120_000,
      200,
    );
    // Réplication sans trou : le curseur de la passerelle rejoint celui du central.
    const centralLast = await central('SELECT max(id)::text AS w FROM posting');
    expect(
      BigInt(String((await bench.localAuthority())?.watermark_posting_id)),
    ).toBeLessThanOrEqual(BigInt(String(centralLast[0]!.w)));
  });

  it('12-14. rendu : RELEASING (409 DEBIT_AUTHORITY_MOVING), vidage, reprise, handover COMPLETED', async () => {
    const before = await opCount();
    await bench.releaseToCentral();
    await bench.waitLocalState('RELEASING', 60_000).catch(() => undefined);
    await until(
      'rendu terminé',
      async () =>
        (
          await central(
            'SELECT status FROM debit_authority_handover WHERE ledger_id = $1 AND direction = $2 ORDER BY requested_at DESC LIMIT 1',
            [bench.ledgerId, 'TO_CENTRAL'],
          )
        )[0]?.status === 'COMPLETED',
      120_000,
      300,
    );
    const cont = await edgeSeqContinuity(central, bench.gatewayId);
    expect(cont).toMatchObject({ gaps: [], duplicates: 0 });
    expect(cont.max).toBe(await opCount());
    expect(await opCount()).toBeGreaterThanOrEqual(before);
    const chains = await chainsEqual(central, local, bench.gatewayId);
    expect(chains.equal).toBe(true);
    // Le central débite de nouveau : la vente repart au central.
    const w = bench.world;
    const back = await w.pay(till, w.catalogBody(till, { tap: w.tap(media[0]!) }, [[0, 1]]), {
      epoch: '2',
    });
    expect(back.status).toBe(201);
  });

  /** Dernier rendu au central : `COMPLETED`, avec son nombre d'opérations. */
  const lastRelease = async () =>
    (
      await central<{ status: string; ops_count: string; final_edge_seq: string; at: string }>(
        `SELECT r.status, r.ops_count::text, r.final_edge_seq::text, t.edge_seq_at_activation::text AS at
           FROM debit_authority_handover r
           LEFT JOIN debit_authority_handover t ON t.id = r.edge_handover_id
          WHERE r.ledger_id = $1 AND r.direction = 'TO_CENTRAL'
          ORDER BY r.requested_at DESC LIMIT 1`,
        [bench.ledgerId],
      )
    )[0];

  it('15. fermeture de caisse au central : le comptage inclut les espèces de la coupure', async () => {
    // Espèces prises sur la passerelle pendant la coupure : caution 1 000 + recharge 7 000.
    const count = await desk.t.request(
      bench.centralBaseUrl,
      bench.serverCa,
      {
        method: 'POST',
        path: `/cash-sessions/${deskSessionId}/counts`,
        body: { counted_amount: 8_000, counted_at: new Date().toISOString() },
        idempotencyKey: desk.t.seqKey(),
      },
      { headers: staff() },
    );
    must(count, 200, 201);
    const closed = await bench.human(
      'POST',
      `/cash-sessions/${deskSessionId}/close`,
      {},
      bench.world.w.supervisorA,
    );
    must(closed, 200);
    expect(closed.body).toMatchObject({
      status: 'CLOSED',
      expected_amount: 8_000,
      counted_amount: 8_000,
      difference: 0,
    });
  });

  it('16. deuxième cycle sur la même passerelle : opérations_count = final_edge_seq - activation', async () => {
    const first = await lastRelease();
    // Nouvelle session de caisse, ouverte nettement avant la bascule (voir 3b).
    const opened = await withOwner((db) =>
      openCashSession(db, {
        operatorId: bench.operatorId,
        deviceId: desk.t.deviceId,
        userId: bench.world.w.cashierA.userId,
      }),
    );
    deskSessionId = opened.sessionId;
    await new Promise((r) => setTimeout(r, 3_000));
    const res = await bench.switchToEdge('Deuxième coupure');
    expect(res.body).toMatchObject({ authority: 'EDGE', epoch: 3 });
    await until(
      'second accusé',
      async () => {
        const row = await bench.localAuthority();
        return row?.state === 'ACTIVE' && Number(row.epoch) === 3 ? row : null;
      },
      60_000,
      100,
    );
    await bench.refreshEpoch();
    await until('sessions répliquées', async () =>
      (await local('SELECT 1 FROM edge_cash_session WHERE cash_session_id = $1', [deskSessionId]))
        .length > 0
        ? true
        : null,
    );
    const w = bench.world;
    const sale = await bench.gwPay(till, w.catalogBody(till, { tap: w.tap(media[0]!) }, [[0, 1]]));
    expect(sale.status).toBe(201);
    const topup = await deskRequest('/topups/cash', {
      amount: 2_000,
      currency: 'XOF',
      occurred_at: new Date().toISOString(),
      tap: tapBody(freshMedia[0]!, 10),
    });
    must(topup, 200, 201);
    await bench.releaseToCentral('Fin de la deuxième coupure');
    await until(
      'second rendu terminé',
      async () => {
        const r = await lastRelease();
        return r !== undefined && r.status === 'COMPLETED' && r.ops_count !== first?.ops_count
          ? r
          : null;
      },
      120_000,
      300,
    );
    const second = (await lastRelease())!;
    expect(Number(second.ops_count)).toBe(Number(second.final_edge_seq) - Number(second.at));
    expect(Number(second.ops_count)).toBe(2);
    const cont = await edgeSeqContinuity(central, bench.gatewayId);
    expect(cont).toMatchObject({ gaps: [], duplicates: 0 });
    expect((await chainsEqual(central, local, bench.gatewayId)).equal).toBe(true);
  });

  it('17. purge à deux responsables, puis soldes du central = soldes de la passerelle, aucune anomalie', async () => {
    // Soldes comparés AVANT la purge : la passerelle détruit ensuite ses données.
    const wallets = [...(await centralBalances(central, bench.ledgerId)).keys()];
    await until('soldes égaux', async () => {
      const diff = balanceDiff(
        await centralBalances(central, bench.ledgerId),
        await localBalances(local),
        wallets,
      );
      return diff.length === 0 ? true : null;
    });
    expect(await anomalies(central)).toEqual([]);
    const refused = await bench.localOrder('PURGE', { signers: [0] });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const purged = await bench.localOrder('PURGE');
    expect(purged.status).toBeLessThan(300);
    expect(purged.body).toMatchObject({ code: 'ACCEPTED', kind: 'PURGE' });
    // Le marqueur de purge est posé : la passerelle refuse de redémarrer sur ces données.
    await until(
      'marqueur de purge',
      () => existsSync(join(bench.dir, 'purge.marker')),
      60_000,
      200,
    );
  });
});
