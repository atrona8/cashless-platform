import 'reflect-metadata';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AdminBindError,
  AdminListener,
  assertLoopbackBind,
  isLoopbackAddress,
} from '../../src/admin/admin-listener';
import { LocalOrdersController } from '../../src/admin/local-orders.controller';
import {
  loadSiteOrderKeys,
  ORDER_VALIDITY_MS,
  SiteOrderError,
  verifyTwoPersonOrder,
  type OrderPayload,
} from '../../src/authority/site-order';
import type { GatewayConfig } from '../../src/config/config';
import { makeCa } from '../startup/_support/pki';
import {
  auditKinds,
  authorityRow,
  forceAuthority,
  makeHarness,
  signOrder,
  type Harness,
} from './_support/harness';

let h: Harness;
let n = 0;
const nonce = (): string => `nonce-${String(++n).padStart(4, '0')}-abcdefghijklmnop`;

beforeEach(async () => {
  h = await makeHarness();
  await forceAuthority(h.db, {
    state: 'STALE',
    epoch: 5,
    highest_epoch_seen: 6,
    link_state: 'ISOLATED',
    handover_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
});
afterEach(async () => h.close());

function order(over: Partial<OrderPayload> = {}): OrderPayload {
  return {
    kind: 'LOCAL_UNSTALE',
    gateway_id: h.gatewayId,
    epoch: 5,
    issued_at: h.clock.now().toISOString(),
    nonce: nonce(),
    ...over,
  };
}
const both = (o: OrderPayload) => [signOrder(o, h.siteKeys[0]), signOrder(o, h.siteKeys[1])];
const refusal = async (body: { order: unknown; signatures: unknown }) =>
  (await h.authority.localUnstale(body).catch((e) => e)) as SiteOrderError;

describe('levée locale de STALE à deux personnes', () => {
  it(
    'cas valide : ACTIVE, highest_epoch_seen ramenée à ' + 'epoch, audit avec les deux auteurs',
    async () => {
      const o = order();
      const row = await h.authority.localUnstale({ order: o, signatures: both(o) });
      expect(row).toMatchObject({ state: 'ACTIVE', epoch: 5, highestEpochSeen: 5 });
      await expect(h.authority.assertCanDebit(5)).resolves.toBeDefined();
      const audit = (
        await h.db.pool.query(`SELECT actor, detail FROM edge_audit WHERE kind = 'LOCAL_UNSTALE'`)
      ).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0].detail.holders).toEqual(['Responsable A', 'Responsable B']);
      expect(audit[0].detail.key_ids).toHaveLength(2);
      expect(audit[0].detail.key_ids[0]).not.toBe(audit[0].detail.key_ids[1]);
      // L'audit ne retient que des identifiants : aucune signature, aucune clé.
      expect(JSON.stringify(audit)).not.toContain(both(o)[0]!.signature);
      expect(JSON.stringify(audit)).not.toContain(h.siteKeys[0].publicKey);
      expect(await auditKinds(h.db)).toContain('SITE_ORDER_ACCEPTED');
    },
  );

  it('une seule signature : refusée, état intact', async () => {
    const o = order();
    expect((await refusal({ order: o, signatures: [signOrder(o, h.siteKeys[0])] })).code).toBe(
      'SIGNATURE_COUNT',
    );
    expect((await authorityRow(h.db)).state).toBe('STALE');
  });

  it('deux fois la même clé : refusée', async () => {
    const o = order();
    const same = signOrder(o, h.siteKeys[0]);
    expect((await refusal({ order: o, signatures: [same, same] })).code).toBe('SAME_SIGNER');
    // Même signature sous le nom de l'autre responsable : elle ne correspond pas à sa clé.
    const relabeled = { holder: h.siteKeys[1].holder, signature: same.signature };
    expect((await refusal({ order: o, signatures: [same, relabeled] })).code).toBe('BAD_SIGNATURE');
    expect((await authorityRow(h.db)).state).toBe('STALE');
  });

  it(
    'responsable inconnu, signature altérée, ordre ' + 'modifié après signature : refusés',
    async () => {
      const o = order();
      const [a, b] = both(o);
      expect((await refusal({ order: o, signatures: [a, { ...b!, holder: 'Intrus' }] })).code).toBe(
        'UNKNOWN_HOLDER',
      );
      const flipped = Buffer.from(b!.signature, 'base64url');
      flipped[10] = flipped[10]! ^ 1;
      expect(
        (
          await refusal({
            order: o,
            signatures: [a, { ...b!, signature: flipped.toString('base64url') }],
          })
        ).code,
      ).toBe('BAD_SIGNATURE');
      expect((await refusal({ order: { ...o, epoch: 4 }, signatures: both(o) })).code).toBe(
        'BAD_SIGNATURE',
      );
    },
  );

  it('ordre périmé : valable 10 min, refusé à 10 min + 1 s', async () => {
    const o = order();
    const signatures = both(o);
    h.clock.advance(ORDER_VALIDITY_MS + 1000);
    expect((await refusal({ order: o, signatures })).code).toBe('EXPIRED');
    expect((await authorityRow(h.db)).state).toBe('STALE');
    // À 10 min pile : accepté.
    h.clock.advance(-1000);
    await expect(h.authority.localUnstale({ order: o, signatures })).resolves.toMatchObject({
      state: 'ACTIVE',
    });
  });

  it('ordre daté du futur : refusé', async () => {
    const o = order({ issued_at: new Date(h.clock.now().getTime() + 5 * 60_000).toISOString() });
    expect((await refusal({ order: o, signatures: both(o) })).code).toBe('FROM_THE_FUTURE');
  });

  it('nonce rejoué : refusé, même après un nouveau STALE', async () => {
    const o = order();
    const signatures = both(o);
    await h.authority.localUnstale({ order: o, signatures });
    await forceAuthority(h.db, { state: 'STALE', highest_epoch_seen: 6 });
    expect((await refusal({ order: o, signatures })).code).toBe('NONCE_REPLAYED');
    expect((await authorityRow(h.db)).state).toBe('STALE');
  });

  it('le central a confirmé l’époque supérieure : refusée', async () => {
    await forceAuthority(h.db, { central_confirmed_epoch: 6 });
    const o = order();
    expect((await refusal({ order: o, signatures: both(o) })).code).toBe('REFUSED');
    expect((await authorityRow(h.db)).state).toBe('STALE');
  });

  it('lien sain (CONNECTED ou CATCHING_UP) : refusée', async () => {
    for (const link of ['CONNECTED', 'CATCHING_UP']) {
      await forceAuthority(h.db, { link_state: link });
      const o = order();
      expect((await refusal({ order: o, signatures: both(o) })).code).toBe('REFUSED');
    }
    expect((await authorityRow(h.db)).state).toBe('STALE');
  });

  it(
    'autres refus : pas STALE, mauvaise époque, autre ' + 'passerelle, champ en trop, autre type',
    async () => {
      const o = order({ epoch: 6 });
      expect((await refusal({ order: o, signatures: both(o) })).code).toBe('REFUSED');
      const g = order({ gateway_id: '99999999-9999-4999-8999-999999999999' });
      expect((await refusal({ order: g, signatures: both(g) })).code).toBe('WRONG_GATEWAY');
      const extra = order({ extra: 'x' });
      expect((await refusal({ order: extra, signatures: both(extra) })).code).toBe('MALFORMED');
      const purge = order({ kind: 'PURGE' });
      expect((await refusal({ order: purge, signatures: both(purge) })).code).toBe('KIND_MISMATCH');
      await forceAuthority(h.db, { state: 'ACTIVE', highest_epoch_seen: 5 });
      const late = order();
      expect((await refusal({ order: late, signatures: both(late) })).code).toBe('REFUSED');
    },
  );

  it('un refus est consigné sans matière sensible', async () => {
    const o = order();
    await refusal({ order: o, signatures: [signOrder(o, h.siteKeys[0])] });
    const rows = (
      await h.db.pool.query(`SELECT detail FROM edge_audit WHERE kind = 'SITE_ORDER_REFUSED'`)
    ).rows;
    expect(rows[0].detail).toEqual({
      order_kind: 'LOCAL_UNSTALE',
      reason: 'SIGNATURE_COUNT',
      nonce: o.nonce,
    });
  });
});

