// Jeu d'essai des paiements (mission 5b, lot WP11) : prestataire A, événement EN SERVICE, point de vente d'un
// commerçant avec son catalogue, vendeur au PIN connu, terminaux enrôlés par les fonctions de la base (HTTPS
// réel, trois preuves), bracelets activés sur des portefeuilles crédités, jetons du QR client amorcés par
// `create_customer_qr_token` (fonction de la base de WP05).
//
// Écritures directes en base : AMORÇAGE seulement (commerçants, points de vente, vendeurs par `create_vendor`,
// catalogue par ses fonctions, portefeuilles, crédits, bracelets, clients). Toute vente passe par la route.
import { randomBytes, randomUUID } from 'node:crypto';
import { FakeDeviceCa } from '../../../src/device-ca/fake-device-ca';
import { DeviceTokenService } from '../../../src/device-tokens/device-token.service';
import { qrTokenHash } from '../../../src/payments/qr-token-hash';
import { VendorPinHasher } from '../../../src/vendor-pin/vendor-pin.hasher';
import { startHttpsApp, type HttpsTestApp } from '../../support/app';
import { withOwner } from '../../support/db';
import {
  activateMedia,
  createBatch,
  createMediaWorld,
  creditWallet,
  goLive,
  ownerRows,
  seedPersonalizedMedia,
  tapBody,
  type MediaWorld,
  type SeededMedia,
} from '../../support/media-fixtures';
import {
  TestTerminal,
  type TerminalMode,
  type TerminalOs,
  type TerminalResponse,
} from '../../support/test-terminal';
import {
  asOperator,
  assignPos,
  seedPos,
  seedVendor,
  type SeededPos,
} from '../vendors/vendor-fixtures';

export const PIN = '135790';
export const CURRENCY = 'XOF';

/**
 * Configuration MINIMALE que le résolveur RÉEL exige pour écrire une vente : contrat prestataire–organisateur
 * rattaché à l'événement (casse, pertes, écarts de caisse). Ni règle de frais, ni taxe : la vente se fait sans
 * commission. Amorçage du propriétaire seulement.
 */
