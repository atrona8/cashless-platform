// Amorçage et appels signés des suites du processus `vendor-pin` (mission 11a, lot WP06). Écritures
// directes en base (amorçage, signalées) : commerçants, points de vente, terminaux enrôlés par les
// fonctions de la base, vendeurs par `create_vendor` avec une empreinte du vrai hacheur du processus.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { vendorPinSettings } from '../../../src/config/config';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import {
  PIN_SIG_HEADER,
  PIN_TS_HEADER,
  signCall,
} from '../../../src/vendor-pin/vendor-pin-call-signature';
import { createVendorPinProcess, testPinDigester } from '../../support/app';
import { ownerRows, createMediaWorld, type MediaWorld } from '../../support/media-fixtures';
import { TestTerminal } from '../../support/test-terminal';
import { withOwner } from '../../support/db';
import { seedPos, seedVendor, type SeededPos } from '../vendors/vendor-fixtures';

export const PIN = '314159';
export const WRONG = '000000';
export const OPEN_PATH = '/v1/internal/vendor-pin/open';
export const HASH_PATH = '/v1/internal/vendor-pin/hash';

export interface PinWorld {
  w: MediaWorld;
  app: INestApplication;
  posA: SeededPos;
  posA2: SeededPos;
  /** Clé d'appel du processus (celle de `vendorPinSettings`, hors production). */
  key: Buffer;
  terminal: () => Promise<TestTerminal>;
  vendor: (merchantId?: string, pin?: string) => Promise<string>;
  close: () => Promise<void>;
}

export async function createPinWorld(): Promise<PinWorld> {
  const w = await createMediaWorld();
  const ca = await FakeDeviceCa.inMemory();
  const posA = await withOwner((db) =>
    seedPos(db, { operatorId: w.ops.a, eventId: w.ids.eventA, name: 'Commerçant A' }),
  );
  const posA2 = await withOwner((db) =>
    seedPos(db, { operatorId: w.ops.a, eventId: w.ids.eventA, name: 'Commerçant A2' }),
  );
  const app = await createVendorPinProcess();
  const digester = testPinDigester();
  return {
    w,
    app,
    posA,
    posA2,
    key: vendorPinSettings(process.env).vendorPinCallKey,
    terminal: () =>
      withOwner((db) =>
        new TestTerminal().enroll(db, {
          operatorId: w.ops.a,
          eventId: w.ids.eventA,
          posId: posA.posId,
          mode: 'CATALOG_POS',
          ca,
        }),
      ),
    vendor: async (merchantId = posA.merchantId, pin = PIN) => {
      const pinHash = await digester.hash(pin);
      return withOwner((db) =>
        seedVendor(db, {
          operatorId: w.ops.a,
          merchantId,
          actorId: w.operatorAdminA.userId,
          displayName: `Vendeur ${randomUUID().slice(0, 8)}`,
          pinHash,
        }),
      );
    },
    close: () => app.close(),
  };
}

export interface CallOptions {
  path?: string;
  /** Corps tel qu'envoyé (octets signés) ; défaut : sérialisation de `body`. */
  raw?: string;
  /** Corps sur lequel la signature est calculée, s'il diffère de celui envoyé. */
  signedBody?: string;
  key?: Buffer;
  ts?: number;
  /** `null` : en-tête absent. */
  sig?: string | null;
  tsHeader?: string | null;
}

/** Appel d'une route interne, signé comme le fera le client de l'API (WP07). */
export function call(
  world: PinWorld,
  body: unknown,
  options: CallOptions = {},
): Promise<request.Response> {
  const path = options.path ?? OPEN_PATH;
  const raw = options.raw ?? JSON.stringify(body);
  const ts = options.ts ?? Date.now();
  const sig =
    options.sig === undefined
      ? signCall(options.key ?? world.key, ts, 'POST', path, options.signedBody ?? raw)
      : options.sig;
  let req = request(world.app.getHttpServer()).post(path).set('Content-Type', 'application/json');
  if (options.tsHeader !== null) req = req.set(PIN_TS_HEADER, options.tsHeader ?? String(ts));
  if (sig !== null) req = req.set(PIN_SIG_HEADER, sig);
  return req.send(raw);
}

export const vendorRow = async (id: string) =>
  (
    await ownerRows<{ failed_attempts: number; locked: boolean; status: string }>(
      `SELECT failed_attempts, locked_at IS NOT NULL AS locked, status FROM vendor WHERE id = $1`,
      [id],
    )
  )[0]!;

export const sessionsOf = (deviceId: string) =>
  ownerRows<{ id: string; vendor_id: string; closed_reason: string | null }>(
    `SELECT id, vendor_id, closed_reason FROM vendor_session WHERE device_id = $1 ORDER BY opened_at`,
    [deviceId],
  );

export const vendorAudit = (vendorId: string) =>
  ownerRows<{ action: string; origin: string; after: unknown }>(
    `SELECT action, origin, after FROM audit_log
      WHERE object_type = 'vendor' AND object_id = $1 ORDER BY seq`,
    [vendorId],
  );

/** Lignes d'audit du prestataire du test : jamais toute la base (suites parallèles en CI, voir PR #21). */
export const auditCount = async (operatorId: string): Promise<number> =>
  Number(
    (
      await ownerRows<{ n: string }>('SELECT count(*) AS n FROM audit_log WHERE operator_id = $1', [
        operatorId,
      ])
    )[0]!.n,
  );
