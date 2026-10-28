// Monde de test des caisses au guichet (mission 6, lot WP09) : événement en service, trois terminaux `TOPUP_DESK`
// (deux avec une session ouverte, un sans), lots de bracelets avec et sans caution, requêtes de guichet.
// Partagé par `test/integration/topups/cash-*.spec.ts`.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seedPaymentConfiguration } from '../integration/payments/payments-fixtures';
import { createTestApp } from './app';
import { withOwner } from './db';
import { createTestDevice, type TestDevice } from './fake-device';
import type { TestPerson } from './fake-idp';
import {
  createBatch,
  createMediaWorld,
  goLive,
  openCashSession,
  ownerRows as rows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from './media-fixtures';

export interface CashSession {
  sessionId: string;
  accountId: string;
  code: string;
}

export interface CashWorld {
  w: MediaWorld;
  app: INestApplication;
  device: TestDevice;
  session: CashSession;
  other: TestDevice;
  otherSession: CashSession;
  noSession: TestDevice;
  batches: { plain: string; fromBalance: string; separate: string };
  next(): number;
  /** Clé `<série>:<seq>` suivante du terminal. */
  seqKey(device: TestDevice): string;
  fresh(batchId: string): Promise<SeededMedia>;
  /** Active un bracelet au guichet (API) ; rend son portefeuille. */
  activate(media: SeededMedia, who?: TestDevice): Promise<{ walletId: string; status: number }>;
  /** `POST /topups/cash` : corps libre, terminal et personne au choix. */
  topup(
    body: object,
    options?: { device?: TestDevice; person?: TestPerson | null; key?: string },
  ): request.Test;
  /** Corps valide d'une recharge. */
  topupBody(media: SeededMedia, amount: number, extra?: Record<string, unknown>): object;
  /** Compteurs d'écriture du grand livre de l'événement. */
  counts(): Promise<{ journal: number; posting: number; sessionTx: number; consumedTaps: number }>;
  balance(code: string): Promise<number>;
  /** Plafonds de la juridiction de l'événement (anonyme) ; rend la remise en état. */
  setCaps(caps: {
    maxBalance: number | null;
    monthly: number | null;
  }): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export async function createCashWorld(): Promise<CashWorld> {
  const w = await createMediaWorld();
  let device!: TestDevice;
  let other!: TestDevice;
  let noSession!: TestDevice;
  let session!: CashSession;
  let otherSession!: CashSession;
  const batches = { plain: '', fromBalance: '', separate: '' };
  await withOwner(async (db) => {
    await seedPaymentConfiguration(db, w);
    await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
    const desk = () =>
      createTestDevice(db, { operatorId: w.ops.a, eventId: w.ids.eventA, kind: 'TOPUP' });
    device = await desk();
    other = await desk();
    noSession = await desk();
    session = await openCashSession(db, {
      operatorId: w.ops.a,
      deviceId: device.deviceId,
      userId: w.cashierA.userId,
    });
    otherSession = await openCashSession(db, {
      operatorId: w.ops.a,
      deviceId: other.deviceId,
      userId: w.cashierA.userId,
    });
    const base = {
      operatorId: w.ops.a,
      organizerId: w.ids.organizerA,
      eventId: w.ids.eventA,
      status: 'ACTIVE' as const,
    };
    batches.plain = await createBatch(db, base);
    batches.fromBalance = await createBatch(db, {
      ...base,
      depositAmount: 2000,
      depositMode: 'FROM_BALANCE',
    });
    batches.separate = await createBatch(db, {
      ...base,
      depositAmount: 1000,
      depositMode: 'SEPARATE',
    });
  });
  const app = await createTestApp({ identity: w.idp });
  let counter = 0;
  const seqs = new Map<string, number>();
  const next = () => (counter += 1);
  const seqKey = (d: TestDevice) => {
    const n = (seqs.get(d.deviceId) ?? 0) + 1;
    seqs.set(d.deviceId, n);
    return `${d.serial}:${String(n).padStart(4, '0')}`;
  };
  const fresh = (batchId: string) =>
    withOwner(
      async (db) =>
        (
          await seedPersonalizedMedia(db, {
            operatorId: w.ops.a,
            batchId,
            kmsKeyRef: w.keyRef.a,
            count: 1,
          })
        )[0]!,
    );
  const activate = async (media: SeededMedia, who: TestDevice = device) => {
    const res = await request(app.getHttpServer())
      .post('/v1/media/activations')
      .set(who.headers)
      .set('Idempotency-Key', randomUUID())
      .set('X-Staff-Authorization', `Bearer ${w.cashierA.token}`)
      .send({
        tap: tapBody(media, next()),
        channel: 'DESK',
        occurred_at: new Date().toISOString(),
      });
    return { walletId: String(res.body.wallet?.wallet_id), status: res.status };
  };
  const topup: CashWorld['topup'] = (body, options = {}) => {
    const d = options.device ?? device;
    const person = options.person === undefined ? w.cashierA : options.person;
    let req = request(app.getHttpServer())
      .post('/v1/topups/cash')
      .set(d.headers)
      .set('Idempotency-Key', options.key ?? seqKey(d));
    if (person) req = req.set('X-Staff-Authorization', `Bearer ${person.token}`);
    return req.send(body);
  };
  return {
    w,
    app,
    device,
    session,
    other,
    otherSession,
    noSession,
    batches,
    next,
    seqKey,
    fresh,
    activate,
    topup,
    topupBody: (media, amount, extra = {}) => ({
      amount,
      currency: 'XOF',
      occurred_at: new Date(Date.now() - 3_600_000).toISOString(),
      tap: tapBody(media, next()),
      ...extra,
    }),
    counts: async () => {
      const [r] = await rows<{
        journal: number;
        posting: number;
        session_tx: number;
        consumed: number;
      }>(
        `SELECT (SELECT count(*)::int FROM journal_transaction WHERE ledger_id = $1) AS journal,
                (SELECT count(*)::int FROM posting p JOIN journal_transaction t ON t.id = p.transaction_id
                  WHERE t.ledger_id = $1) AS posting,
                (SELECT count(*)::int FROM cash_session_tx WHERE operator_id = $2) AS session_tx,
                (SELECT count(*)::int FROM media_tap WHERE operator_id = $2
                  AND transaction_id IS NOT NULL) AS consumed`,
        [w.ids.ledgerA, w.ops.a],
      );
      return {
        journal: r!.journal,
        posting: r!.posting,
        sessionTx: r!.session_tx,
        consumedTaps: r!.consumed,
      };
    },
    balance: (code) =>
      rows<{ b: string }>(
        `SELECT coalesce(sum(p.amount), 0)::text AS b FROM posting p JOIN account a ON a.id = p.account_id
          WHERE a.ledger_id = $1 AND a.code = $2`,
        [w.ids.ledgerA, code],
      ).then((r) => Number(r[0]!.b)),
    setCaps: async ({ maxBalance, monthly }) => {
      // Un profil de juridiction ne se modifie pas : on rattache l'événement à une nouvelle version plafonnée.
      const [old] = await rows<{ id: string }>(
        'SELECT jurisdiction_id AS id FROM event WHERE id = $1',
        [w.ids.eventA],
      );
      const profile = randomUUID();
      await rows(
        `INSERT INTO jurisdiction_profile (id, country_code, version, valid_from, breakage_destination,
                                           unidentified_max_balance, unidentified_monthly_limit)
         VALUES ($1, 'SN', (1000000 + floor(random() * 1000000000))::int, '2026-01-01', 'ORGANIZER', $2, $3)`,
        [profile, maxBalance, monthly],
      );
      await rows('UPDATE event SET jurisdiction_id = $2 WHERE id = $1', [w.ids.eventA, profile]);
      return async () => {
        await rows('UPDATE event SET jurisdiction_id = $2 WHERE id = $1', [w.ids.eventA, old!.id]);
      };
    },
    close: () => app.close(),
  };
}
