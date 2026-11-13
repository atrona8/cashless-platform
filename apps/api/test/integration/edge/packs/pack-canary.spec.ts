// Canari des colis de mots de passe (WP15, T068 ; C-009, NFR-003) : le travailleur du processus
// `tag-keys` dépose
// clé de contenu et colis pour une PRIMARY ; la passerelle (clé d'accord privée du test) les rouvre
// ; le mot de passe
// connu du test n'apparaît en clair NI dans le colis, NI dans la base, NI dans la page de
// réplication, NI dans les
// journaux du travailleur, sous toutes ses représentations. Contrôle positif : un journal
// volontairement fautif est vu.
import { createECDH, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Client } from 'pg';
import {
  fromWrappedKey,
  openForRecipient,
  openPwdPack,
  pwdPackAad,
  sealPwdPack,
  type WrappedKey,
} from '@cashless/tag-format';
import { APP_CONFIG, type AppConfig } from '../../../../src/config/config';
import { EdgePacksService } from '../../../../src/edge/packs/edge-packs.service';
import { sealedKeyAad } from '../../../../src/edge/packs/pack-sealing';
import { DATA_KEY_PORT, KEY_ADMIN_PORT, MAC_PORT } from '../../../../src/kms/kms.ports';
import { createKeyProcess, type KeyProcessApp } from '../../../support/app';
import { connect, EDGE_URL, OWNER_URL } from '../../../support/db';
import {
  addGateway,
  newEvent,
  seedEdgeWorld,
  type EdgeWorld,
} from '../../../support/edge-fixtures';

/** PWD (4) ‖ PACK (2) connu du test. */
const CANARY = Buffer.from('Zq7#kX', 'ascii');

/** Toutes les représentations lisibles du canari (le brut est cherché à part dans les tampons). */
function forms(secret: Buffer): string[] {
  return [
    secret.toString('utf8'),
    secret.toString('hex'),
    secret.toString('base64'),
    secret.toString('base64url'),
    secret.toString('hex').toUpperCase(),
  ];
}
const leaks = (haystack: string | Buffer, secret: Buffer = CANARY): boolean => {
  const text = typeof haystack === 'string' ? haystack : haystack.toString('latin1');
  const bin = typeof haystack === 'string' ? Buffer.from(haystack, 'latin1') : haystack;
  return forms(secret).some((f) => text.includes(f)) || bin.includes(secret);
};

