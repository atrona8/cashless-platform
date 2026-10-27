// Annulation par un SUPERVISOR au terminal, jeton d'approbation sur place d'appelant terminal (mission 5b, lot WP12,
// T056, T057 et T059 ; FR-017 ; décision du porteur DM-01M5HRNBX5CTP7CAKN4JRCY3F9 ; NFR-003). Chaque ligne du
// tableau des refus de `onsite.spec.ts` est REJOUÉE sur la variante : rien n'est relâché. Un jeton refusé ne laisse
// ni annulation ni consommation, et le numéro du terminal est enregistré avec le refus.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FakeIdp, type TestPerson } from '../../support/fake-idp';
import { commitWhileWaiting, withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import { ReversalWorld, type Sale } from './reversal-fixtures';

jest.setTimeout(300_000);

describe('reversePayment : le SUPERVISOR au terminal (WP12)', () => {
  let rw: ReversalWorld;
  let otherIdp: FakeIdp;
  let supervisor: TestPerson;
  let supervisorOtherEvent: TestPerson;
  let supervisorOtherOperator: TestPerson;
  let cashier: TestPerson;
  let disabled: TestPerson;
  let otherEvent: Awaited<ReturnType<ReversalWorld['otherEvent']>>;

  beforeAll(async () => {
    rw = await ReversalWorld.create();
    otherIdp = await FakeIdp.create();
    otherEvent = await rw.otherEvent();
    supervisor = await rw.supervisor();
    supervisorOtherEvent = await rw.supervisor({
      scope: { type: 'EVENT', id: otherEvent.eventId },
    });
    supervisorOtherOperator = await rw.supervisor({
      operatorId: rw.pw.w.ops.b,
      scope: { type: 'ORGANIZER', id: rw.pw.w.ids.organizerB },
    });
    cashier = await rw.person('CASHIER');
    disabled = await rw.person('SUPERVISOR', { status: 'DISABLED' });
  });
  afterAll(async () => {
    await rw?.close();
  });

  const terminal = () => rw.pw.terminal({ mode: 'KEYPAD_TPE' });
  const code = (res: { status: number; body: Record<string, unknown> }) => [
    res.status,
    res.body.code,
  ];
  const consumed = (jti: string) => rw.tokenUses(jti);

  /** Vente d'un terminal, puis le vendeur de la session change : le vendeur de la session n'est plus celui de la vente. */
  const saleOfAnotherVendor = async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    await withOwner((db) =>
      db.query(
        `UPDATE vendor_session SET closed_at = now(), closed_reason = 'LOGOUT' WHERE id = $1`,
        [term.sessionId],
      ),
    );
    await rw.pw.openSession(term, await rw.otherVendor());
    return { term, sale };
  };

  it('sans jeton : mode vendeur (un autre vendeur est refusé, rien n’est levé)', async () => {
    const { term, sale } = await saleOfAnotherVendor();
    expect(code(await rw.reverse(term, sale.id))).toEqual([422, 'REVERSAL_NOT_ALLOWED']);
  });

  it('FR-017 : hors fenêtre et pour un autre vendeur → 201 ; valideur = SUPERVISOR, attribué à lui et à la session ; jeton consommé une fois', async () => {
    const { term, sale } = await saleOfAnotherVendor();
    await rw.ageSale(sale.id, 120);
    const jti = randomUUID();
    const { res } = await rw.reverseWithToken(term, sale.id, supervisor, { jti });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'REVERSAL', reverses_id: sale.id, amount: 4000 });
    const reversalId = String(res.body.transaction_id);
    expect(await rw.reversalsOf(sale.id)).toEqual([
      { id: reversalId, source: 'ONLINE', type: 'REVERSAL', approved_by: supervisor.userId },
    ]);
    expect(
      await ownerRows(
        'SELECT vendor_session_id, device_id, actor_user_id FROM sale_attribution WHERE transaction_id = $1',
        [reversalId],
      ),
    ).toEqual([
      {
        vendor_session_id: term.sessionId,
        device_id: term.t.deviceId,
        actor_user_id: supervisor.userId,
      },
    ]);
    expect(await consumed(jti)).toEqual([
      { jti, caller_device_id: term.t.deviceId, target_id: sale.id },
    ]);
    expect(await rw.pw.spendable(sale.media.walletId)).toBe(20_000);
  });

  it('terminal d’un autre événement : refusé même avec un jeton valide (rien consommé)', async () => {
    const sale = await rw.sell(await terminal());
    const jti = randomUUID();
    const { res } = await rw.reverseWithToken(otherEvent.terminal, sale.id, supervisor, { jti });
    expect(code(res)).toEqual([422, 'REVERSAL_NOT_ALLOWED']);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
    expect(await consumed(jti)).toEqual([]);
  });

  it('SUPERVISOR de l’événement du TERMINAL mais pas de celui de la VENTE : 403 APPROVAL_INVALID (portée = la vente)', async () => {
    const sale = await rw.sell(await terminal());
    const jti = randomUUID();
    const { res } = await rw.reverseWithToken(otherEvent.terminal, sale.id, supervisorOtherEvent, {
      jti,
    });
    expect(code(res)).toEqual([403, 'APPROVAL_INVALID']);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
    expect(await consumed(jti)).toEqual([]);
  });

  type Case = [
    label: string,
    make: (
      sale: Sale,
      other: Sale,
    ) => {
      who?: TestPerson;
      act?: string;
      hashed?: (body: Record<string, unknown>) => unknown;
      ttl?: number;
      path?: string;
    },
  ];
  const refusals: Case[] = [
    ['autre act', () => ({ act: 'releaseMedia' })],
    ['corps modifié (act_hash)', () => ({ hashed: (b) => ({ ...b, comment: 'autre' }) })],
    [
      'vendor_session_id d’un autre corps (act_hash)',
      () => ({ hashed: (b) => ({ ...b, vendor_session_id: randomUUID() }) }),
    ],
    ['expiré', () => ({ ttl: -60 })],
    ['sujet sans le rôle SUPERVISOR', () => ({ who: cashier })],
    ['sujet d’un autre prestataire', () => ({ who: supervisorOtherOperator })],
    ['sujet désactivé', () => ({ who: disabled })],
    ['SUPERVISOR d’un autre événement', () => ({ who: supervisorOtherEvent })],
  ];

  it.each(refusals)(
    'jeton %s : 403 APPROVAL_INVALID, aucune annulation ni consommation, numéro rangé',
    async (_label, make) => {
      const term = await terminal();
      const sale = await rw.sell(term);
      const other = await rw.sell(term);
      const opts = make(sale, other);
      const jti = randomUUID();
      const key = term.t.seqKey();
      const body = rw.reversalBody(term);
      const token = await rw.token(opts.who ?? supervisor, sale.id, body, {
        jti,
        act: opts.act,
        ttlSeconds: opts.ttl,
        hashedBody: opts.hashed?.(body),
      });
      const res = await term.t.request(
        rw.pw.api.baseUrl,
        rw.pw.api.tls.serverCaPem,
        {
          method: 'POST',
          path: `/payments/${sale.id}/reversal`,
          body,
          idempotencyKey: key,
        },
        { headers: { 'x-authority-epoch': '0', 'x-approval-token': token } },
      );
      expect(code(res)).toEqual([403, 'APPROVAL_INVALID']);
      expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
      expect(await consumed(jti)).toEqual([]);
      const seq = String(Number(key.split(':')[1]));
      expect((await rw.pw.registry(term.t.deviceId)).find((r) => r.seq === seq)).toMatchObject({
        outcome: 'REJECTED',
        reason: 'APPROVAL_INVALID',
      });
    },
  );

  it('jeton d’une AUTRE vente (act_hash) → 403 APPROVAL_INVALID', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const other = await rw.sell(term);
    const body = rw.reversalBody(term);
    const token = await rw.token(supervisor, other.id, body);
    const res = await term.t.request(
      rw.pw.api.baseUrl,
      rw.pw.api.tls.serverCaPem,
      {
        method: 'POST',
        path: `/payments/${sale.id}/reversal`,
        body,
        idempotencyKey: term.t.seqKey(),
      },
      { headers: { 'x-authority-epoch': '0', 'x-approval-token': token } },
    );
    expect(code(res)).toEqual([403, 'APPROVAL_INVALID']);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
  });

  it('jeton signé par une autre clé, jeton d’accès (autre audience), sujet inconnu → 403 APPROVAL_INVALID', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const body = rw.reversalBody(term);
    const hash = await rw.token(supervisor, sale.id, body); // seulement pour la forme du chemin
    expect(hash).toBeTruthy();
    const tokens = [
      await otherIdp.approvalToken({
        subject: supervisor.subject,
        act: 'reversePayment',
        actHash: (await import('../../../src/approval/onsite/act-hash')).actHash(
          'POST',
          `/v1/payments/${sale.id}/reversal`,
          body,
        ),
      }),
      await rw.pw.w.idp.accessToken(supervisor.subject),
      await rw.token({ ...supervisor, subject: `inconnu-${randomUUID()}` }, sale.id, body),
    ];
    for (const token of tokens) {
      const res = await term.t.request(
        rw.pw.api.baseUrl,
        rw.pw.api.tls.serverCaPem,
        {
          method: 'POST',
          path: `/payments/${sale.id}/reversal`,
          body,
          idempotencyKey: term.t.seqKey(),
        },
        { headers: { 'x-authority-epoch': '0', 'x-approval-token': token } },
      );
      expect(code(res)).toEqual([403, 'APPROVAL_INVALID']);
    }
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
  });

  it('vente introuvable avec un jeton : 404, jamais une portée vide', async () => {
    const term = await terminal();
    const { res } = await rw.reverseWithToken(term, randomUUID(), supervisor);
    expect(code(res)).toEqual([404, 'NOT_FOUND']);
  });

  it('jeton rejoué avec une autre clé d’idempotence : 403 APPROVAL_INVALID, une seule annulation', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const other = await rw.sell(term);
    const jti = randomUUID();
    const first = await rw.reverseWithToken(term, sale.id, supervisor, { jti });
    expect(first.res.status).toBe(201);
    // Même jeton, même requête (même corps), autre clé : consommation refusée.
    const token = await rw.token(supervisor, sale.id, first.body, { jti });
    const replay = await term.t.request(
      rw.pw.api.baseUrl,
      rw.pw.api.tls.serverCaPem,
      {
        method: 'POST',
        path: `/payments/${sale.id}/reversal`,
        body: first.body,
        idempotencyKey: term.t.seqKey(),
      },
      { headers: { 'x-authority-epoch': '0', 'x-approval-token': token } },
    );
    expect(code(replay)).toEqual([403, 'APPROVAL_INVALID']);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(1);
    expect(await consumed(jti)).toHaveLength(1);
    expect(await rw.reversalsOf(other.id)).toHaveLength(0);
  });

  it('NFR-003 : deux requêtes simultanées avec le même jeton → une seule annulation', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const jti = randomUUID();
    const body = rw.reversalBody(term);
    const token = await rw.token(supervisor, sale.id, body, { jti });
    const send = () =>
      term.t.request(
        rw.pw.api.baseUrl,
        rw.pw.api.tls.serverCaPem,
        {
          method: 'POST',
          path: `/payments/${sale.id}/reversal`,
          body,
          idempotencyKey: term.t.seqKey(),
        },
        { headers: { 'x-authority-epoch': '0', 'x-approval-token': token } },
      );
    const results = await Promise.all([send(), send(), send()]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(1);
    expect(await consumed(jti)).toHaveLength(1);
  });

  it('jeton consommé dans la transaction métier : seconde annulation (déjà annulée) → 409, jeton NON consommé', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    expect((await rw.reverse(term, sale.id)).status).toBe(201);
    const jti = randomUUID();
    const { res } = await rw.reverseWithToken(term, sale.id, supervisor, { jti });
    expect(code(res)).toEqual([409, 'ALREADY_REVERSED']);
    expect(await consumed(jti)).toEqual([]);
  });

  it('un SUPERVISOR n’affranchit ni le terminal ni la session : session fermée → 409, jeton non consommé', async () => {
    const term = await terminal();
    const sale = await rw.sell(term);
    const jti = randomUUID();
    const { res } = await commitWhileWaiting(
      {
        sql: `UPDATE vendor_session SET closed_at = now(), closed_reason = 'LOGOUT' WHERE id = $1`,
        params: [term.sessionId],
      },
      { role: 'cashless_app', statement: 'assert_vendor_session' },
      () => rw.reverseWithToken(term, sale.id, supervisor, { jti }),
    );
    expect(code(res)).toEqual([409, 'VENDOR_SESSION_INVALID']);
    expect(await consumed(jti)).toEqual([]);
    expect(await rw.reversalsOf(sale.id)).toHaveLength(0);
  });
});
