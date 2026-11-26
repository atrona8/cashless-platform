// Ventes du back-office `listEventSales` / `getSale` (mission routes-backoffice 11b, WP06 ; FR-005 à FR-007,
// NFR-003, NFR-006). Jeu de la recette : 120 ventes, 2 points de vente, 2 commerçants, 2 vendeurs, 1 annulée.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, type MediaWorld } from '../../support/media-fixtures';
import { seedSales, type SalesFixture } from './sales-seed';

describe('ventes du back-office', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let fx: SalesFixture;
  let unattributedId: string;
  let merchantAdmin0: TestPerson;
  let merchantAdmin1: TestPerson;
  let otherOrganizerAdmin: TestPerson; // même prestataire, autre organisateur
  let otherOperatorAdmin: TestPerson; // autre prestataire
  let outsider: TestPerson; // MERCHANT_ADMIN d'un commerçant qui ne participe pas

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      fx = await seedSales(db, w, { count: 120, rich: true });
      // Vente sans attribution (canal inconnu) : copie d'une vente du jeu, sans ligne `sale_attribution`.
      unattributedId = randomUUID();
      await db.query('BEGIN');
      await db.query('SET LOCAL session_replication_role = replica');
      await db.query(
        `INSERT INTO journal_transaction (id, operator_id, ledger_id, event_id, type, idempotency_key,
                request_hash, occurred_at, recorded_at, source, device_id)
         SELECT $1::uuid, operator_id, ledger_id, event_id, type, 'unattr:' || $1::text, 'h', occurred_at,
                now(), source, device_id FROM journal_transaction WHERE id = $2`,
        [unattributedId, fx.sales[4]],
      );
      await db.query(
        `INSERT INTO posting (operator_id, ledger_id, transaction_id, line_no, account_id, amount)
         SELECT operator_id, ledger_id, $1::uuid, line_no, account_id, amount FROM posting WHERE transaction_id = $2`,
        [unattributedId, fx.sales[4]],
      );
      await db.query('COMMIT');
      const org2 = randomUUID();
      const lonely = randomUUID();
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name) VALUES
           ($1, 'ORGANIZER', $3, 'Organisateur 2'), ($2, 'MERCHANT', $3, 'Commerçant isolé')`,
        [org2, lonely, w.ops.a],
      );
      const person = (
        operatorId: string,
        roles: Parameters<typeof w.idp.createPerson>[1]['roles'],
      ) => w.idp.createPerson(db, { operatorId, roles });
      merchantAdmin0 = await person(w.ops.a, [
        { role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: fx.merchants[0] },
      ]);
      merchantAdmin1 = await person(w.ops.a, [
        { role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: fx.merchants[1] },
      ]);
      otherOrganizerAdmin = await person(w.ops.a, [
        { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: org2 },
      ]);
      otherOperatorAdmin = await person(w.ops.b, [
        { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.b },
      ]);
      outsider = await person(w.ops.a, [
        { role: 'MERCHANT_ADMIN', scopeType: 'MERCHANT', scopeId: lonely },
      ]);
    });
    app = await createTestApp({ identity: w.idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const list = (person: TestPerson, query = '', event = fx.eventId) =>
    request(app.getHttpServer())
      .get(`/v1/events/${event}/sales${query}`)
      .set('Authorization', `Bearer ${person.token}`);
  const detail = (person: TestPerson, id: string) =>
    request(app.getHttpServer())
      .get(`/v1/sales/${id}`)
      .set('Authorization', `Bearer ${person.token}`);
  const all = async (person: TestPerson, query = '') => {
    const res = await list(person, `?limit=200${query}`);
    expect(res.status).toBe(200);
    return res.body.data as Array<Record<string, unknown>>;
  };

  it('l’administrateur du prestataire voit les 120 ventes, conformes au contrat, de la plus récente', async () => {
    const res = await list(w.operatorAdminA, '?limit=200');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(120);
    expect(res.body.has_more).toBe(false);
    expect(res.body.next_cursor).toBeNull();
    expect(contractViolations('SalePage', res.body)).toEqual([]);
    const times = res.body.data.map((s: { occurred_at: string }) => s.occurred_at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it.each([
    ['organisateur', () => w.organizerAdminA],
    ['superviseur de l’organisateur', () => w.supervisorA],
  ])('%s : même vue complète', async (_n, who) => {
    expect(await all(who())).toHaveLength(120);
  });

  it('chaque filtre rend le bon sous-ensemble', async () => {
    expect(await all(w.operatorAdminA, `&pos_id=${fx.pos[0]}`)).toHaveLength(fx.byMerchant[0]);
    expect(await all(w.operatorAdminA, `&pos_id=${fx.pos[1]}`)).toHaveLength(fx.byMerchant[1]);
    expect(await all(w.operatorAdminA, `&merchant_id=${fx.merchants[0]}`)).toHaveLength(
      fx.byMerchant[0],
    );
    const v0 = await all(w.operatorAdminA, `&vendor_id=${fx.vendors[0]}`);
    const v1 = await all(w.operatorAdminA, `&vendor_id=${fx.vendors[1]}`);
    expect(v0.length + v1.length).toBe(120);
    expect(v0.every((s) => s.vendor_id === fx.vendors[0])).toBe(true);
    expect(await all(w.operatorAdminA, '&status=REVERSED')).toHaveLength(1);
    expect(await all(w.operatorAdminA, '&status=VALID')).toHaveLength(119);
    const everything = await all(w.operatorAdminA);
    const times = everything.map((s) => s.occurred_at as string).sort();
    const mid = times[60]!;
    const before = await all(w.operatorAdminA, `&to=${encodeURIComponent(mid)}`);
    const after = await all(w.operatorAdminA, `&from=${encodeURIComponent(mid)}`);
    expect(before.length + after.length).toBe(120); // `to` exclu, `from` inclus
    expect(before.every((s) => (s.occurred_at as string) < mid)).toBe(true);
    expect(after.every((s) => (s.occurred_at as string) >= mid)).toBe(true);
  });

  it('valeur de filtre mal formée : 422', async () => {
    for (const q of [
      'pos_id=x',
      'merchant_id=1',
      'vendor_id=%25',
      'from=hier',
      'to=2026-13-45T00:00:00Z',
      'from=2026-02-30T00:00:00Z', // jour inexistant : JS le décalerait au 1er mars
      'to=2026-04-31T00:00:00Z',
      'from=2025-02-29T10:00:00%2B02:00',
      'status=AUTRE',
      'limit=0',
      'limit=201',
      'limit=abc',
      'cursor=%25%25',
    ]) {
      const res = await list(w.operatorAdminA, `?${q}`);
      expect([q, res.status]).toEqual([q, 422]);
      expect(res.body.code ?? res.body.type).toBeDefined();
    }
  });

  it('vente sans attribution (canal nul) : absente de la liste, et la page reste conforme', async () => {
    const rows = await all(w.operatorAdminA);
    expect(rows).toHaveLength(120);
    expect(rows.map((r) => r.transaction_id)).not.toContain(unattributedId);
    expect(rows.every((r) => typeof r.channel === 'string')).toBe(true);
    // Décision du porteur (25/11) : le détail d'une telle vente rend 404, comme une vente absente (aucune fuite
    // d'existence) ; `SaleDetail.channel` n'est jamais nul.
    const one = await detail(w.operatorAdminA, unattributedId);
    const absent = await detail(w.operatorAdminA, randomUUID());
    expect(one.status).toBe(404);
    expect({ ...one.body, instance: null }).toEqual({ ...absent.body, instance: null });
  });

  it('vente annulée : REVERSED et contre-passation ; vente hors ligne : occurred_at d’origine', async () => {
    const reversed = await detail(w.operatorAdminA, fx.reversedId);
    expect(reversed.status).toBe(200);
    expect(reversed.body.status).toBe('REVERSED');
    expect(reversed.body.reversal_transaction_id).toBe(fx.reversalId);
    const offline = await detail(w.operatorAdminA, fx.offlineId);
    expect(offline.body.source).toBe('OFFLINE_SYNC');
    const onlineSibling = await detail(w.operatorAdminA, fx.sales[10]!);
    expect(Date.parse(offline.body.occurred_at)).toBeLessThan(
      Date.parse(onlineSibling.body.occurred_at) - 2 * 86_400_000,
    );
    expect(contractViolations('SaleDetail', offline.body)).toEqual([]);
  });

  it('détail : lignes dans l’ordre, libellés FR et EN, conforme au contrat', async () => {
    const res = await detail(w.operatorAdminA, fx.withLinesId);
    expect(res.status).toBe(200);
    expect(res.body.lines.map((l: { line_no: number }) => l.line_no)).toEqual([1, 2]);
    expect(res.body.lines[0]).toMatchObject({
      label_fr: 'Bière',
      label_en: 'Beer',
      quantity: 2,
      unit_price: 250,
      vat_rate_bps: 1800,
      line_total: 500,
    });
    expect(res.body.event_id).toBe(fx.eventId);
    expect(res.body.currency).toBe('XOF');
    const noLines = await detail(w.operatorAdminA, fx.sales[0]!);
    expect(noLines.body.lines).toEqual([]);
  });

  it('commerçant : ne voit que ses ventes, même avec le filtre d’un autre', async () => {
    const mine = await all(merchantAdmin0);
    expect(mine).toHaveLength(fx.byMerchant[0]);
    expect(mine.every((s) => s.merchant_id === fx.merchants[0])).toBe(true);
    const foreign = await list(merchantAdmin0, `?merchant_id=${fx.merchants[1]}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body.data).toEqual([]);
    const other = await all(merchantAdmin1);
    expect(other).toHaveLength(fx.byMerchant[1]);
  });

  it('commerçant : le détail d’une vente d’un autre commerçant est un 404 neutre', async () => {
    const foreignSale = (await all(w.operatorAdminA, `&merchant_id=${fx.merchants[1]}`))[0]!;
    const own = (await all(w.operatorAdminA, `&merchant_id=${fx.merchants[0]}`))[0]!;
    expect((await detail(merchantAdmin0, own.transaction_id as string)).status).toBe(200);
    const res = await detail(merchantAdmin0, foreignSale.transaction_id as string);
    const missing = await detail(merchantAdmin0, randomUUID());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      ...missing.body,
      instance: res.body.instance,
      request_id: undefined,
    });
  });

  it('hors portée : 404 (autre organisateur, autre prestataire, commerçant non participant)', async () => {
    const someSale = fx.sales[5]!;
    // L'identifiant de l'événement et celui de la vente demandée figurent dans l'URL, donc dans `instance`.
    const aIds = [
      ...fx.sales.filter((id) => id !== someSale),
      ...fx.merchants,
      ...fx.pos,
      ...fx.vendors,
    ];
    for (const who of [otherOrganizerAdmin, otherOperatorAdmin, outsider]) {
      const res = await list(who);
      expect(res.status).toBe(404);
      // OP-N194 : le corps de l'erreur ne contient aucun identifiant de A (la liste sans filtre n'a qu'ici ce garde).
      const body = JSON.stringify(res.body);
      for (const id of aIds) expect(body).not.toContain(id);
      const one = await detail(who, someSale);
      expect(one.status).toBe(404);
      for (const id of aIds) expect(JSON.stringify(one.body)).not.toContain(id);
    }
  });

  it('sans rôle de lecture des ventes : 403 (caissier, administrateur de la plateforme)', async () => {
    for (const who of [w.cashierA, w.platformAdmin]) {
      expect((await list(who)).status).toBe(403);
      expect((await detail(who, fx.sales[5]!)).status).toBe(403);
    }
  });

  it('événement ou vente inconnus ou mal formés : 404', async () => {
    expect((await list(w.operatorAdminA, '', randomUUID())).status).toBe(404);
    expect((await list(w.operatorAdminA, '', 'pas-un-uuid')).status).toBe(404);
    expect((await detail(w.operatorAdminA, randomUUID())).status).toBe(404);
    expect((await detail(w.operatorAdminA, 'pas-un-uuid')).status).toBe(404);
  });

  it('sans jeton : 401', async () => {
    expect((await request(app.getHttpServer()).get(`/v1/events/${fx.eventId}/sales`)).status).toBe(
      401,
    );
  });

  it('minimisation : aucune clé ni valeur de portefeuille, bracelet, nom, numéro ou courriel', async () => {
    const wallet = w.ids.walletA;
    const bodies = [
      (await list(w.operatorAdminA, '?limit=200')).body,
      (await detail(w.operatorAdminA, fx.withLinesId)).body,
      (await detail(w.operatorAdminA, fx.reversedId)).body,
    ];
    const names = ['Commerçant', 'Organisateur', 'Événement'];
    const seen: string[] = [];
    const walk = (v: unknown, key = ''): void => {
      if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
      if (v !== null && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          seen.push(k);
          walk(x, k);
        }
        return;
      }
      const text = String(v);
      expect(text).not.toMatch(/\+\d{8,}/);
      expect(text).not.toMatch(/@/);
      expect(text).not.toBe(wallet);
      for (const n of names) expect(text).not.toContain(n);
    };
    bodies.forEach((b) => walk(b));
    expect(seen.filter((k) => /wallet|media|bracelet|phone|email|name|customer/i.test(k))).toEqual(
      [],
    );
    expect(JSON.stringify(bodies)).not.toContain(wallet);
  });

  it('aucune écriture : les ventes et leurs postings sont inchangés par les lectures', async () => {
    const count = () =>
      withOwner(async (db) =>
        Number(
          (
            await db.query(`SELECT count(*) AS c FROM journal_transaction WHERE event_id = $1`, [
              fx.eventId,
            ])
          ).rows[0].c,
        ),
      );
    const before = await count();
    await list(w.operatorAdminA);
    await detail(w.operatorAdminA, fx.sales[0]!);
    expect(await count()).toBe(before);
  });
});
