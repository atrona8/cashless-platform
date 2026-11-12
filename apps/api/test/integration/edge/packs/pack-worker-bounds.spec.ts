// Bornes du travailleur de colis (WP15, cycle 2 ; ADR-184, décisions 43 et 44) : source de dérivation
// figée, AAD de scellement épinglée, liste de prestataires, bracelet illisible.
import { createECDH, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Client } from 'pg';
import { fromWrappedKey, openForRecipient, pwdPackAad, sealPwdPack } from '@cashless/tag-format';
import { APP_CONFIG, type AppConfig } from '../../../../src/config/config';
import { sealedKeyAad } from '../../../../src/edge/packs/pack-sealing';
import { EdgePacksService } from '../../../../src/edge/packs/edge-packs.service';
import { createKeyProcess, type KeyProcessApp } from '../../../support/app';
import { connect, OWNER_URL } from '../../../support/db';
import {
  addGateway,
  newEvent,
  seedEdgeWorld,
  type EdgeWorld,
} from '../../../support/edge-fixtures';

interface Planted {
  world: EdgeWorld;
  gatewayId: string;
  ledgerId: string;
  keys: ReturnType<typeof createECDH>;
  oldDek: Buffer;
  newDek: Buffer;
  media: string[];
}

describe('bornes du travailleur de colis (WP15 cycle 2)', () => {
  let owner: Client;
  let boot: KeyProcessApp;
  let config: AppConfig;
  const logged: string[] = [];
  const spies: jest.SpyInstance[] = [];
  const saved = process.env.EDGE_PACK_OPERATORS;

  /** Prestataire complet : deux clés de données d'âges différents, une PRIMARY éligible, bracelets. */
  async function plant(unreadable = 0, readable = 1): Promise<Planted> {
    const world = await seedEdgeWorld(owner);
    const keyIndex = 150 + Math.floor(Math.random() * 100);
    await owner.query(
      `INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ($1, $2, $3)`,
      [world.operatorId, keyIndex, `fake-kms:hmac:${randomUUID()}`],
    );
    const old = await boot.kms.generateDataKey(config.tagWrappingKeyRef);
    const recent = await boot.kms.generateDataKey(config.tagWrappingKeyRef);
    const ids: string[] = [];
    for (const [dek, version, age, status] of [
      [recent, 2, '0 days', 'ACTIVE'],
      [old, 1, '2 days', 'DECRYPT_ONLY'],
    ] as const) {
      const r = await owner.query<{ id: string }>(
        `INSERT INTO tag_data_key (operator_id, key_index, version, wrapping_kms_key_ref,
                                   encrypted_dek, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, now() - $7::interval) RETURNING id`,
        [world.operatorId, keyIndex, version, config.tagWrappingKeyRef, dek.encrypted, status, age],
      );
      ids.push(r.rows[0]!.id);
    }
    const oldId = ids[1]!;
    const event = await newEvent(owner, world);
    await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
    const batch = await owner.query<{ id: string }>(
      `INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index)
       VALUES ($1, (SELECT organizer_id FROM event WHERE id = $2), $2, 'PUBLIC', 10, $3)
       RETURNING id`,
      [world.operatorId, event.eventId, keyIndex],
    );
    const media: string[] = [];
    for (let n = 0; n < unreadable + readable; n += 1) {
      const id = randomUUID();
      const uid = randomBytes(7);
      const blob =
        n < unreadable
          ? randomBytes(34)
          : sealPwdPack({
              dek: old.plaintext,
              nonce: randomBytes(12),
              pwdPack: randomBytes(6),
              aad: pwdPackAad({ mediaId: id, operatorId: world.operatorId, keyIndex, uid }),
            });
      await owner.query(
        `INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index,
                            status, personalized_at, pwd_pack_enc, pwd_pack_dek_id)
         VALUES ($1, $2, 'NFC_TAG', $3, $4, $5, $6, 'PERSONALIZED', now(), $7, $8)`,
        [
          id,
          world.operatorId,
          createHash('sha256').update(id).digest(),
          uid,
          batch.rows[0]!.id,
          keyIndex,
          blob,
          oldId,
        ],
      );
      media.push(id);
    }
    const gatewayId = await addGateway(owner, world, event.eventId, {
      sha256: randomBytes(32),
      role: 'PRIMARY',
    });
    const keys = createECDH('prime256v1');
    keys.generateKeys();
    await owner.query(
      `UPDATE edge_gateway SET agreement_public_key = $2,
              registered_at = now() - interval '2 hours', role_changed_at = now() - interval '2 hours'
        WHERE id = $1`,
      [gatewayId, keys.getPublicKey()],
    );
    return {
      world,
      gatewayId,
      ledgerId: event.ledgerId,
      keys,
      oldDek: old.plaintext,
      newDek: recent.plaintext,
      media,
    };
  }

  const deposits = async (gatewayId: string) =>
    (await owner.query('SELECT 1 FROM edge_pwd_pack_key WHERE gateway_id = $1', [gatewayId]))
      .rowCount;
  const packs = async (gatewayId: string) =>
    (await owner.query('SELECT 1 FROM edge_pwd_pack WHERE gateway_id = $1', [gatewayId])).rowCount;
  const hkdf = (dek: Buffer, p: Planted) =>
    Buffer.from(
      hkdfSync(
        'sha256',
        dek,
        createHash('sha256').update(p.keys.getPublicKey()).digest(),
        Buffer.from(`CASHLESS/PWDPACK-CONTENT/v1|${p.gatewayId}`, 'ascii'),
        32,
      ),
    );

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    delete process.env.EDGE_PACK_OPERATORS;
    boot = await createKeyProcess('tag-keys');
    config = boot.app.get<AppConfig>(APP_CONFIG, { strict: false });
    for (const level of ['log', 'error', 'warn', 'debug', 'verbose'] as const)
      spies.push(
        jest.spyOn(Logger.prototype, level).mockImplementation((...a: unknown[]) => {
          logged.push(a.map(String).join(' '));
        }),
      );
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    if (saved === undefined) delete process.env.EDGE_PACK_OPERATORS;
    else process.env.EDGE_PACK_OPERATORS = saved;
    await boot?.app.close();
    await owner?.end();
  });

  it('clé de contenu = dérivée de la PLUS ANCIENNE clé de données, AAD épinglée en dur', async () => {
    const p = await plant();
    expect(
      await boot.app.get(EdgePacksService, { strict: false }).runOnce([p.world.operatorId]),
    ).toBeGreaterThanOrEqual(2);
    const row = await owner.query<{ wrapped_key: never }>(
      'SELECT wrapped_key FROM edge_pwd_pack_key WHERE gateway_id = $1',
      [p.gatewayId],
    );
    // Vecteur littéral, identique à `sealedKeyAad` de la passerelle (pack-crypto.ts, WP23).
    const literal = Buffer.from(
      `CASHLESS/PWDPACK-KEY/EDGE/v1|${p.ledgerId}|${p.gatewayId}`,
      'ascii',
    );
    expect(sealedKeyAad(p.ledgerId, p.gatewayId).equals(literal)).toBe(true);
    const opened = openForRecipient({
      recipientPrivateKey: p.keys.getPrivateKey(),
      blob: fromWrappedKey(row.rows[0]!.wrapped_key),
      aad: literal,
    });
    expect(opened.equals(hkdf(p.oldDek, p))).toBe(true);
    expect(opened.equals(hkdf(p.newDek, p))).toBe(false);
  });

  it('liste vide : aucun dépôt et un message ; prestataire non listé : jamais servi', async () => {
    const a = await plant();
    const b = await plant();
    logged.length = 0;
    expect(await boot.app.get(EdgePacksService, { strict: false }).runOnce()).toBe(0);
    expect(logged.join(' ')).toContain('EDGE_PACK_OPERATORS');
    expect(await deposits(a.gatewayId)).toBe(0);
    expect(await deposits(b.gatewayId)).toBe(0);

    process.env.EDGE_PACK_OPERATORS = a.world.operatorId;
    const listed = await createKeyProcess('tag-keys');
    try {
      expect(
        await listed.app.get(EdgePacksService, { strict: false }).runOnce(),
      ).toBeGreaterThanOrEqual(2);
    } finally {
      delete process.env.EDGE_PACK_OPERATORS;
      await listed.app.close();
    }
    expect(await deposits(a.gatewayId)).toBe(1);
    expect(await deposits(b.gatewayId)).toBe(0);
    expect(await packs(b.gatewayId)).toBe(0);
  });

  it('UUID mal formé dans EDGE_PACK_OPERATORS : le processus refuse de démarrer', async () => {
    process.env.EDGE_PACK_OPERATORS = `${randomUUID()},pas-un-uuid`;
    try {
      await expect(createKeyProcess('tag-keys')).rejects.toThrow('EDGE_PACK_OPERATORS');
    } finally {
      delete process.env.EDGE_PACK_OPERATORS;
    }
  });

  it('bracelet illisible : écarté, journalisé une fois, ne bloque pas les autres', async () => {
    const p = await plant(1, 2);
    logged.length = 0;
    const service = boot.app.get(EdgePacksService, { strict: false });
    await service.runOnce([p.world.operatorId]);
    expect(await packs(p.gatewayId)).toBe(2);
    await service.runOnce([p.world.operatorId]);
    const bad = logged.filter((l) => l.includes(p.media[0]!) && l.includes('illisible'));
    expect(bad).toHaveLength(1);
  });

  it('page entièrement illisible : journalisée une fois, sans UID ni secret (OP-N115)', async () => {
    const p = await plant(200, 0);
    logged.length = 0;
    const service = boot.app.get(EdgePacksService, { strict: false });
    await service.runOnce([p.world.operatorId]);
    await service.runOnce([p.world.operatorId]);
    const lines = logged.filter((l) => l.includes('page entièrement illisible'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(p.gatewayId);
    expect(lines[0]).toContain('200');
    const uids = await owner.query<{ nfc_uid: Buffer }>(
      'SELECT nfc_uid FROM media WHERE id = ANY($1)',
      [p.media],
    );
    for (const row of uids.rows) expect(lines[0]).not.toContain(row.nfc_uid.toString('hex'));
  });
});
