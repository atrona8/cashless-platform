/* eslint-disable @typescript-eslint/no-explicit-any -- corps JSON du contrat lus champ par champ */
// Parcours complet de la mission hors-ligne-snapshots-lots (lot WP21, T087 ; SC-001, SC-010, FR-044), entièrement par
// l'API : HTTPS réel, terminal à trois preuves, personnes par jetons du faux fournisseur d'identité, VRAIS processus de
// snapshots (contenu, enveloppes, signataire) sur leurs rôles de base, vrai processeur de lots, vrai travailleur
// d'import. Étapes de `quickstart.md` :
//   1. plafond du prestataire puis événement au-dessus : politique effective réduite, risque maximal ;
//   2. configuration (config_id, snapshot_keys) puis FULL, signature vérifiée, mot de passe ouvert ;
//   3. bracelet bloqué : DELTA signé en 5 s au plus ;
//   4. terminal coupé : trois ventes dont 9 000 sur 6 000, une annulation ;
//   5. trou SEQ_GAP levé par deux SUPERVISOR ;
//   6. terminal révoqué : journal importé à deux, aucun nouveau snapshot enveloppé pour lui.
// Écritures directes en base : AMORÇAGE seulement (jeu d'essai de WP19/WP20, clé de signature) ; les étapes n'en font
// aucune. Chaque étape dépend de la précédente : une étape sautée fait échouer les suivantes.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { FakeKms } from '../../../src/kms/fake-kms';
import { contractViolations } from '../../support/contract-schema';
import { OWNER_URL, withOwner } from '../../support/db';
import { ownerRows } from '../../support/media-fixtures';
import {
  getSnapshot,
  openSnapshotPassword,
  personCall,
  settleClock,
  SnapshotPipeline,
  snapshotContentSha256,
  verifySnapshotSignature,
  type ServedSnapshot,
} from '../../support/offline-dataset';
import { JournalWorld } from '../offline/journal-world';
import type { OfflineTerminal } from '../offline/processing-fixtures';
import type { PayMedia } from '../payments/payments-fixtures';
import { activateKey } from '../snapshots-signer/support';

jest.setTimeout(600_000);

