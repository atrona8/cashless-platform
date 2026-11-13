import { PROTECTED_TABLES, PurgeRefusedError } from '../../src/purge/purge.service';
import { appendAckedOps } from '../authority/_support/harness';
import {
  CANARY,
  closeEvent,
  count,
  found,
  makePurgeRig,
  readMarker,
  scanDatabase,
  seedCanary,
  type PurgeRig,
} from './_support/harness';

let rig: PurgeRig;
afterEach(async () => rig?.close());

describe('canari (NFR-013, NFR-010)', () => {
  it('présent avant la purge, absent après, sous toutes ses représentations', async () => {
    rig = await makePurgeRig();
    await seedCanary(rig);
    await closeEvent(rig);
    await appendAckedOps(rig.h.db, 1, true);
    const before = found(await scanDatabase(rig.h.db.name));
    // Le détecteur voit au moins le texte, le binaire et leurs formes encodées.
    expect(before).toEqual(expect.arrayContaining([0, 1, 6]));

    const logged: string[] = [];
    const spies = (['log', 'warn', 'error'] as const).map((k) =>
      jest.spyOn(console, k).mockImplementation((...a: unknown[]) => void logged.push(a.join(' '))),
    );
    const out = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((c: unknown) => (logged.push(String(c)), true));
    try {
      await rig.trigger.tick();
    } finally {
      [...spies, out].forEach((s) => s.mockRestore());
    }
    expect(readMarker(rig)?.state).toBe('DONE');
    expect(found(await scanDatabase(rig.h.db.name))).toEqual([]);
    expect(found(Buffer.from(logged.join('\n')))).toEqual([]);
    expect(logged.join('\n')).not.toContain(CANARY);
  });

  it('sign et agree refusés après la purge', async () => {
    rig = await makePurgeRig();
    await closeEvent(rig);
    await appendAckedOps(rig.h.db, 1, true);
    const peer = await rig.keystore.publicKey('agreement');
    await rig.trigger.tick();
    for (const use of ['token', 'batch', 'snapshot'] as const) {
      await expect(rig.keystore.sign(use, Buffer.from('x'))).rejects.toMatchObject({
        code: 'KEY_DESTROYED',
      });
    }
    await expect(rig.keystore.agree(peer)).rejects.toMatchObject({ code: 'KEY_DESTROYED' });
  });

  it(
    'contrôle positif : une purge qui oublie edge_snapshot_entry laisse la matière, ' + 'détectée',
    async () => {
      rig = await makePurgeRig();
      await seedCanary(rig);
      await closeEvent(rig);
      await appendAckedOps(rig.h.db, 1, true);
      // Mutation réelle de la purge : la table est ajoutée à la liste protégée, donc non vidée.
      (PROTECTED_TABLES as string[]).push('edge_snapshot_entry');
      try {
        await rig.trigger.tick();
      } finally {
        (PROTECTED_TABLES as string[]).pop();
      }
      expect(found(await scanDatabase(rig.h.db.name)).length).toBeGreaterThan(0);
    },
  );

  it(
    'une table ajoutée plus tard est purgée par défaut ; les tables protégées sont ' + 'nommées',
    async () => {
      rig = await makePurgeRig();
      await rig.h.db.pool.query('CREATE TABLE edge_future_secret (v text)');
      await rig.h.db.pool.query(`INSERT INTO edge_future_secret VALUES ('x')`);
      await closeEvent(rig);
      await appendAckedOps(rig.h.db, 1, true);
      await rig.trigger.tick();
      expect(await count(rig, 'edge_future_secret')).toBe(0);
      expect(await count(rig, 'edge_meta')).toBe(1);
    },
  );

  it(
    'aucun faux en production : un port matériel factice refuse la purge, rien n’est ' + 'touché',
    async () => {
      rig = await makePurgeRig({ production: true });
      await seedCanary(rig);
      await expect(rig.service.execute({ trigger: 'AUTO' })).rejects.toBeInstanceOf(
        PurgeRefusedError,
      );
      expect(readMarker(rig)).toBeNull();
      expect(await count(rig, 'edge_media')).toBe(1);
      await rig.keystore.sign('token', Buffer.from('x'));
    },
  );
});
