// Intégration (mission 9a, WP04 ; FR-006, FR-007, NFR-004) : `listMyRefundRequests` et `listRefundRequests`.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import type { MediaWorld } from '../../support/media-fixtures';
import type { TestPerson } from '../../support/fake-idp';
import { createRefundWorld, fundedCustomer, type RefundWorld } from './create-fixtures';
import { createHolder, insertRequest, type Holder } from './holder-fixtures';

describe('listes des demandes de remboursement', () => {
  let r: RefundWorld;
  let w: MediaWorld;
  let otherOrganizerAdmin: TestPerson; // ORGANIZER_ADMIN d'un autre organisateur du même prestataire
  let operatorAdminB: TestPerson;
  let a: Holder;
  let b: Holder;

  const mine = (who: { headers: Record<string, string> }, query = '') =>
    request(r.app.getHttpServer()).get(`/v1/me/refund-requests${query}`).set(who.headers);
  const bo = (who: TestPerson | null, query = '') => {
    const req = request(r.app.getHttpServer()).get(`/v1/refund-requests${query}`);
    return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
  };

  beforeAll(async () => {
    r = await createRefundWorld();
    w = r.w;
    await withOwner(async (db) => {
      const org = randomUUID();
      await db.query(
        "INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'ORGANIZER', $2, 'Autre organisateur', 'SN')",
        [org, w.ops.a],
      );
      otherOrganizerAdmin = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: org }],
      });
      operatorAdminB = await w.idp.createPerson(db, {
        operatorId: w.ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b }],
      });
      a = await createHolder(db, w);
      b = await createHolder(db, w);
      // Demandes de A : 5 portefeuilles, REQUESTED ; une de B.
      for (let i = 0; i < 5; i += 1) await insertRequest(db, w, a, { status: 'REQUESTED' });
      await insertRequest(db, w, a, { status: 'AWAITING_HOLDER' });
      await insertRequest(db, w, b, { status: 'REQUESTED' });
    });
  });
  afterAll(async () => {
    await r.app.close();
  });

  const asCustomer = (h: Holder) => ({
    headers: {
      'x-test-customer-id': h.customerId,
      'x-test-operator-id': w.ops.a,
      'x-test-customer-device': 'dev-list',
    },
  });

  it('FR-006 : le festivalier ne voit que ses demandes, conformes au contrat', async () => {
    const res = await mine(asCustomer(a), '?limit=200');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(6);
    expect(res.body.has_more).toBe(false);
    for (const item of res.body.data) {
      expect(contractViolations('RefundRequest', item)).toEqual([]);
      for (const secret of ['requested_by', 'confirmed_by', 'operator_id', 'iban'])
        expect(item).not.toHaveProperty(secret);
    }
    const other = await mine(asCustomer(b));
    expect(other.body.data).toHaveLength(1);
    expect(
      other.body.data.some((x: { wallet_id: string }) =>
        res.body.data.some((y: { wallet_id: string }) => y.wallet_id === x.wallet_id),
      ),
    ).toBe(false);
    expect((await request(r.app.getHttpServer()).get('/v1/me/refund-requests')).status).toBe(401);
  });

  it('FR-006 : pagination sur 3 pages, sans doublon ni trou, plus récentes d’abord', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await mine(
        asCustomer(a),
        `?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(res.status).toBe(200);
      expect(typeof res.body.has_more).toBe('boolean');
      seen.push(...res.body.data.map((x: { refund_request_id: string }) => x.refund_request_id));
      cursor = res.body.next_cursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(6);
    const all = await mine(asCustomer(a), '?limit=200');
    expect(seen).toEqual(
      all.body.data.map((x: { refund_request_id: string }) => x.refund_request_id),
    );
    const times = all.body.data.map((x: { created_at: string }) => Date.parse(x.created_at));
    expect([...times].sort((p, q) => q - p)).toEqual(times);
    expect((await mine(asCustomer(a), '?limit=0')).status).toBe(400);
    expect((await mine(asCustomer(a), '?cursor=xx')).status).toBe(400);
  });

  it('FR-007 : le back-office du prestataire voit les demandes, filtrées par statut et événement', async () => {
    const res = await bo(w.operatorAdminA, '?limit=200');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(7);
    const open = await bo(w.operatorAdminA, '?status=AWAITING_HOLDER&limit=200');
    expect(open.body.data.every((x: { status: string }) => x.status === 'AWAITING_HOLDER')).toBe(
      true,
    );
    expect(open.body.data).toHaveLength(1);
    const ev = await bo(w.operatorAdminA, `?event_id=${w.ids.eventA}&limit=200`);
    expect(ev.body.data).toHaveLength(res.body.data.length);
    const none = await bo(w.operatorAdminA, `?event_id=${randomUUID()}`);
    expect(none.body.data).toEqual([]);
    expect((await bo(w.operatorAdminA, '?status=PAYE')).status).toBe(400);
    expect((await bo(w.operatorAdminA, '?event_id=zzz')).status).toBe(400);
    // Organisateur de l'événement : voit ; pages de 2 sans doublon.
    const org = await bo(w.organizerAdminA, '?limit=200');
    expect(org.body.data).toHaveLength(res.body.data.length);
    const p1 = await bo(w.operatorAdminA, '?limit=3');
    const p2 = await bo(w.operatorAdminA, `?limit=3&cursor=${p1.body.next_cursor}`);
    const ids = [...p1.body.data, ...p2.body.data].map(
      (x: { refund_request_id: string }) => x.refund_request_id,
    );
    expect(new Set(ids).size).toBe(6);
  });

  it('FR-007 : isolation (autre prestataire, autre organisateur) ; CASHIER 403 ; sans jeton 401', async () => {
    const otherOperator = await bo(operatorAdminB, '?limit=200');
    expect(otherOperator.status).toBe(200);
    expect(otherOperator.body.data).toEqual([]);
    const otherOrg = await bo(otherOrganizerAdmin, '?limit=200');
    expect(otherOrg.status).toBe(200);
    expect(otherOrg.body.data).toEqual([]);
    expect((await bo(w.cashierA)).status).toBe(403);
    expect((await bo(null)).status).toBe(401);
  });

  it('une création réelle apparaît dans les deux listes', async () => {
    const c = await fundedCustomer(w);
    const created = await request(r.app.getHttpServer())
      .post('/v1/me/refund-requests')
      .set(c.customer.headers)
      .set('Idempotency-Key', randomUUID())
      .send({ wallet_id: c.walletId, destination: { method: 'WAVE' } });
    expect(created.status).toBe(201);
    const id = created.body.refund_request_id;
    const list = await mine(c.customer);
    expect(list.body.data.map((x: { refund_request_id: string }) => x.refund_request_id)).toEqual([
      id,
    ]);
    const all = await bo(w.operatorAdminA, '?status=REQUESTED&limit=200');
    expect(
      all.body.data.some((x: { refund_request_id: string }) => x.refund_request_id === id),
    ).toBe(true);
  });
});
