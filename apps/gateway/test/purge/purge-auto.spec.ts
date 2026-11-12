import { HttpException } from '@nestjs/common';
import { appendAckedOps } from '../authority/_support/harness';
import { PurgeGuard } from '../../src/purge/purge.guard';
import { PurgeCompletedError } from '../../src/purge/purge.module';
import { PURGE_STEPS, type PurgeStep } from '../../src/purge/purge.service';
import {
  closeEvent,
  count,
  makePurgeRig,
  readMarker,
  seedCanary,
  type PurgeRig,
} from './_support/harness';

let rig: PurgeRig;
afterEach(async () => rig?.close());

describe('purge automatique', () => {
  it(
    'CLOSED et file acquittée : la purge part, tout est vidé, les clés sont ' + 'détruites',
    async () => {
      rig = await makePurgeRig();
      await seedCanary(rig);
      await closeEvent(rig);
      await appendAckedOps(rig.h.db, 2, true);
      expect(await rig.trigger.tick()).toBe('READY');
      expect(readMarker(rig)?.state).toBe('DONE');
      for (const t of [
        'edge_media',
        'edge_pwd_pack_key',
        'edge_snapshot_entry',
        'edge_token_key',
        'edge_device_token_family',
        'edge_vendor',
        'edge_event_setting',
      ]) {
        expect(await count(rig, t)).toBe(0);
      }
      // La file n'est pas effacée : les opérations déjà acquittées restent dans l'ajout seul.
      expect(await count(rig, 'edge_op')).toBe(2);
      const steps = (
        await rig.h.db.pool.query(
          `SELECT detail->>'step' AS s FROM edge_audit WHERE kind = 'PURGE'`,
        )
      ).rows.map((r: { s: string }) => r.s);
      expect(steps).toEqual([...PURGE_STEPS]);
      expect(rig.quiesced.count).toBe(1);
      await expect(rig.keystore.sign('token', Buffer.from('x'))).rejects.toMatchObject({
        code: 'KEY_DESTROYED',
      });
    },
  );

  it(
    'CLOSED mais file non acquittée : aucune purge, alerte « purge en attente », ' + 'rien perdu',
    async () => {
      rig = await makePurgeRig();
      await seedCanary(rig);
      await closeEvent(rig);
      await appendAckedOps(rig.h.db, 1, false);
      expect(await rig.trigger.tick()).toBe('PENDING');
      expect(readMarker(rig)).toBeNull();
      expect(await count(rig, 'edge_media')).toBe(1);
      expect(await count(rig, "edge_audit WHERE kind = 'PURGE_PENDING'")).toBe(1);
      await rig.keystore.sign('token', Buffer.from('x'));
    },
  );

  it('événement non clos, ou delta actif : aucune purge', async () => {
    rig = await makePurgeRig();
    await seedCanary(rig);
    await rig.h.db.pool.query(
      `INSERT INTO edge_event_setting (id, status, currency, minor_units, timezone)
       VALUES (true, 'ACTIVE', 'EUR', 2, 'UTC')`,
    );
    expect(await rig.trigger.tick()).toBe('NOT_CLOSED');
    await closeEvent(rig);
    await appendAckedOps(rig.h.db, 1, true);
    await rig.h.db.pool.query(
      `INSERT INTO edge_op_delta (edge_seq, wallet_id, paid_delta, promo_delta)
       VALUES (1, gen_random_uuid(), -100, 0)`,
    );
    expect(await rig.trigger.tick()).toBe('PENDING');
    expect(readMarker(rig)).toBeNull();
    expect(await count(rig, 'edge_media')).toBe(1);
  });

  it.each(PURGE_STEPS.filter((s) => s !== 'DONE'))(
    'arrêt brutal après l’étape %s : le démarrage termine la purge avant tout service',
    async (stop: PurgeStep) => {
      rig = await makePurgeRig({
        hook: (step) => {
          if (step === stop) throw new Error('arrêt simulé');
        },
      });
      await seedCanary(rig);
      await closeEvent(rig);
      await appendAckedOps(rig.h.db, 1, true);
      await expect(rig.trigger.tick()).rejects.toThrow('arrêt simulé');
      expect(readMarker(rig)?.state).toBe('STARTED');
      // La porte est déjà fermée : rien ne se sert.
      expect(() => new PurgeGuard(rig.gate).canActivate()).toThrow(HttpException);
      const next = rig.restart();
      await expect(next.runtime.enforceAtStartup()).rejects.toThrow(PurgeCompletedError);
      expect(readMarker(rig)?.state).toBe('DONE');
      expect(await count(rig, 'edge_media')).toBe(0);
      expect(await count(rig, 'edge_token_key')).toBe(0);
    },
  );

  it('purge terminée : refus de redémarrer, 503 sans détail', async () => {
    rig = await makePurgeRig();
    await closeEvent(rig);
    await appendAckedOps(rig.h.db, 1, true);
    await rig.trigger.tick();
    await expect(rig.restart().runtime.enforceAtStartup()).rejects.toThrow(/refuse de redémarrer/);
    try {
      new PurgeGuard(rig.gate).canActivate();
      throw new Error('aurait dû refuser');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).message).toBe('');
    }
  });
});