export async function seedPaymentConfiguration(
  db: Parameters<Parameters<typeof withOwner>[0]>[0],
  w: MediaWorld,
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO contract (operator_id, kind, counterparty_id, valid_from, offline_loss_bearer,
                           cash_diff_bearer, breakage_organizer_bps)
     VALUES ($1, 'OPERATOR_ORGANIZER', $2, '2026-01-01', 'ORGANIZER', 'ORGANIZER', 10000) RETURNING id`,
    [w.ops.a, w.ids.organizerA],
  );
  await db.query('UPDATE event SET contract_id = $2 WHERE id = $1', [w.ids.eventA, rows[0]!.id]);
}

export interface CatalogItem {
  id: string;
  label: string;
  price: number;
}

export interface PayMedia {
  media: SeededMedia;
  walletId: string;
  /** Dernier compteur de lecture envoyé pour ce bracelet (croissant). */
  counter: number;
}

export interface PayTerminal {
  t: TestTerminal;
  /** Session de vendeur ouverte, ou `null`. */
  sessionId: string | null;
}

export interface PayOptions {
  /** Clé complète ; défaut : `<serial>:<seq>` suivant du terminal. */
  key?: string;
  /** `X-Authority-Epoch` ; défaut `0` ; `null` : en-tête absent. */
  epoch?: string | null;
  language?: string;
}

export class PaymentWorld {
  w!: MediaWorld;
  api!: HttpsTestApp;
  ca!: FakeDeviceCa;
  tokens!: DeviceTokenService;
  hasher!: VendorPinHasher;
  pos!: SeededPos;
  vendorId!: string;
  vendorName = 'Awa du bar';
  items: CatalogItem[] = [];
  batchId = '';

  static async create(): Promise<PaymentWorld> {
    const world = new PaymentWorld();
    world.w = await createMediaWorld();
    world.api = await startHttpsApp(undefined, { identity: world.w.idp });
    world.ca = await FakeDeviceCa.fromFiles({
      certFile: world.api.tls.deviceCaCertFile,
      keyFile: world.api.tls.deviceCaFakeKeyFile,
    });
    world.tokens = world.api.app.get(DeviceTokenService, { strict: false });
    world.hasher = world.api.app.get(VendorPinHasher, { strict: false });
    const pinHash = await world.hasher.hash(PIN);
    await withOwner(async (db) => {
      await seedPaymentConfiguration(db, world.w);
      await goLive(db, world.w.ops.a, world.w.ids.eventA, world.w.operatorAdminA.userId);
      world.pos = await seedPos(db, {
        operatorId: world.w.ops.a,
        eventId: world.w.ids.eventA,
        name: 'Bar du festival',
      });
      await asOperator(db, world.w.ops.a, () =>
        db.query('SELECT open_participation_account($1)', [world.pos.participationId]),
      );
      world.vendorId = await seedVendor(db, {
        operatorId: world.w.ops.a,
        merchantId: world.pos.merchantId,
        actorId: world.w.operatorAdminA.userId,
        displayName: world.vendorName,
        pinHash,
      });
      world.batchId = await createBatch(db, {
        operatorId: world.w.ops.a,
        organizerId: world.w.ids.organizerA,
        eventId: world.w.ids.eventA,
        status: 'ACTIVE',
      });
      world.items = await world.seedCatalog(db, world.pos.posId, [
        ['Bière', 'Beer', 3000],
        ['Sandwich', 'Sandwich', 1500],
      ]);
    });
    return world;
  }

  close(): Promise<void> {
    return this.api.close();
  }

  /** Catalogue du point de vente par les fonctions de la base (une version par écriture). */
  async seedCatalog(
    db: Parameters<Parameters<typeof withOwner>[0]>[0],
    posId: string,
    items: Array<[string, string, number]>,
  ): Promise<CatalogItem[]> {
    const actor = this.w.operatorAdminA.userId;
    return asOperator(db, this.w.ops.a, async () => {
      const category = (
        await db.query<{ id: string }>(
          'SELECT id FROM create_catalog_category($1, $2, $3, 0, $4)',
          [posId, 'Boissons', 'Drinks', actor],
        )
      ).rows[0]!.id;
      const created: CatalogItem[] = [];
      for (const [fr, en, price] of items) {
        const row = await db.query<{ id: string }>(
          'SELECT id FROM create_catalog_item($1, $2, $3, $4, 1800, $5)',
          [category, fr, en, price, actor],
        );
        created.push({ id: row.rows[0]!.id, label: fr, price });
      }
      return created;
    });
  }

  /** Terminal enrôlé (HTTPS réel) du point de vente du jeu d'essai, session de vendeur ouverte par la route. */
  async terminal(
    options: {
      mode?: TerminalMode;
      os?: TerminalOs;
      posId?: string | null;
      session?: boolean;
      nfcEnabled?: boolean;
      /** Vendeur de la session ouverte (défaut : celui du jeu d'essai). */
      vendorId?: string;
    } = {},
  ): Promise<PayTerminal> {
    const mode = options.mode ?? 'CATALOG_POS';
    const t = await withOwner((db) =>
      new TestTerminal(options.os ?? 'ANDROID').enroll(db, {
        operatorId: this.w.ops.a,
        eventId: this.w.ids.eventA,
        posId: options.posId === undefined ? this.pos.posId : options.posId,
        mode,
        ca: this.ca,
      }),
    );
    await t.issueToken(this.tokens);
    if (options.nfcEnabled === false)
      await withOwner((db) =>
        db.query('UPDATE device SET nfc_enabled = false WHERE id = $1', [t.deviceId]),
      );
    const terminal: PayTerminal = { t, sessionId: null };
    if (options.session !== false && mode !== 'TOPUP_DESK')
      await this.openSession(terminal, options.vendorId);
    return terminal;
  }

  async openSession(terminal: PayTerminal, vendorId = this.vendorId): Promise<string> {
    const res = await terminal.t.request(this.api.baseUrl, this.api.tls.serverCaPem, {
      method: 'POST',
      path: '/vendor-sessions',
      body: { vendor_id: vendorId, pin: PIN },
      idempotencyKey: randomUUID(),
    });
    if (res.status !== 201) throw new Error(`session refusée : ${res.status} ${res.text}`);
    terminal.sessionId = String(res.body.vendor_session_id);
    return terminal.sessionId;
  }

  /** Bracelets activés, un portefeuille chacun, crédités de `funds` (payé). */
  async media(count: number, funds = 20_000): Promise<PayMedia[]> {
    const walletIds = Array.from({ length: count }, () => randomUUID());
    const media = await withOwner(async (db) => {
      for (const walletId of walletIds) {
        await db.query('INSERT INTO wallet (id, operator_id, ledger_id) VALUES ($1, $2, $3)', [
          walletId,
          this.w.ops.a,
          this.w.ids.ledgerA,
        ]);
        // Comptes du portefeuille (créés par la route d'activation en production).
        for (const [suffix, purpose] of [
          ['P', 'WALLET_PAID'],
          ['X', 'WALLET_PROMO'],
        ] as const)
          await db.query(
            `INSERT INTO account (operator_id, ledger_id, code, family, purpose, wallet_id, normal_side)
             VALUES ($1, $2, $3, 'CLAIM', $4, $5, 'C')`,
            [this.w.ops.a, this.w.ids.ledgerA, `L-WAL-${walletId}-${suffix}`, purpose, walletId],
          );
      }
      const seeded = await seedPersonalizedMedia(db, {
        operatorId: this.w.ops.a,
        batchId: this.batchId,
        kmsKeyRef: this.w.keyRef.a,
        count,
      });
      for (const [i, m] of seeded.entries())
        await activateMedia(db, {
          operatorId: this.w.ops.a,
          eventId: this.w.ids.eventA,
          walletId: walletIds[i]!,
          mediaIds: [m.id],
        });
      if (funds > 0)
        for (const walletId of walletIds)
          await creditWallet(db, {
            operatorId: this.w.ops.a,
            ledgerId: this.w.ids.ledgerA,
            walletId,
            amount: funds,
          });
      return seeded;
    });
    return media.map((m, i) => ({ media: m, walletId: walletIds[i]!, counter: 0 }));
  }

  /** Lecture embarquée neuve (compteur croissant) d'un bracelet. */
  tap(m: PayMedia): Record<string, unknown> {
    m.counter += 1;
    return tapBody(m.media, m.counter);
  }

  /** `POST /taps` : lecture enregistrée par le terminal ; rend son `tap_id`. */
  async readTap(terminal: PayTerminal, m: PayMedia): Promise<number> {
    const res = await terminal.t.request(this.api.baseUrl, this.api.tls.serverCaPem, {
      method: 'POST',
      path: '/taps',
      body: this.tap(m),
    });
    if (res.status !== 200 || res.body.result !== 'OK')
      throw new Error(`lecture refusée : ${res.status} ${res.text}`);
    return Number(res.body.tap_id);
  }

  /** Jeton de QR client, amorcé par `create_customer_qr_token` ; le portefeuille reçoit un client. */
  async customerQr(walletId: string, token = randomBytes(9).toString('base64url').slice(0, 12)) {
    await withOwner(async (db) => {
      const customer = randomUUID();
      await db.query(
        `INSERT INTO party (id, kind, operator_id, legal_name, country_code) VALUES ($1, 'CUSTOMER', $2, 'Client de test', 'SN')`,
        [customer, this.w.ops.a],
      );
      await db.query('UPDATE wallet SET customer_id = $2 WHERE id = $1', [walletId, customer]);
      await asOperator(db, this.w.ops.a, () =>
        db.query('SELECT * FROM create_customer_qr_token($1, $2, $3)', [
          customer,
          walletId,
          qrTokenHash(token),
        ]),
      );
    });
    return token;
  }

  /** Corps d'une vente au catalogue : `qty` de chaque article désigné (indices de `items`). */
  catalogBody(
    terminal: PayTerminal,
    means: Record<string, unknown>,
    sale: Array<[item: number, qty: number]> = [[0, 2]],
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const lines = sale.map(([i, quantity]) => ({
      product_id: this.items[i]!.id,
      quantity,
      unit_price: this.items[i]!.price,
    }));
    return {
      amount: lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0),
      currency: CURRENCY,
      occurred_at: new Date().toISOString(),
      vendor_session_id: terminal.sessionId,
      lines,
      ...means,
      ...overrides,
    };
  }

  /** Corps d'une vente au TPE simplifié (montant saisi, aucune ligne). */
  keypadBody(
    terminal: PayTerminal,
    means: Record<string, unknown>,
    amount = 4000,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      amount,
      currency: CURRENCY,
      occurred_at: new Date().toISOString(),
      vendor_session_id: terminal.sessionId,
      ...means,
      ...overrides,
    };
  }

  /** `POST /payments` par le terminal (trois preuves). */
  pay(terminal: PayTerminal, body: unknown, options: PayOptions = {}): Promise<TerminalResponse> {
    const headers: Record<string, string | null> = {
      'x-authority-epoch': options.epoch === undefined ? '0' : options.epoch,
    };
    if (options.language) headers['accept-language'] = options.language;
    return terminal.t.request(
      this.api.baseUrl,
      this.api.tls.serverCaPem,
      {
        method: 'POST',
        path: '/payments',
        body,
        idempotencyKey: options.key ?? terminal.t.seqKey(),
      },
      { headers },
    );
  }

  get(terminal: PayTerminal, transactionId: string): Promise<TerminalResponse> {
    return terminal.t.request(this.api.baseUrl, this.api.tls.serverCaPem, {
      method: 'GET',
      path: `/payments/${transactionId}`,
    });
  }

  // ------------------------------------------------------------------------------ lectures de l'état

  /** Nombre d'écritures d'un type pour un terminal. */
  async salesOf(deviceId: string): Promise<number> {
    return Number(
      (
        await ownerRows<{ n: number }>(
          `SELECT count(*)::int AS n FROM journal_transaction WHERE device_id = $1 AND type = 'PURCHASE'`,
          [deviceId],
        )
      )[0]!.n,
    );
  }

  /** Tout ce qu'un paiement laisse derrière lui, pour un terminal (NFR-006 : rien sur un refus). */
  async footprint(deviceId: string) {
    return (
      await ownerRows<{
        sales: number;
        lines: number;
        attributions: number;
        consumed: number;
        taps: number;
        accepted: number;
        rejected: number;
        confirmed: number;
      }>(
        `SELECT (SELECT count(*)::int FROM journal_transaction WHERE device_id = $1) AS sales,
                (SELECT count(*)::int FROM sale_line l JOIN journal_transaction t ON t.id = l.transaction_id WHERE t.device_id = $1) AS lines,
                (SELECT count(*)::int FROM sale_attribution WHERE device_id = $1) AS attributions,
                (SELECT count(*)::int FROM media_tap WHERE device_id = $1 AND transaction_id IS NOT NULL) AS consumed,
                (SELECT count(*)::int FROM media_tap WHERE device_id = $1) AS taps,
                (SELECT count(*)::int FROM device_seq_registry WHERE device_id = $1 AND outcome = 'ACCEPTED') AS accepted,
                (SELECT count(*)::int FROM device_seq_registry WHERE device_id = $1 AND outcome = 'REJECTED') AS rejected,
                (SELECT count(*)::int FROM payment_request WHERE device_id = $1 AND status = 'CONFIRMED') AS confirmed`,
        [deviceId],
      )
    )[0]!;
  }

  registry(deviceId: string) {
    return ownerRows<{
      seq: string;
      outcome: string;
      reason: string | null;
      transaction_id: string | null;
      channel: string;
      content_sha256: Buffer;
    }>(
      `SELECT r.seq::text AS seq, r.outcome, r.reason, r.transaction_id, r.channel, r.content_sha256
         FROM device_seq_registry r WHERE r.device_id = $1 ORDER BY r.seq`,
      [deviceId],
    );
  }

  async spendable(walletId: string): Promise<number> {
    return Number(
      (await ownerRows<{ s: string }>('SELECT wallet_spendable($1)::text AS s', [walletId]))[0]!.s,
    );
  }

  /** Autre point de vente du même événement (autre commerçant), avec son catalogue et son compte. */
  async newPos(
    items: Array<[string, string, number]> = [['Jus', 'Juice', 1000]],
  ): Promise<{ pos: SeededPos; items: CatalogItem[]; vendorId: string }> {
    return withOwner(async (db) => {
      const pos = await seedPos(db, {
        operatorId: this.w.ops.a,
        eventId: this.w.ids.eventA,
        name: 'Autre commerçant',
      });
      await asOperator(db, this.w.ops.a, () =>
        db.query('SELECT open_participation_account($1)', [pos.participationId]),
      );
      const vendorId = await seedVendor(db, {
        operatorId: this.w.ops.a,
        merchantId: pos.merchantId,
        actorId: this.w.operatorAdminA.userId,
        displayName: 'Vendeur de l’autre commerçant',
        pinHash: await this.hasher.hash(PIN),
      });
      return { pos, items: await this.seedCatalog(db, pos.posId, items), vendorId };
    });
  }

  /** Nouveau prix d'un article (une nouvelle version du catalogue du point de vente). */
  setPrice(itemId: string, price: number): Promise<unknown> {
    return withOwner((db) =>
      asOperator(db, this.w.ops.a, () =>
        db.query('SELECT * FROM update_catalog_item($1, NULL, NULL, NULL, $2, NULL, NULL, $3)', [
          itemId,
          price,
          this.w.operatorAdminA.userId,
        ]),
      ),
    );
  }

  /** Le terminal reçoit la version courante du catalogue (comme `GET /device/config`). */
  serveCatalog(deviceId: string): Promise<unknown> {
    return withOwner((db) =>
      asOperator(db, this.w.ops.a, () =>
        db.query('SELECT * FROM record_device_catalog_served($1)', [deviceId]),
      ),
    );
  }

  assign(deviceId: string, posId: string): Promise<void> {
    return withOwner((db) => assignPos(db, deviceId, posId));
  }
}
