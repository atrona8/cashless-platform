// Décision 23 (OP-N102) : à l'octroi de l'autorité à la passerelle, les jetons d'appareil de l'événement sont exposés
// (`device_refresh_token.edge_exposed`) dans la transaction de l'octroi, avant la première page servie ; ceux d'un
// autre événement ne le sont pas.
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { TenantTx, type TxClient } from '../../../../src/db/tenant-tx';
import { DeviceTokenRefreshService } from '../../../../src/devices/tokens/refresh.service';
import { APP_URL, withOwner } from '../../../support/db';
import { ownerRows } from '../../../support/media-fixtures';
import { DebitWorld } from '../../debit-authority/debit-authority-world';

jest.setTimeout(240_000);

describe('exposition des jetons d’appareil à l’octroi (décision 23)', () => {
  let dw: DebitWorld;
  beforeAll(async () => {
    dw = await DebitWorld.create();
  });
  afterAll(async () => {
    await dw?.close();
  });
  beforeEach(async () => {
    await dw.reset();
  });

  const exposed = async (deviceId: string): Promise<boolean[]> =>
    (
      await ownerRows<{ edge_exposed: boolean }>(
        'SELECT edge_exposed FROM device_refresh_token WHERE device_id = $1',
        [deviceId],
      )
    ).map((row) => row.edge_exposed);

  it('l’octroi expose les familles de l’événement, pas celles d’un autre événement', async () => {
    const mine = await dw.pw.terminal({ session: false });
    const otherEvent = await dw.otherEvent();
    const deviceId = randomUUID();
    await withOwner(async (db) => {
      await db.query(
        `INSERT INTO device (id, operator_id, kind, app_mode, event_id, serial)
         VALUES ($1, $2, 'POS', 'CATALOG_POS', $3, $4)`,
        [deviceId, dw.pw.w.ops.a, otherEvent, `T-${deviceId.slice(0, 8)}`],
      );
      await db.query(
        `INSERT INTO device_refresh_token (id, operator_id, device_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '1 day')`,
        [
          randomUUID(),
          dw.pw.w.ops.a,
          deviceId,
          randomUUID(),
          createHash('sha256').update(deviceId).digest(),
        ],
      );
    });
    expect(await exposed(mine.t.deviceId)).toEqual([false]);
    await dw.grant(await dw.gateway());
    expect(await exposed(mine.t.deviceId)).toEqual([true]);
    expect(await exposed(deviceId)).toEqual([false]);
  });

  // Renouvellement d'un jeton (`DeviceTokenRefreshService.exposeWhileEdge`, cycle 2 de WP12) : la ré-exposition ne se fait que
  // sous `EDGE`. Appel direct de la méthode privée avec un client réel (rôle applicatif) qui trace ses requêtes.
  describe('ré-exposition au renouvellement (exposeWhileEdge)', () => {
    let pool: Pool;
    beforeAll(() => {
      pool = new Pool({ connectionString: APP_URL });
    });
    afterAll(async () => {
      await pool?.end();
    });

    const renew = async (eventId: string): Promise<string[]> => {
      const sent: string[] = [];
      const service = Object.create(DeviceTokenRefreshService.prototype) as {
        exposeWhileEdge(client: TxClient, eventId: string): Promise<void>;
      };
      await new TenantTx(pool as never).run(dw.pw.w.ops.a, async (client) => {
        const real = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        (client as { query: unknown }).query = (text: unknown, values?: unknown) => {
          sent.push(String(typeof text === 'string' ? text : ''));
          return real(text, values);
        };
        await service.exposeWhileEdge(client, eventId);
      });
      return sent;
    };
    const exposeCalls = (sent: string[]) =>
      sent.filter((sql) => sql.includes('edge_expose_device_token_families'));

    it('grand livre EDGE : la ligne du renouvellement est exposée', async () => {
      const mine = await dw.pw.terminal({ session: false });
      await dw.grant(await dw.gateway());
      // Le renouvellement crée une nouvelle ligne de la famille, non exposée.
      await withOwner((db) =>
        db.query('UPDATE device_refresh_token SET edge_exposed = false WHERE device_id = $1', [
          mine.t.deviceId,
        ]),
      );
      expect(await exposed(mine.t.deviceId)).toEqual([false]);
      const sent = await renew(dw.pw.w.ids.eventA);
      expect(exposeCalls(sent)).toHaveLength(1);
      expect(await exposed(mine.t.deviceId)).toEqual([true]);
    });

    it('grand livre CENTRAL : aucun appel d’exposition, la ligne reste non exposée', async () => {
      const mine = await dw.pw.terminal({ session: false });
      expect((await dw.authority()).debit_authority).toBe('CENTRAL');
      const sent = await renew(dw.pw.w.ids.eventA);
      expect(exposeCalls(sent)).toHaveLength(0);
      expect(await exposed(mine.t.deviceId)).toEqual([false]);
    });
  });
});
