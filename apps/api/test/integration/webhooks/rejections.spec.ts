// Intégration : notifications refusées (lot WP12, T060 ; NFR-002, FR-014 ; A22). Un refus n'écrit RIEN au grand
// livre ni au registre brut : seulement le compteur sans corps, un journal et une alerte bornée.
import { randomUUID } from 'node:crypto';
import { TenantTx } from '../../../src/db/tenant-tx';
import { computeSignature } from '../../../src/psp/hmac-signature';
import { PspAdapterRegistry } from '../../../src/psp/psp-adapter-registry';
import { Secret } from '../../../src/psp/secret';
import { UnavailablePspSecretStore } from '../../../src/psp/unavailable/unavailable-psp';
import { EventDispatcher } from '../../../src/webhooks/event-dispatcher';
import { WebhookIntake } from '../../../src/webhooks/webhook-intake.service';
import { WebhookRejections } from '../../../src/webhooks/webhook-rejections';
import { ownerRows } from '../../support/media-fixtures';
import { captureLogs, WebhookWorld } from './webhook-fixtures';

describe('notifications refusées', () => {
  let w: WebhookWorld;

  beforeAll(async () => {
    w = await WebhookWorld.create();
  }, 240_000);
  afterAll(async () => {
    await w.close();
  });

  const counter = () =>
    ownerRows<{ reason: string; n: number }>(
      `SELECT reason, sum(count)::int AS n FROM psp_webhook_rejection GROUP BY reason ORDER BY reason`,
    );

  /** Comparaison des réponses neutres : tout est identique hors identifiant de requête. */
  const shape = (res: { status: number; headers: Record<string, unknown>; body: object }) => {
    const { instance: _instance, ...body } = res.body as Record<string, unknown>;
    // L'étiquette (etag) est dérivée du corps, qui porte l'identifiant de requête : elle suit `instance`.
    const { 'x-request-id': _id, date: _date, etag: _etag, ...headers } = res.headers;
    return { status: res.status, headers, body };
  };

  it('NFR-002 : 100 refus mêlés, 0 événement, 0 transaction, 0 anomalie, compteur agrégé, un journal par refus', async () => {
    const t = await w.p.topup();
    const secret = await w.secretOf('WAVE');
    const suspended = await w.p.topup({ method: 'ORANGE_MONEY' });
    await ownerRows(
      `UPDATE psp_configuration SET status = 'SUSPENDED' WHERE psp_configuration_id = $1`,
      [suspended.row.configurationId],
    );
    const before = await w.footprint();
    const countBefore = Object.fromEntries((await counter()).map((r) => [r.reason, r.n]));
    const logs = captureLogs();
    const now = Math.floor(Date.now() / 1000);
    const jobs: Array<() => Promise<{ status: number }>> = [];
    const kinds = {
      SIGNATURE_INVALID: 0,
      TIMESTAMP_OUT_OF_TOLERANCE: 0,
      UNKNOWN_CONFIG: 0,
      CONFIG_NOT_ACTIVE: 0,
      PROVIDER_MISMATCH: 0,
      BODY_TOO_LARGE: 0,
    };
    for (let i = 0; i < 100; i += 1) {
      const kind = Object.keys(kinds)[i % 6] as keyof typeof kinds;
      kinds[kind] += 1;
      const event = w.event(t.row, { id: `evt-refus-${i}-${randomUUID()}` });
      jobs.push(() => {
        switch (kind) {
          case 'SIGNATURE_INVALID':
            return w.post(event, { secret: 'mauvais-secret' });
          case 'TIMESTAMP_OUT_OF_TOLERANCE':
            return w.post(event, { secret, timestamp: i % 2 === 0 ? now + 330 : now - 330 });
          case 'UNKNOWN_CONFIG':
            return w.post(event, { configId: randomUUID() });
          case 'CONFIG_NOT_ACTIVE':
            return w.post(event, { method: 'ORANGE_MONEY', secret });
          case 'PROVIDER_MISMATCH':
            return w.post(event, { segment: 'orange-money' });
          case 'BODY_TOO_LARGE':
            return w.raw(JSON.stringify({ pad: 'x'.repeat(70 * 1024) }), {});
        }
      });
    }
    const statuses: number[] = [];
    try {
      for (let at = 0; at < jobs.length; at += 10)
        statuses.push(
          ...(await Promise.all(jobs.slice(at, at + 10).map((job) => job()))).map((r) => r.status),
        );
    } finally {
      logs.restore();
      await ownerRows(
        `UPDATE psp_configuration SET status = 'ACTIVE' WHERE psp_configuration_id = $1`,
        [suspended.row.configurationId],
      );
    }
    expect(statuses.every((s) => [401, 404, 413].includes(s))).toBe(true);
    expect(await w.footprint()).toEqual(before);
    // Compteur durable agrégé : au moins un par refus, par motif (sans corps).
    const countAfter = Object.fromEntries((await counter()).map((r) => [r.reason, r.n]));
    for (const [reason, n] of Object.entries(kinds))
      expect((countAfter[reason] ?? 0) - (countBefore[reason] ?? 0)).toBe(n);
    // Un journal de sécurité par refus.
    const journal = logs.lines.filter((line) => line.includes('"psp.webhook.rejected"'));
    expect(journal).toHaveLength(100);
    // Jamais le corps, le secret ni la signature reçue dans un journal.
    expect(logs.text()).not.toContain(secret);
    expect(logs.text()).not.toContain('mauvais-secret');
    expect(logs.text()).not.toContain('v1=');
    expect(logs.text()).not.toContain('xxxxxxxxxxxxxxxx');
    expect(journal[0]).toMatch(/"body_sha256":"[0-9a-f]{64}"/);
  }, 180_000);

  it('alerte bornée : 100 refus du même motif dans la minute = une alerte ; minute suivante = une autre', async () => {
    const rejections = w.p.sw.api.app.get(WebhookRejections, { strict: false });
    const logs = captureLogs();
    const clock = jest.spyOn(Date, 'now');
    const ctx = (configId: string) => ({
      provider: 'wave',
      configId,
      size: 10,
      rawBody: Buffer.from('x'),
      ip: '127.0.0.1',
    });
    const alerts = () => logs.lines.filter((line) => line.includes('"psp.webhook.alert"'));
    try {
      const minute = 1_900_000_000_000;
      clock.mockReturnValue(minute);
      const config = randomUUID();
      for (let i = 0; i < 100; i += 1) await rejections.record('SIGNATURE_INVALID', ctx(config));
      expect(alerts()).toHaveLength(1);
      // Une autre configuration, même motif, même minute : toujours une seule alerte pour ce motif.
      await rejections.record('SIGNATURE_INVALID', ctx(randomUUID()));
      expect(alerts()).toHaveLength(1);
      // Un autre motif a la sienne.
      await rejections.record('UNKNOWN_CONFIG', ctx(config));
      expect(alerts()).toHaveLength(2);
      // Minute suivante : de nouveau une alerte pour le motif.
      clock.mockReturnValue(minute + 61_000);
      await rejections.record('SIGNATURE_INVALID', ctx(config));
      expect(alerts()).toHaveLength(3);
    } finally {
      clock.mockRestore();
      logs.restore();
    }
  });

  it('un compteur en panne ne change pas la réponse : le refus est quand même rendu', async () => {
    const t = await w.p.topup();
    const tx = w.p.sw.api.app.get(TenantTx, { strict: false });
    const spy = jest.spyOn(tx, 'withoutTenant');

    const logs = captureLogs();
    try {
      let failures = 0;
      spy.mockImplementation(((fn: never) => {
        if (String(fn).includes('record_webhook_rejection')) {
          failures += 1;
          return Promise.reject(new Error('compteur en panne'));
        }
        return TenantTx.prototype.withoutTenant.call(tx, fn);
      }) as never);
      const res = await w.post(w.event(t.row), { secret: 'faux' });
      expect(res.status).toBe(401);
      expect(failures).toBe(1);
    } finally {
      spy.mockRestore();
      logs.restore();
    }
    expect(logs.text()).toContain('psp.webhook.counter_failed');
  });

  it('les cinq 404 sont indiscernables (corps et en-têtes), et le port de secrets n’est jamais appelé', async () => {
    const t = await w.p.topup();
    const suspended = await w.p.topup({ method: 'ORANGE_MONEY' });
    await ownerRows(
      `UPDATE psp_configuration SET status = 'SUSPENDED' WHERE psp_configuration_id = $1`,
      [suspended.row.configurationId],
    );
    const spy = jest.spyOn(w.p.store, 'get');
    try {
      const secret = await w.secretOf('WAVE');
      spy.mockClear();
      const event = w.event(t.row);
      const responses = {
        unknown: await w.post(event, { secret, configId: randomUUID() }),
        suspended: await w.post(event, { method: 'ORANGE_MONEY', secret }),
        otherProvider: await w.post(event, { secret, segment: 'orange-money' }),
        unknownSegment: await w.post(event, { secret, segment: 'inconnu' }),
        badUuid: await w.post(event, { secret, configId: 'pas-un-uuid' }),
      };
      expect(spy).not.toHaveBeenCalled();
      const reference = shape(responses.unknown);
      expect(reference.status).toBe(404);
      for (const response of Object.values(responses)) expect(shape(response)).toEqual(reference);
      // Taille : avant la configuration, donc avant le coffre aussi.
      const big = await w.raw(JSON.stringify({ pad: 'x'.repeat(70 * 1024) }), {});
      expect(big.status).toBe(413);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      await ownerRows(
        `UPDATE psp_configuration SET status = 'ACTIVE' WHERE psp_configuration_id = $1`,
        [suspended.row.configurationId],
      );
    }
  });

  it('413 problem+json pour 70 Kio (au-delà de 64 Kio, sous la limite de l’analyseur), rien conservé', async () => {
    const before = await w.footprint();
    const res = await w.raw(JSON.stringify({ pad: 'x'.repeat(70 * 1024) }), {});
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await w.footprint()).toEqual(before);
  });

  // LACUNE SIGNALEE (prompt T060 point 2) : au-dela de 100 Kio l analyseur de Nest refuse AVANT le controleur et le
  // filtre errors/problem.filter.ts rend un 500 INTERNAL_ERROR au lieu du 413 (l erreur de body-parser n est pas
  // une HttpException). La retouche d une ligne du filtre est a demander, pas a faire : ce test passe (it.failing)
  // tant que la lacune existe et echouera, pour etre retourne en test ordinaire, quand le filtre sera corrige.
  it.failing(
    '413 problem+json pour 1 Mio (refus de l’analyseur, avant le contrôleur)',
    async () => {
      const res = await w.raw(JSON.stringify({ pad: 'x'.repeat(1024 * 1024) }), {});
      expect(res.status).toBe(413);
      expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
    },
  );

  it('signature absente, mal formée, fausse, corps modifié d’un octet : 401', async () => {
    const t = await w.p.topup();
    const event = w.event(t.row);
    const secret = await w.secretOf('WAVE');
    const missing = await w.post(event, { unsigned: true });
    expect([missing.status, missing.body.code]).toEqual([401, 'WEBHOOK_SIGNATURE_INVALID']);
    const malformed = await w.post(event, { headers: { 'x-webhook-signature': 'n-importe-quoi' } });
    expect(malformed.status).toBe(401);
    const wrongLength = await w.post(event, {
      headers: { 'wave-signature': `t=${Math.floor(Date.now() / 1000)},v1=abcd` },
    });
    expect(wrongLength.status).toBe(401);
    // Corps modifié d'un octet après la signature.
    const signed = JSON.stringify(event);
    const altered = await w.post(event, { sentBody: signed.replace('XOF', 'XOG') });
    expect([altered.status, altered.body.code]).toEqual([401, 'WEBHOOK_SIGNATURE_INVALID']);
    // Signature valide d'un autre corps.
    const other = await w.post(event, { secret: `${secret}!` });
    expect(other.status).toBe(401);
    expect((await w.p.read(t.row.topupId))?.status).toBe('PENDING');
  });

  it('horodatage : +270 s accepté, ±330 s refusé (401), rien conservé (la limite exacte ±300 s est prouvée sans horloge réelle par verifier.spec)', async () => {
    const secret = await w.secretOf('WAVE');
    const now = Math.floor(Date.now() / 1000);
    const ok = await w.p.topup();
    expect((await w.post(w.event(ok.row), { secret, timestamp: now + 270 })).status).toBe(200);
    for (const skew of [330, -330, 3600]) {
      const t = await w.p.topup();
      const before = await w.footprint();
      const res = await w.post(w.event(t.row), { secret, timestamp: now + skew });
      expect([res.status, res.body.code]).toEqual([401, 'WEBHOOK_TIMESTAMP_OUT_OF_TOLERANCE']);
      expect(await w.footprint()).toEqual(before);
    }
  });

  it('corps signé mais illisible : 400, rien conservé, compté BODY_MALFORMED', async () => {
    const secret = await w.secretOf('WAVE');
    const ts = Math.floor(Date.now() / 1000);
    const body = '{"valide":"json mais pas une notification"}';
    const signature = computeSignature(Secret.of(secret), ts, Buffer.from(body));
    const before = await w.footprint();
    const res = await w.raw(body, { 'wave-signature': `t=${ts},v1=${signature}` });
    expect(res.status).toBe(400);
    expect(await w.footprint()).toEqual(before);
    expect((await counter()).find((r) => r.reason === 'BODY_MALFORMED')?.n).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('une réponse d’erreur ne contient ni secret, ni signature, ni corps', async () => {
    const t = await w.p.topup();
    const res = await w.post(w.event(t.row), { secret: 'secret-canari-123' });
    expect(res.text).not.toContain('secret-canari-123');
    expect(res.text).not.toContain('v1=');
    expect(res.text).not.toContain(t.row.topupId);
  });

  it('production (fournisseur indisponible) : 404 neutre, aucune écriture', async () => {
    const app = w.p.sw.api.app;
    const intake = new WebhookIntake(
      app.get(TenantTx, { strict: false }),
      app.get(WebhookRejections, { strict: false }),
      app.get(EventDispatcher, { strict: false }),
      new PspAdapterRegistry([], false),
      new UnavailablePspSecretStore(),
    );
    const t = await w.p.topup();
    const before = await w.footprint();
    const event = w.event(t.row);
    const body = Buffer.from(JSON.stringify(event));
    await expect(
      intake.receive({
        providerSegment: 'wave',
        configId: t.row.configurationId,
        rawBody: body,
        headers: { 'content-length': String(body.length) },
        ip: '127.0.0.1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(await w.footprint()).toEqual(before);
  });
});