describe('verifyTwoPersonOrder (réutilisée par la purge, WP24)', () => {
  it('vérifie un ordre PURGE de la même façon ; n’admet pas un type pour un autre', async () => {
    const keys = await h.tx.run((tx) => loadSiteOrderKeys(tx));
    const purge = order({ kind: 'PURGE' });
    const verified = verifyTwoPersonOrder('PURGE', purge, both(purge), keys, h.clock.now());
    expect(verified.holders).toEqual(['Responsable A', 'Responsable B']);
    expect(() =>
      verifyTwoPersonOrder('LOCAL_UNSTALE', purge, both(purge), keys, h.clock.now()),
    ).toThrow(SiteOrderError);
  });

  it('exige exactement deux clés de site enregistrées', async () => {
    const keys = await h.tx.run((tx) => loadSiteOrderKeys(tx));
    const o = order();
    expect(() =>
      verifyTwoPersonOrder('LOCAL_UNSTALE', o, both(o), keys.slice(0, 1), h.clock.now()),
    ).toThrow(/deux clés/);
  });
});

describe('écouteur d’administration local (POST /local/orders)', () => {
  function config(production: boolean): GatewayConfig {
    return { production, adminPort: 0 } as unknown as GatewayConfig;
  }
  let listener: AdminListener | null = null;
  afterEach(async () => {
    await listener?.stop();
    listener = null;
  });

  async function start(
    production = false,
  ): Promise<{ port: number; orders: LocalOrdersController }> {
    const orders = new LocalOrdersController();
    orders.registerOrderHandler('LOCAL_UNSTALE', (body) => h.authority.localUnstale(body));
    listener = new AdminListener(config(production), orders);
    return { port: await listener.start({ port: 0 }), orders };
  }

  function post(
    port: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/local/orders',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
        },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
  }

  it('production : une liaison hors boucle locale est refusée, aucun port ouvert', async () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.8.9.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    for (const bad of ['0.0.0.0', '::', '192.168.1.10', '10.0.0.5', 'passerelle.site.test', '']) {
      expect(isLoopbackAddress(bad)).toBe(false);
      expect(() => assertLoopbackBind(bad, true)).toThrow(AdminBindError);
    }
    const orders = new LocalOrdersController();
    const prod = new AdminListener(config(true), orders);
    await expect(prod.start({ host: '0.0.0.0', port: 38444 })).rejects.toThrow(
      /hors boucle locale/,
    );
    await expect(
      new Promise((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port: 38444 }, () => {
          socket.destroy();
          resolve('ouvert');
        });
        socket.on('error', reject);
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
    // Décision 47 : en production, pas de repli en clair (WP24) ; avec TLS, 127.0.0.1 est permis.
    await expect(new AdminListener(config(true), orders).start({ port: 0 })).rejects.toThrow(
      /sans TLS/,
    );
    const ca = await makeCa('CN=127.0.0.1');
    const dir = mkdtempSync(join(tmpdir(), 'gw-admin-tls-'));
    writeFileSync(join(dir, 'a.crt'), ca.certPem);
    writeFileSync(join(dir, 'a.key'), ca.keyPem, { mode: 0o600 });
    const tlsConfig = {
      production: true,
      adminPort: 0,
      adminTlsCertFile: join(dir, 'a.crt'),
      adminTlsKeyFile: join(dir, 'a.key'),
    } as unknown as GatewayConfig;
    const ok = new AdminListener(tlsConfig, orders);
    const port = await ok.start({ port: 0 });
    expect(port).toBeGreaterThan(0);
    await ok.stop();
  });

  it('un ordre valide levé par HTTP ; le même ordre rejoué est refusé', async () => {
    const { port } = await start();
    const o = order();
    const ok = await post(port, { order: o, signatures: both(o) });
    expect(ok).toEqual({ status: 200, body: { code: 'ACCEPTED', kind: 'LOCAL_UNSTALE' } });
    expect((await authorityRow(h.db)).state).toBe('ACTIVE');
    await forceAuthority(h.db, { state: 'STALE', highest_epoch_seen: 6 });
    const replay = await post(port, { order: o, signatures: both(o) });
    expect(replay).toEqual({ status: 409, body: { code: 'NONCE_REPLAYED' } });
  });

  it(
    'une signature refusée, deux fois la même clé, ordre ' + 'expiré : codes HTTP et état intact',
    async () => {
      const { port } = await start();
      const o = order();
      expect(
        (await post(port, { order: o, signatures: [signOrder(o, h.siteKeys[0])] })).status,
      ).toBe(400);
      const same = signOrder(o, h.siteKeys[0]);
      expect((await post(port, { order: o, signatures: [same, same] })).body).toEqual({
        code: 'SAME_SIGNER',
      });
      const old = order({
        issued_at: new Date(h.clock.now().getTime() - 11 * 60_000).toISOString(),
      });
      expect((await post(port, { order: old, signatures: both(old) })).body).toEqual({
        code: 'EXPIRED',
      });
      expect((await authorityRow(h.db)).state).toBe('STALE');
    },
  );

  it('PURGE sans traitement enregistré : 501 ; avec registerOrderHandler : appelé', async () => {
    const { port, orders } = await start();
    const purge = order({ kind: 'PURGE' });
    expect((await post(port, { order: purge, signatures: both(purge) })).status).toBe(501);
    let called = 0;
    orders.registerOrderHandler('PURGE', async () => void (called += 1));
    expect((await post(port, { order: purge, signatures: both(purge) })).status).toBe(200);
    expect(called).toBe(1);
    expect(() => orders.registerOrderHandler('PURGE', async () => undefined)).toThrow(
      /déjà enregistré/,
    );
    const unknown = order({ kind: 'AUTRE' });
    expect((await post(port, { order: unknown, signatures: [] })).body).toEqual({
      code: 'UNKNOWN_KIND',
    });
  });

  it(
    'hygiène : Origin, Host étranger, mauvais type, ' + 'corps trop grand ou illisible refusés',
    async () => {
      const { port } = await start();
      const o = order();
      const body = { order: o, signatures: both(o) };
      expect((await post(port, body, { Origin: 'http://evil.example' })).status).toBe(403);
      expect((await post(port, body, { Host: 'evil.example' })).status).toBe(403);
      expect((await post(port, body, { 'Content-Type': 'text/plain' })).status).toBe(415);
      expect((await post(port, 'x'.repeat(20_000))).status).toBe(413);
      expect((await post(port, '{pas du json')).status).toBe(400);
      expect((await authorityRow(h.db)).state).toBe('STALE');
    },
  );
});