describe('canari des colis de mots de passe (WP15)', () => {
  let owner: Client;
  let world: EdgeWorld;
  let proc: KeyProcessApp;
  let config: AppConfig;
  const logged: string[] = [];
  const spies: jest.SpyInstance[] = [];
  const keyIndex = 150 + Math.floor(Math.random() * 100);
  let dekId: string;
  let dek: Buffer;
  let batchId: string;
  const gatewayKeys = createECDH('prime256v1');

  const runWorker = () =>
    proc.app.get(EdgePacksService, { strict: false }).runOnce([world.operatorId]);

  /** Bracelet personnalisé comme à la personnalisation : PWD‖PACK scellé sous la clé de données. */
  async function plantMedia(pwdPack: Buffer): Promise<string> {
    const id = randomUUID();
    const uid = randomBytes(7);
    const blob = sealPwdPack({
      dek,
      nonce: randomBytes(12),
      pwdPack,
      aad: pwdPackAad({ mediaId: id, operatorId: world.operatorId, keyIndex, uid }),
    });
    await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
    await owner.query(
      `INSERT INTO media (id, operator_id, kind, token_hash, nfc_uid, batch_id, key_index, status,
                          personalized_at, pwd_pack_enc, pwd_pack_dek_id)
       VALUES ($1, $2, 'NFC_TAG', $3, $4, $5, $6, 'PERSONALIZED', now(), $7, $8)`,
      [
        id,
        world.operatorId,
        createHash('sha256').update(id).digest(),
        uid,
        batchId,
        keyIndex,
        blob,
        dekId,
      ],
    );
    return id;
  }

  async function newGateway(role: 'PRIMARY' | 'STANDBY', eventId: string): Promise<string> {
    const id = await addGateway(owner, world, eventId, { sha256: randomBytes(32), role });
    const keys = role === 'PRIMARY' ? gatewayKeys : createECDH('prime256v1');
    keys.generateKeys();
    await owner.query(
      `UPDATE edge_gateway SET agreement_public_key = $2,
              registered_at = now() - interval '2 hours',
              role_changed_at = now() - interval '2 hours'
        WHERE id = $1`,
      [id, keys.getPublicKey()],
    );
    return id;
  }

  /** Côté passerelle : ouvre la clé de contenu puis le colis d'un bracelet. */
  async function gatewayOpens(
    gatewayId: string,
    ledgerId: string,
    mediaId: string,
  ): Promise<{ contentKey: Buffer; pwdPack: Buffer }> {
    const key = await owner.query<{ wrapped_key: WrappedKey }>(
      'SELECT wrapped_key FROM edge_pwd_pack_key WHERE gateway_id = $1',
      [gatewayId],
    );
    const contentKey = openForRecipient({
      recipientPrivateKey: gatewayKeys.getPrivateKey(),
      blob: fromWrappedKey(key.rows[0]!.wrapped_key),
      aad: sealedKeyAad(ledgerId, gatewayId),
    });
    const pack = await owner.query<{ pwd_pack_enc: Buffer; key_index: number; nfc_uid: Buffer }>(
      `SELECT p.pwd_pack_enc, m.key_index, m.nfc_uid FROM edge_pwd_pack p
         JOIN media m ON m.id = p.media_id
        WHERE p.gateway_id = $1 AND p.media_id = $2`,
      [gatewayId, mediaId],
    );
    const row = pack.rows[0]!;
    const pwdPack = openPwdPack({
      dek: contentKey,
      blob: row.pwd_pack_enc,
      aad: pwdPackAad({
        mediaId,
        operatorId: world.operatorId,
        keyIndex: row.key_index,
        uid: row.nfc_uid,
      }),
    });
    return { contentKey, pwdPack };
  }

  /** Page de réplication servie à la passerelle (rôle edge), en texte. */
  async function servedPage(gatewayId: string): Promise<string> {
    const client = await connect(EDGE_URL);
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query(`SELECT set_config('app.operator_id', $1, true)`, [world.operatorId]);
      await client.query(`SELECT set_config('app.gateway_id', $1, true)`, [gatewayId]);
      const { rows } = await client.query<{ page: unknown }>(
        'SELECT edge_replication_page($1, 0, 0, 100) AS page',
        [gatewayId],
      );
      await client.query('ROLLBACK');
      return JSON.stringify(rows[0]!.page);
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    owner = await connect(OWNER_URL);
    world = await seedEdgeWorld(owner);
    proc = await createKeyProcess('tag-keys');
    config = proc.app.get<AppConfig>(APP_CONFIG, { strict: false });
    for (const level of ['log', 'error', 'warn', 'debug', 'verbose'] as const)
      spies.push(
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(' '));
        }),
      );
    // Clé de dérivation, clé de données (vraie, via le faux service de clés), lot.
    await owner.query(
      `INSERT INTO tag_key (operator_id, key_index, kms_key_ref) VALUES ($1, $2, $3)`,
      [world.operatorId, keyIndex, `fake-kms:hmac:${randomUUID()}`],
    );
    const generated = await proc.kms.generateDataKey(config.tagWrappingKeyRef);
    dek = generated.plaintext;
    const inserted = await owner.query<{ id: string }>(
      `INSERT INTO tag_data_key
         (operator_id, key_index, version, wrapping_kms_key_ref, encrypted_dek)
       VALUES ($1, $2, 1, $3, $4) RETURNING id`,
      [world.operatorId, keyIndex, config.tagWrappingKeyRef, generated.encrypted],
    );
    dekId = inserted.rows[0]!.id;
  });
  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    await proc?.app.close();
    await owner?.end();
  });

  it('contrôle positif : un journal fautif ou un colis en clair est vu par la recherche', () => {
    const faulty = `mot de passe ${CANARY.toString('hex')}`;
    expect(leaks(faulty)).toBe(true);
    expect(leaks(Buffer.concat([randomBytes(8), CANARY, randomBytes(8)]))).toBe(true);
    expect(leaks(`b64 ${CANARY.toString('base64url')}`)).toBe(true);
    expect(leaks('rien de tel ici')).toBe(false);
  });

  it('aucune capacité de clé maître : ni MAC, ni clé de données, ni administration', () => {
    for (const token of [MAC_PORT, DATA_KEY_PORT, KEY_ADMIN_PORT])
      expect(() => proc.app.get(token, { strict: false })).toThrow();
  });

  it('PRIMARY : clé et colis déposés, rouverts côté passerelle, aucun clair ailleurs', async () => {
    const event = await newEvent(owner, world);
    await owner.query(`SELECT set_config('app.operator_id', $1, false)`, [world.operatorId]);
    const batch = await owner.query<{ id: string }>(
      `INSERT INTO media_batch (operator_id, organizer_id, event_id, kind, quantity, key_index)
       VALUES ($1, (SELECT organizer_id FROM event WHERE id = $2), $2, 'PUBLIC', 10, $3)
       RETURNING id`,
      [world.operatorId, event.eventId, keyIndex],
    );
    batchId = batch.rows[0]!.id;
    const gatewayId = await newGateway('PRIMARY', event.eventId);
    const standbyId = await newGateway('STANDBY', event.eventId);
    const media = await plantMedia(CANARY);
    logged.length = 0;

    const n0 = await runWorker();
    expect(n0).toBeGreaterThanOrEqual(2); // la clé et au moins un colis
    const { contentKey, pwdPack } = await gatewayOpens(gatewayId, event.ledgerId, media);
    expect(pwdPack.equals(CANARY)).toBe(true); // la passerelle retrouve le mot de passe

    // Rien en clair : colis, clé scellée, page servie, journaux du travailleur, ni la clé de
    // contenu elle-même.
    const stored = await owner.query<{ pwd_pack_enc: Buffer; wrapped_key: unknown }>(
      `SELECT p.pwd_pack_enc, k.wrapped_key FROM edge_pwd_pack p
         JOIN edge_pwd_pack_key k ON k.gateway_id = p.gateway_id WHERE p.gateway_id = $1`,
      [gatewayId],
    );
    expect(stored.rows.length).toBeGreaterThan(0);
    for (const row of stored.rows) {
      expect(row.pwd_pack_enc.length).toBe(34);
      expect(leaks(row.pwd_pack_enc)).toBe(false);
      expect(leaks(JSON.stringify(row.wrapped_key))).toBe(false);
      expect(leaks(JSON.stringify(row.wrapped_key), contentKey)).toBe(false);
    }
    const page = await servedPage(gatewayId);
    expect(page).toContain('pwd_pack_key');
    expect(leaks(page)).toBe(false);
    expect(leaks(page, contentKey)).toBe(false);
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(leaks(line)).toBe(false);
      expect(leaks(line, contentKey)).toBe(false);
    }

    // Aucun colis, aucune clé pour la STANDBY ; un second passage ne redépose rien.
    const standby = await owner.query('SELECT 1 FROM edge_pwd_pack_key WHERE gateway_id = $1', [
      standbyId,
    ]);
    expect(standby.rowCount).toBe(0);
    expect(await runWorker()).toBe(0);

    // Un bracelet arrivé plus tard est scellé sous la MÊME clé de contenu (dérivation stable).
    const later = await plantMedia(Buffer.from('Pq9!mW', 'ascii'));
    expect(await runWorker()).toBe(1);
    const second = await gatewayOpens(gatewayId, event.ledgerId, later);
    expect(second.contentKey.equals(contentKey)).toBe(true);
    expect(second.pwdPack.toString('ascii')).toBe('Pq9!mW');
  });

  it("passerelle révoquée ou dans le délai : rien n'est déposé", async () => {
    const event = await newEvent(owner, world);
    const fresh = await addGateway(owner, world, event.eventId, {
      sha256: randomBytes(32),
      role: 'PRIMARY',
    });
    gatewayKeys.generateKeys();
    await owner.query('UPDATE edge_gateway SET agreement_public_key = $2 WHERE id = $1', [
      fresh,
      gatewayKeys.getPublicKey(),
    ]); // inscrite à l'instant : délai de 30 minutes
    expect(await runWorker()).toBe(0);
    const none = await owner.query('SELECT 1 FROM edge_pwd_pack_key WHERE gateway_id = $1', [
      fresh,
    ]);
    expect(none.rowCount).toBe(0);
    await owner.query(
      `UPDATE edge_gateway SET registered_at = now() - interval '2 hours',
              role_changed_at = now() - interval '2 hours', status = 'REVOKED' WHERE id = $1`,
      [fresh],
    );
    expect(await runWorker()).toBe(0);
    const revoked = await owner.query('SELECT 1 FROM edge_pwd_pack_key WHERE gateway_id = $1', [
      fresh,
    ]);
    expect(revoked.rowCount).toBe(0);
  });

  it('liste de prestataires vide : le travailleur ne dépose rien et le journalise', async () => {
    logged.length = 0;
    expect(await proc.app.get(EdgePacksService, { strict: false }).runOnce()).toBe(0);
    expect(logged.join(' ')).toContain('EDGE_PACK_OPERATORS');
  });
});