describe('SC-001, SC-010, SC-012 : parcours complet hors ligne, tout par l’API', () => {
  let jw: JournalWorld;
  let owner: Pool;
  let pipeline: SnapshotPipeline;
  let t: OfflineTerminal;
  let t2: OfflineTerminal;
  let media: PayMedia[];
  let spare: PayMedia[];
  let keyB64 = '';
  let keyId = '';
  const done: number[] = [];
  let version = 0;
  let lastSnapshot: ServedSnapshot;

  const pw = () => jw.pw;
  const w = () => jw.w;
  const op = () => w().ops.a;
  const config = async (term: OfflineTerminal) => {
    const res = await term.t.request(jw.api.baseUrl, jw.api.tls.serverCaPem, {
      method: 'GET',
      path: '/device/config',
    });
    expect(res.status).toBe(200);
    return res.body as any;
  };
  const snapshotFor = (term: OfflineTerminal, since?: number) => getSnapshot(jw.api, term.t, since);
  const voidOp = () => ({
    type: 'VOID',
    occurred_at: new Date().toISOString(),
    void_reason: 'ABORTED_BY_OPERATOR',
  });
  const stepDone = (n: number) => {
    expect(done).toEqual(Array.from({ length: n - 1 }, (_, i) => i + 1));
    return () => done.push(n);
  };

  beforeAll(async () => {
    jw = await JournalWorld.create();
    owner = new Pool({ connectionString: OWNER_URL, max: 2 });
    const kms = new FakeKms();
    const keyRef = `fake-kms:ecc:journey-${randomUUID()}`;
    keyId = await activateKey(owner, kms, keyRef, op());
    keyB64 = (await kms.publicKey(keyRef)).toString('base64');
    pipeline = new SnapshotPipeline({ operatorId: op(), ledgerId: pw().ledgerId }, kms, keyRef);
    // Terminaux enrôlés (session de vendeur ouverte par la route), bracelets crédités : amorçage.
    const mk = async (): Promise<OfflineTerminal> => ({
      ...(await pw().pw.terminal({ mode: 'CATALOG_POS' })),
      configId: 0,
    });
    t = await mk();
    t2 = await mk();
    media = [
      ...(await pw().pw.media(1, 20_000)), // 0 : ventes couvertes
      ...(await pw().pw.media(1, 6_000)), // 1 : 9 000 sur 6 000
      ...(await pw().pw.media(1, 20_000)), // 2 : vente de l'export importé
    ];
    spare = await pw().pw.media(2, 5_000); // bracelets à bloquer
    await settleClock();
  });
  afterAll(async () => {
    await pipeline?.close();
    await jw?.close();
    await owner?.end();
  });

  it('étape 1 : plafond puis événement au-dessus : politique effective réduite, risque maximal', async () => {
    const mark = stepDone(1);
    const ceiling = await personCall(
      jw.api,
      'PUT',
      `/operators/${op()}/offline-ceiling`,
      w().operatorAdminA,
      {
        offline_enabled: true,
        max_per_sale: 50_000,
        max_per_media_per_device: 100_000,
        max_total_per_device: 300_000,
        max_snapshot_age_seconds: 900,
      },
    );
    expect(ceiling.status).toBe(200);
    expect((ceiling.body as any).policy.max_total_per_device).toBe(300_000);
    // L'organisateur règle l'événement AU-DESSUS du plafond.
    const event = await personCall(
      jw.api,
      'PUT',
      `/events/${w().ids.eventA}/offline-policy`,
      w().organizerAdminA,
      {
        offline_enabled: true,
        max_total_per_device: 500_000,
        max_per_media_per_device: 40_000,
        max_per_sale: 20_000,
      },
    );
    expect(event.status).toBe(200);
    expect(contractViolations('OfflinePolicyLevelView', event.body)).toEqual([]);
    const device = await personCall(
      jw.api,
      'GET',
      `/devices/${t.t.deviceId}/offline-policy`,
      w().organizerAdminA,
    );
    expect(device.status).toBe(200);
    expect(device.body.effective).toMatchObject({
      offline_enabled: true,
      max_total_per_device: 300_000, // réduite au plafond
      max_per_sale: 20_000,
      capped: true,
    });
    const risk = await personCall(
      jw.api,
      'GET',
      `/events/${w().ids.eventA}/offline-risk`,
      w().organizerAdminA,
    );
    expect(risk.status).toBe(200);
    expect(contractViolations('OfflineRisk', risk.body)).toEqual([]);
    expect(risk.body).toMatchObject({ max_total_risk: 600_000, offline_devices: 2 });
    mark();
  });

  it('étape 2 : configuration (config_id, snapshot_keys) puis FULL signé, mot de passe ouvert', async () => {
    const mark = stepDone(2);
    const cfg = await config(t);
    expect(cfg.offline_policy.offline_enabled).toBe(true);
    expect(cfg.snapshot_keys).toHaveLength(1);
    expect(cfg.snapshot_keys[0].key_id).toBe(keyId);
    expect(cfg.snapshot_keys[0].public_key).toBe(keyB64);
    t.configId = Number(cfg.config_id);
    expect(t.configId).toBeGreaterThan(0);
    t2.configId = Number((await config(t2)).config_id);

    pipeline.start();
    await pipeline.until(
      async () => (await pipeline.enveloped(t.t.deviceId)).includes(1),
      120_000,
      'FULL publié et enveloppé',
    );
    const res = await snapshotFor(t);
    expect(res.status).toBe(200);
    expect(contractViolations('OfflineSnapshot', res.body)).toEqual([]);
    const snap = res.body as unknown as ServedSnapshot;
    expect(snap.header).toMatchObject({ kind: 'FULL', version: 1, key_id: keyId });
    expect(verifySnapshotSignature(snap, keyB64)).toBe(true);
    expect(snapshotContentSha256(snap)).toBe(snap.header.content_sha256);
    expect(snap.entries.length).toBe(5);
    for (const m of media) {
      const entry = snap.entries.find((e) => e.token_hash === m.media.tokenHash.toString('hex'))!;
      expect(entry.status).toBe('ACTIVE');
      expect(openSnapshotPassword(snap, t.t, pw().ledgerId, entry).equals(m.media.pwdPack)).toBe(
        true,
      );
    }
    version = 1;
    lastSnapshot = snap;
    mark();
  });

  it('étape 3 : bracelet bloqué, DELTA signé en 5 s au plus', async () => {
    const mark = stepDone(3);
    const target = spare[0]!;
    const start = Date.now();
    const blocked = await personCall(
      jw.api,
      'POST',
      `/operators/${op()}/media/${target.media.id}/blacklist`,
      jw.sup1,
      { reason: 'Bracelet perdu, signalé au guichet' },
    );
    expect(blocked.status).toBe(200);
    let delta: ServedSnapshot | null = null;
    const elapsed = await pipeline.until(
      async () => {
        const res = await snapshotFor(t, 1);
        if (res.status !== 200) return false;
        const snap = res.body as unknown as ServedSnapshot;
        if (snap.header.version <= 1) return false;
        delta = snap;
        return true;
      },
      15_000,
      'DELTA de blocage',
    );
    const total = Date.now() - start;
    process.stdout.write(`PARCOURS blocage -> DELTA servi : ${total} ms (sondage ${elapsed} ms)\n`);
    expect(total).toBeLessThanOrEqual(5000);
    const snap = delta!;
    expect(snap.header).toMatchObject({ kind: 'DELTA', base_version: 1 });
    expect(verifySnapshotSignature(snap, keyB64)).toBe(true);
    const entry = snap.entries.find((e) => e.token_hash === target.media.tokenHash.toString('hex'));
    const gone = snap.removed_token_hashes.includes(target.media.tokenHash.toString('hex'));
    expect(entry?.status !== 'ACTIVE' || gone).toBe(true);
    version = snap.header.version;
    lastSnapshot = snap;
    await pipeline.until(
      async () => (await pipeline.enveloped(t.t.deviceId)).includes(version),
      15_000,
      'enveloppe du DELTA',
    );
    mark();
  });

  it('étape 4 : terminal coupé, trois ventes dont 9 000 sur 6 000, une annulation', async () => {
    const mark = stepDone(4);
    await settleClock();
    const m0 = media[0]!;
    const m1 = media[1]!;
    const first = await pw().submit(t, [
      pw().sale(t, m0, 4000, version),
      pw().sale(t, m1, 9000, version),
      pw().sale(t, m0, 1500, version),
    ]);
    const rs = pw().results(first);
    expect(rs[0]).toMatchObject({ seq: 1, status: 'ACCEPTED', effect: 'LEDGER_WRITTEN' });
    expect(rs[1]).toMatchObject({
      seq: 2,
      status: 'ACCEPTED_WITH_SHORTFALL',
      shortfall_amount: 3000,
      charged_to_wallet: 6000,
    });
    expect(rs[2]).toMatchObject({ seq: 3, status: 'ACCEPTED' });
    expect(rs.every((r) => contractViolations('OfflineOperationResult', r).length === 0)).toBe(
      true,
    );
    const [shortfall] = await pw().anomalies(t.t.deviceId, 'OFFLINE_SHORTFALL');
    expect(shortfall).toMatchObject({ amount: '3000', status: 'OPEN' });
    expect(await pw().spendable(m1.walletId)).toBe(0);
    // Annulation de la vente partiellement couverte + recharge espèces portée par un lot (SC-010).
    const reversalSource = pw().sale(t, m1, 9000, version, { reverses_seq: 2 });
    const { amount: _amount, ...reversalRest } = reversalSource;
    const second = await pw().submit(t, [
      { ...reversalRest, type: 'REVERSAL' } as never,
      {
        type: 'TOPUP_CASH',
        occurred_at: new Date().toISOString(),
        amount: 50_000,
        currency: 'XOF',
      },
    ]);
    const rs2 = pw().results(second);
    expect(rs2[0]).toMatchObject({ seq: 4, status: 'ACCEPTED', effect: 'LEDGER_WRITTEN' });
    expect(rs2[1]).toMatchObject({
      seq: 5,
      status: 'REJECTED',
      reject_reason: 'OFFLINE_NOT_ALLOWED',
      effect: 'NONE',
      detail: 'TOPUP_CASH',
    });
    const [reduced] = await pw().anomalies(t.t.deviceId, 'OFFLINE_SHORTFALL');
    expect(reduced).toMatchObject({ amount: '0', status: 'RESOLVED' });
    expect(await pw().spendable(m1.walletId)).toBe(6000);
    const [cash] = await pw().anomalies(t.t.deviceId, 'NON_COMPLIANT_OPERATION');
    expect(cash).toMatchObject({ amount: '50000', seq: '5' });
    const cashRows = await ownerRows<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_transaction WHERE ledger_id = $1 AND type = 'TOPUP_CASH'
          AND device_id = $2`,
      [pw().ledgerId, t.t.deviceId],
    );
    expect(cashRows[0]!.n).toBe(0);
    mark();
  });

  it('étape 5 : trou SEQ_GAP levé par deux SUPERVISOR (la même personne est refusée)', async () => {
    const mark = stepDone(5);
    // Numéros 1 à 5 reçus ; le suivant (6) manque, le lot commence à 7.
    const gap = await pw().submit(t, [voidOp(), voidOp()], { fromSeq: 7 });
    expect(gap.status).toBe(200);
    expect(gap.body.missing_seqs).toEqual([6]);
    const [anomaly] = await pw().anomalies(t.t.deviceId, 'SEQ_GAP');
    expect(anomaly).toMatchObject({ seq: '6', status: 'OPEN' });
    const asked = await jw.bo('POST', `/devices/${t.t.deviceId}/seq-gaps/6/waive`, jw.sup1, {
      reason: 'Terminal redémarré, journal local perdu.',
    });
    expect(asked.status).toBe(202);
    const self = await jw.approve(asked.body.approval_request_id, jw.sup1);
    expect(self.status).toBe(409);
    const approved = await jw.approve(asked.body.approval_request_id, jw.sup2);
    expect(approved.status).toBe(200);
    expect(approved.body.result).toMatchObject({ contiguous_acked_seq: 8, missing_seqs: [] });
    const waived = await ownerRows<{ seq: string; outcome: string; approved_by: string }>(
      `SELECT seq::text, outcome, approved_by FROM device_seq_registry
        WHERE device_id = $1 AND outcome = 'WAIVED'`,
      [t.t.deviceId],
    );
    expect(waived).toEqual([{ seq: '6', outcome: 'WAIVED', approved_by: jw.sup2.userId }]);
    const [resolved] = await pw().anomalies(t.t.deviceId, 'SEQ_GAP');
    expect(resolved!.status).toBe('RESOLVED');
    mark();
  });

  it('étape 6 : terminal révoqué, journal importé à deux, aucun nouveau snapshot enveloppé pour lui', async () => {
    const mark = stepDone(6);
    // Journal exporté du terminal (non envoyé au serveur), puis terminal révoqué.
    const [batch] = jw.exportBatches(t, [[jw.sale(t, media[2]!, 2500, version, 3)]]);
    await settleClock();
    await jw.revoke(t);
    const before = await pipeline.enveloped(t.t.deviceId);
    const request = await jw.requestImport(jw.sup1, t.t.deviceId, [batch!.body]);
    expect(request.status).toBe(202);
    const approved = await jw.approve(request.body.approval_request_id, jw.sup2);
    expect(approved.status).toBe(200);
    const importId = (await jw.requestRow(request.body.approval_request_id)).target_id;
    const final = await jw.runUntilFinal(importId);
    expect(final.status).toBe('APPLIED');
    expect(final.approved_by).toBe(jw.sup2.userId);
    expect(await pw().spendable(media[2]!.walletId)).toBe(17_500);
    const imported = await pw().txRows(t.t.deviceId);
    // Trois ventes du lot reçu en ligne + la vente importée, toutes OFFLINE_SYNC.
    const sales = imported.filter((x) => x.type === 'PURCHASE');
    expect(sales).toHaveLength(4);
    expect(sales.every((x) => x.source === 'OFFLINE_SYNC')).toBe(true);
    expect(sales.filter((x) => x.metadata.batch_id === batch!.header.batch_id)).toHaveLength(1);
    // Un nouveau changement bloquant : le second terminal reçoit sa version enveloppée, le révoqué aucune.
    const latest = await pipeline.latestVersion();
    const blocked = await personCall(
      jw.api,
      'POST',
      `/operators/${op()}/media/${spare[1]!.media.id}/blacklist`,
      jw.sup1,
      { reason: 'Second bracelet signalé' },
    );
    expect(blocked.status).toBe(200);
    await pipeline.until(
      async () => (await pipeline.enveloped(t2.t.deviceId)).some((v) => v > latest),
      30_000,
      'nouvelle version enveloppée pour le second terminal',
    );
    expect(await pipeline.enveloped(t.t.deviceId)).toEqual(before);
    expect(lastSnapshot.header.version).toBe(version);
    mark();
  });

  it('le parcours a franchi les six étapes', () => {
    expect(done).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('SC-012 : les travailleurs de snapshots n’ont levé aucune erreur', () => {
    expect(pipeline.errors).toEqual([]);
    void withOwner;
  });
});
