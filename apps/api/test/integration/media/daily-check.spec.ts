// Intégration : contrôle quotidien des mots de passe stockés (FR-010, NFR-003 ; SPECIFICATION
// §7.4). Processus `tag-check` démarré avec son vrai module, son rôle de base
// `cashless_tagcheck` et son faux service de clés. Chaque scénario a son propre prestataire : un
// compte rendu ne s'efface pas et bloque un nouveau passage pendant 24 h (15 minutes après une
// panne). Le code d'alerte d'un processus reste au plus grave depuis son démarrage : le processus
// partagé ne voit que des écarts ; le scénario de panne a son propre processus.
import { DailyCheckService } from '../../../src/media/daily-check/daily-check.service';
import {
  ALARM_KMS_ERROR,
  ALARM_MISMATCH,
  DailyCheckWorker,
} from '../../../src/media/daily-check/daily-check.worker';
import { createKeyProcess, type KeyProcessApp } from '../../support/app';
import { withOwner } from '../../support/db';
import {
  createBatch,
  createMediaWorld,
  ownerRows as rows,
  seedPersonalizedMedia,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';

describe('contrôle quotidien des mots de passe stockés', () => {
  let check: KeyProcessApp;

  /**
   *  Prestataire neuf avec `count` bracelets personnalisés (mots de passe scellés comme par la
   *  personnalisation).
   */
  const operatorWith = async (count: number): Promise<{ w: MediaWorld; media: SeededMedia[] }> => {
    const w = await createMediaWorld();
    const media = await withOwner(async (db) => {
      const batch = await createBatch(db, {
        operatorId: w.ops.a,
        organizerId: w.ids.organizerA,
        quantity: count,
      });
      return seedPersonalizedMedia(db, {
        operatorId: w.ops.a,
        batchId: batch,
        kmsKeyRef: w.keyRef.a,
        count,
      });
    });
    return { w, media };
  };
  const worker = () => check.app.get(DailyCheckWorker, { strict: false });
  const service = () => check.app.get(DailyCheckService, { strict: false });
  const runs = (operatorId: string) =>
    rows<{ sampled: number; mismatches: number; status: string; detail: string | null }>(
      `SELECT sampled, mismatches, status, detail FROM tag_key_check_run
        WHERE operator_id = $1 ORDER BY started_at`,
      [operatorId],
    );

  beforeAll(async () => {
    check = await createKeyProcess('tag-check');
  });

  afterAll(async () => {
    await check.app.close();
  });

  beforeEach(() => check.kms.resetCalls());

  it('150 bracelets : 100 contrôlés, OK ; une clé de données ouverte une fois ; pas de nouveau passage avant 24 h', async () => {
    const { w } = await operatorWith(150);
    expect(await worker().runOnce([w.ops.a])).toBe(1);
    expect(await runs(w.ops.a)).toEqual([
      { sampled: 100, mismatches: 0, status: 'OK', detail: null },
    ]);
    expect(check.kms.calls).toMatchObject({ generateMac: 100, decrypt: 1, generateDataKey: 0 });

    check.kms.resetCalls();
    expect(await worker().runOnce([w.ops.a])).toBe(0);
    expect(check.kms.calls).toMatchObject({ generateMac: 0, decrypt: 0 });
    expect(await runs(w.ops.a)).toHaveLength(1);
  });

  it('chiffré altéré : MISMATCH, alerte d’audit qui nomme le bracelet (identifiant seulement), code de sortie d’alerte', async () => {
    const { w, media } = await operatorWith(5);
    const tampered = media[2]!;
    await rows(
      `UPDATE media
          SET pwd_pack_enc = set_byte(pwd_pack_enc, 20, (get_byte(pwd_pack_enc, 20) + 1) % 256)
        WHERE id = $1`,
      [tampered.id],
    );
    expect(await worker().runOnce([w.ops.a])).toBe(1);
    expect(await runs(w.ops.a)).toEqual([
      { sampled: 5, mismatches: 1, status: 'MISMATCH', detail: expect.stringMatching(/1 écart/) },
    ]);
    const alerts = await rows<{
      object_id: string;
      actor_id: string | null;
      after: Record<string, unknown>;
    }>(
      `SELECT object_id, actor_id, after FROM audit_log
        WHERE operator_id = $1 AND action = 'MEDIA_PASSWORD_MISMATCH'`,
      [w.ops.a],
    );
    expect(alerts).toEqual([
      { object_id: tampered.id, actor_id: null, after: { check_run_id: expect.any(String) } },
    ]);
    // Ni l'UID, ni l'identité, ni le mot de passe dans le compte rendu ou l'alerte.
    const written = JSON.stringify([await runs(w.ops.a), alerts]);
    for (const secret of [
      tampered.uid,
      tampered.pwdPack.toString('hex'),
      tampered.identity.toString('hex'),
    ]) {
      expect(written).not.toContain(secret);
    }
    // Code de sortie de `--once` : celui du registre des travailleurs du processus.
    expect(worker().alarm()).toBe(ALARM_MISMATCH);
    expect(check.workers.alarm()).toBe(ALARM_MISMATCH);
    // Aucune anomalie ouverte (liste fermée, §12.2).
    expect(
      await rows('SELECT count(*)::int AS n FROM anomaly WHERE media_id = $1', [tampered.id]),
    ).toEqual([{ n: 0 }]);
  });

  it('panne du service de clés : ERROR sans anomalie, code d’alerte 3, pas de relance avant 15 minutes', async () => {
    // Processus dédié : son code d'alerte ne se mélange pas à celui du processus partagé.
    const own = await createKeyProcess('tag-check');
    try {
      const ownWorker = own.app.get(DailyCheckWorker, { strict: false });
      const { w } = await operatorWith(3);
      own.kms.failNext('generateMac');
      expect(await ownWorker.runOnce([w.ops.a])).toBe(0);
      expect(await runs(w.ops.a)).toEqual([
        {
          sampled: 0,
          mismatches: 0,
          status: 'ERROR',
          detail: expect.stringMatching(/Service de clés/),
        },
      ]);
      expect(ownWorker.alarm()).toBe(ALARM_KMS_ERROR);
      expect(own.workers.alarm()).toBe(ALARM_KMS_ERROR);
      // Relance immédiate : le prestataire n'est pas repris (attente de 15 minutes après une
      // panne), le service de clés n'est pas sollicité, aucun compte rendu de plus.
      own.kms.resetCalls();
      expect(await ownWorker.runOnce([w.ops.a])).toBe(0);
      expect(own.kms.calls).toMatchObject({ generateMac: 0, decrypt: 0 });
      expect(await runs(w.ops.a)).toHaveLength(1);
      expect(
        await rows('SELECT count(*)::int AS n FROM anomaly WHERE operator_id = $1', [w.ops.a]),
      ).toEqual([{ n: 0 }]);
    } finally {
      await own.app.close();
    }
  });

  /** Deux prestataires d'un même monde : A sur la clé du kit, B sur sa propre clé de bracelet. */
  const twoOperators = async (countA: number, countB: number) => {
    const w = await createMediaWorld();
    const media = await withOwner(async (db) => {
      const seed = async (operatorId: string, organizerId: string, kmsKeyRef: string, count: number) =>
        seedPersonalizedMedia(db, {
          operatorId,
          batchId: await createBatch(db, { operatorId, organizerId, quantity: count }),
          kmsKeyRef,
          count,
        });
      return {
        a: await seed(w.ops.a, w.ids.organizerA, w.keyRef.a, countA),
        b: await seed(w.ops.b, w.ids.organizerB, w.keyRef.b, countB),
      };
    });
    return { w, media };
  };

  it('clé de bracelet désactivée au service de clés, tag_key ACTIVE : écart, alerte d’audit, code 2 ; l’autre prestataire est contrôlé', async () => {
    // Processus dédié : la désactivation est propre à son faux service de clés, et son code
    // d'alerte ne se mélange pas à celui du processus partagé.
    const own = await createKeyProcess('tag-check');
    try {
      const ownWorker = own.app.get(DailyCheckWorker, { strict: false });
      const { w, media } = await twoOperators(3, 2);
      await own.kms.disableKey(w.keyRef.b);
      expect(
        await rows(`SELECT status FROM tag_key WHERE operator_id = $1`, [w.ops.b]),
      ).toEqual([{ status: 'ACTIVE' }]);

      expect(await ownWorker.runOnce([w.ops.a, w.ops.b])).toBe(2);
      expect(await runs(w.ops.b)).toEqual([
        { sampled: 2, mismatches: 2, status: 'MISMATCH', detail: expect.stringMatching(/2 écart/) },
      ]);
      const alerts = await rows<{ object_id: string }>(
        `SELECT object_id FROM audit_log
          WHERE operator_id = $1 AND action = 'MEDIA_PASSWORD_MISMATCH' ORDER BY object_id`,
        [w.ops.b],
      );
      expect(alerts.map((a) => a.object_id)).toEqual(media.b.map((m) => m.id).sort());
      expect(ownWorker.alarm()).toBe(ALARM_MISMATCH);
      expect(own.workers.alarm()).toBe(ALARM_MISMATCH);
      // Le prestataire A, dans le même passage, est contrôlé normalement.
      expect(await runs(w.ops.a)).toEqual([
        { sampled: 3, mismatches: 0, status: 'OK', detail: null },
      ]);
    } finally {
      await own.app.close();
    }
  });

  it('erreur inattendue pendant un passage : ERROR inscrit avec le nom de l’erreur, code 3 ; l’autre prestataire est contrôlé', async () => {
    const own = await createKeyProcess('tag-check');
    try {
      const ownWorker = own.app.get(DailyCheckWorker, { strict: false });
      const { w } = await twoOperators(2, 2);
      const original = own.kms.generateMac.bind(own.kms);
      const spy = jest
        .spyOn(own.kms, 'generateMac')
        .mockImplementation(async (ref: string, message: Uint8Array) => {
          if (ref === w.keyRef.b) throw new TypeError('donnée qui ne doit pas être écrite');
          return original(ref, message);
        });
      try {
        expect(await ownWorker.runOnce([w.ops.a, w.ops.b])).toBe(1);
      } finally {
        spy.mockRestore();
      }
      expect(await runs(w.ops.b)).toEqual([
        {
          sampled: 0,
          mismatches: 0,
          status: 'ERROR',
          detail: 'Erreur inattendue : TypeError ; nouvel essai dans 15 minutes au plus tôt.',
        },
      ]);
      expect(ownWorker.alarm()).toBe(ALARM_KMS_ERROR);
      expect(await runs(w.ops.a)).toEqual([
        { sampled: 2, mismatches: 0, status: 'OK', detail: null },
      ]);
    } finally {
      await own.app.close();
    }
  });

  it('bracelets retirés et clés de bracelet retirées : écartés de l’échantillon', async () => {
    const { w, media } = await operatorWith(4);
    await rows(`UPDATE media SET status = 'RETIRED' WHERE id = $1`, [media[0]!.id]);
    expect(await service().runOnce(w.ops.a)).toEqual({ status: 'OK', sampled: 3, mismatches: [] });
    const { w: w2 } = await operatorWith(2);
    await rows(`UPDATE tag_key SET status = 'RETIRED' WHERE operator_id = $1`, [w2.ops.a]);
    check.kms.resetCalls();
    expect(await service().runOnce(w2.ops.a)).toEqual({ status: 'OK', sampled: 0, mismatches: [] });
    expect(check.kms.calls).toMatchObject({ generateMac: 0, decrypt: 0 });
  });

  it('clé de données retirée encore référencée : chacun de ses bracelets est un écart', async () => {
    const { w, media } = await operatorWith(2);
    await rows(`UPDATE tag_data_key SET status = 'RETIRED' WHERE operator_id = $1`, [w.ops.a]);
    const outcome = await service().runOnce(w.ops.a);
    expect(outcome).toMatchObject({ status: 'MISMATCH', sampled: 2 });
    expect([...outcome.mismatches].sort()).toEqual(media.map((m) => m.id).sort());
    // Écart constaté sans ouvrir la clé de données ni recalculer.
    expect(check.kms.calls).toMatchObject({ generateMac: 0, decrypt: 0 });
    expect(await runs(w.ops.a)).toEqual([
      { sampled: 2, mismatches: 2, status: 'MISMATCH', detail: expect.stringMatching(/2 écart/) },
    ]);
  });

  it('clé de données chiffrée altérée (refusée par le service de clés) : écart pour ses bracelets, pas une panne', async () => {
    const { w, media } = await operatorWith(3);
    await rows(
      `UPDATE tag_data_key
          SET encrypted_dek = set_byte(encrypted_dek, 20, (get_byte(encrypted_dek, 20) + 1) % 256)
        WHERE operator_id = $1`,
      [w.ops.a],
    );
    const outcome = await service().runOnce(w.ops.a);
    expect(outcome).toMatchObject({ status: 'MISMATCH', sampled: 3 });
    expect([...outcome.mismatches].sort()).toEqual(media.map((m) => m.id).sort());
    // Une seule tentative d'ouverture pour la clé ; aucun recalcul inutile.
    expect(check.kms.calls).toMatchObject({ decrypt: 1, generateMac: 0 });
    expect((await runs(w.ops.a)).map((r) => r.status)).toEqual(['MISMATCH']);
  });

  it('isolation : un passage ne lit et n’écrit que son prestataire', async () => {
    const mine = await operatorWith(2);
    const other = await operatorWith(7);
    expect(await worker().runOnce([mine.w.ops.a])).toBe(1);
    expect(check.kms.calls.generateMac).toBe(2);
    expect(await runs(mine.w.ops.a)).toHaveLength(1);
    expect(await runs(other.w.ops.a)).toEqual([]);
  });
});
