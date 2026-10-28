// Parcours de bout en bout de la mission bracelets-nfc (SC-002 ; WP20, T082) : de la demande
// d'une clé de bracelet à la clôture du lot, PAR HTTP sur les trois processus (API publique,
// personnalisation, clés de bracelet) et par les deux commandes (administration des clés,
// contrôle quotidien).
//
// Écritures directes en base gardées, toutes d'amorçage sauf une :
// - `createMediaWorld` : prestataires, organisateurs, événement et son grand livre, personnes
//   (faux
//   serveur d'identité). Il pose aussi une clé d'index 1 chez A (clé du kit) : la clé demandée
//   ici
//   prend donc l'index suivant, et la clé d'index 1 passe en déchiffrement seul ;
// - un second OPERATOR_ADMIN et un second SUPERVISOR (les demandes à deux exigent une autre
//   personne), le terminal (`createTestDevice` : l'enrôlement arrive avec la mission des
//   terminaux), le compte de caisse du terminal (`openCashDesk` : décision du porteur n° 10, les
//   caisses sont ouvertes par la mission des caisses), deux festivaliers (`createTestCustomer` :
//   la
//   création de compte festivalier n'est pas une route de cette mission) ;
// - la mise en service de l'événement (`goLive`) : la route de la mission 3 exige un contrat et
//   des
//   conditions que ce jeu d'essai ne pose pas ; elle est prouvée par configuration-journey ;
// - EN COURS DE PARCOURS, un seul crédit de portefeuille (`creditWallet`) : il n'existe pas
//   encore
//   de route de recharge (mission 6), or la demande en attente exige un bracelet approvisionné.
//
// Quatre bracelets sont personnalisés et non trois : le rattachement à solde nul consomme le
// code d'un bracelet actif, et la demande en attente exige un autre bracelet actif,
// approvisionné, dont le code n'a pas servi ; les deux premiers sont, à ce moment, remplacé et
// rendu.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DailyCheckWorker } from '../../../src/media/daily-check/daily-check.worker';
import { DekWorker } from '../../../src/media/keys/dek.worker';
import { KeyAdminWorker } from '../../../src/media/keys/key-admin.worker';
import { ReencryptWorker } from '../../../src/media/keys/reencrypt.worker';
import { createKeyProcess, createTestApp, type KeyProcessApp } from '../../support/app';
import { withOwner } from '../../support/db';
import { createTestCustomer, type TestCustomer } from '../../support/fake-customer';
import { createTestDevice, type TestDevice } from '../../support/fake-device';
import type { TestPerson } from '../../support/fake-idp';
import {
  createChip,
  createMediaWorld,
  createStation,
  creditWallet,
  goLive,
  ledgerIsSound,
  openCashDesk,
  openCashSession,
  ownerRows as rows,
  personalizationBody,
  tapBody,
  type MediaWorld,
} from '../../support/media-fixtures';

jest.setTimeout(180_000);

/** Bracelet personnalisé par la route : puce, identifiant, mot de passe ouvert, code imprimé. */
interface Bracelet {
  chip: ReturnType<typeof createChip>;
  id: string;
  pwdPack: Buffer;
  code: string;
}

describe('parcours complet d’un bracelet : de la clé à la clôture du lot', () => {
  let w: MediaWorld;
  let app: INestApplication; // API publique
  let perso: KeyProcessApp; // processus de personnalisation
  let tagKeys: KeyProcessApp; // processus des clés de bracelet
  let keyAdmin: KeyProcessApp; // commande d'administration des clés
  let tagCheck: KeyProcessApp; // commande du contrôle quotidien
  let operatorAdmin2: TestPerson;
  let supervisor2: TestPerson;
  let device: TestDevice;
  let alice: TestCustomer;
  let bob: TestCustomer;
  let counter = 0;
  const next = () => (counter += 1);

  beforeAll(async () => {
    w = await createMediaWorld();
    await withOwner(async (db) => {
      operatorAdmin2 = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: w.ops.a }],
      });
      supervisor2 = await w.idp.createPerson(db, {
        operatorId: w.ops.a,
        roles: [{ role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: w.ids.eventA }],
      });
      await goLive(db, w.ops.a, w.ids.eventA, w.operatorAdminA.userId);
      device = await createTestDevice(db, {
        operatorId: w.ops.a,
        eventId: w.ids.eventA,
        kind: 'TOPUP',
      });
      await openCashDesk(db, {
        operatorId: w.ops.a,
        ledgerId: w.ids.ledgerA,
        organizerId: w.ids.organizerA,
        serial: device.serial,
      });
      // Toute espèce passe par la session ouverte du terminal (mission des caisses, WP09).
      await openCashSession(db, {
        operatorId: w.ops.a,
        deviceId: device.deviceId,
        userId: w.cashierA.userId,
      });
      alice = await createTestCustomer(db, w.ops.a);
      bob = await createTestCustomer(db, w.ops.a);
    });
    app = await createTestApp({ identity: w.idp });
    perso = await createKeyProcess('personalization', { identity: w.idp });
    tagKeys = await createKeyProcess('tag-keys');
    keyAdmin = await createKeyProcess('key-admin');
    tagCheck = await createKeyProcess('tag-check');
  });

  afterAll(async () => {
    for (const proc of [tagCheck, keyAdmin, tagKeys, perso]) await proc?.app.close();
    await app?.close();
  });

  // ----- Accès HTTP -----
  type Who = { person?: TestPerson | null; device?: TestDevice | null; customer?: TestCustomer };
  const send = (
    target: INestApplication,
    method: 'get' | 'post',
    path: string,
    who: Who,
    body?: object,
  ) => {
    let req = request(target.getHttpServer())[method](path);
    if (who.device) req = req.set(who.device.headers);
    if (who.customer) req = req.set(who.customer.headers);
    // Terminal ET personne : route de guichet, jeton de la personne dans X-Staff-Authorization.
    if (who.person)
      req = req.set(
        who.device ? 'X-Staff-Authorization' : 'Authorization',
        `Bearer ${who.person.token}`,
      );
    if (method === 'get') return req;
    return req.set('Idempotency-Key', randomUUID()).send(body ?? {});
  };
  const post = (who: Who, path: string, body?: object) => send(app, 'post', path, who, body);
  const get = (who: Who, path: string) => send(app, 'get', path, who);
  const desk = (): Who => ({ device, person: w.cashierA });
  const approve = (person: TestPerson, id: string) =>
    post({ person }, `/v1/approval-requests/${id}/approve`);
  const O = () => `/v1/operators/${w.ops.a}`;

  // ----- Bracelets -----
  let keyIndex: number;
  /** Ce que lit un terminal sur la puce, à la forme attendue par `tapBody`. */
  const read = (b: Bracelet, overrides: Record<string, unknown> = {}) =>
    tapBody(
      {
        uid: b.chip.uid,
        tokenHash: Buffer.from(b.chip.tokenHash, 'hex'),
        signature: b.chip.signature,
      },
      next(),
      { key_index: keyIndex, ...overrides },
    );
  const tap = (b: Bracelet) => post({ device }, '/v1/taps', read(b));
  const mediaState = (b: Bracelet) =>
    rows<{ status: string; wallet_id: string | null; deposit_status: string }>(
      'SELECT status, wallet_id, deposit_status FROM media WHERE id = $1',
      [b.id],
    ).then((r) => r[0]!);
  const walletOwner = (walletId: string) =>
    rows<{ customer_id: string | null }>('SELECT customer_id FROM wallet WHERE id = $1', [
      walletId,
    ]).then((r) => r[0]!.customer_id);

  it('SC-002 : clé, lot, personnalisation, guichet, contrôle quotidien, clôture', async () => {
    // 1. Clé de bracelet demandée à deux (API publique) : une seule personne ne suffit pas.
    const requested = await post({ person: w.operatorAdminA }, `${O()}/tag-keys`, {});
    expect(requested.status).toBe(202);
    expect(requested.body).toMatchObject({ action: 'TAG_KEY_CREATE', status: 'PENDING' });
    const selfApproval = await approve(w.operatorAdminA, requested.body.approval_request_id);
    expect([403, 409]).toContain(selfApproval.status);
    const approved = await approve(operatorAdmin2, requested.body.approval_request_id);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      status: 'EXECUTED',
      result: { kind: 'CREATE_KEY', awaiting: 'KEY_ADMIN_COMMAND' },
    });
    keyIndex = approved.body.result.key_index as number;
    expect(keyAdmin.kms.calls.createKey).toBe(0);

    // 2. Commande d'administration des clés : seule à créer la clé dans le service de clés.
    const runKeyAdmin = () =>
      keyAdmin.app.get(KeyAdminWorker, { strict: false }).runOnce([w.ops.a]);
    expect(await runKeyAdmin()).toBe(1);
    expect(keyAdmin.kms.calls.createKey).toBe(1);
    expect(await runKeyAdmin()).toBe(0);
    const key = await get({ person: w.operatorAdminA }, `${O()}/tag-keys/${keyIndex}`);
    expect(key.body).toMatchObject({ key_index: keyIndex, status: 'ACTIVE', scope: 'SHARED' });
    expect(
      await rows(
        `SELECT actor_id, approver_id, origin FROM audit_log
          WHERE operator_id = $1 AND action = 'TAG_KEY_CREATED'`,
        [w.ops.a],
      ),
    ).toEqual([
      {
        actor_id: w.operatorAdminA.userId,
        approver_id: operatorAdmin2.userId,
        origin: 'key-admin',
      },
    ]);

    // 3. Lot PUBLIC sur cette clé, réservé à l'événement, caution payée à part.
    const batchRes = await post({ person: w.organizerAdminA }, `${O()}/media-batches`, {
      organizer_id: w.ids.organizerA,
      event_id: w.ids.eventA,
      kind: 'PUBLIC',
      quantity: 4,
      key_index: keyIndex,
      deposit_amount: 1000,
      deposit_mode: 'SEPARATE',
    });
    expect(batchRes.status).toBe(201);
    expect(batchRes.body).toMatchObject({ status: 'ORDERED', key_mode: 'SHARED' });
    const batchId = batchRes.body.batch_id as string;
    const B = `${O()}/media-batches/${batchId}`;

    // 4. Fichier de commande des codes imprimés : remis une fois, en clair seulement ici.
    const order = await post({ person: w.organizerAdminA }, `${B}/claim-code-order`);
    expect(order.status).toBe(200);
    expect(order.headers['content-type']).toBe('text/csv; charset=utf-8');
    const lines = order.text.trimEnd().split('\n');
    expect(lines[0]).toBe('rank,code,url');
    const codes = lines.slice(1).map((line) => line.split(',')[1]!);
    expect(codes).toHaveLength(4);
    expect((await post({ person: w.organizerAdminA }, `${B}/claim-code-order`)).status).toBe(409);

    // 5. Personnalisation de 4 bracelets (processus de personnalisation) et association des
    // codes.
    const station = createStation();
    const P = `${O()}/media-personalizations`;
    const bracelets: Bracelet[] = [];
    for (const code of codes) {
      const chip = createChip();
      const res = await send(
        perso.app,
        'post',
        P,
        { person: w.personalizerA },
        personalizationBody(batchId, chip, station),
      );
      expect(res.status).toBe(201);
      expect(res.body.key_index).toBe(keyIndex);
      const id = res.body.media_id as string;
      const pwdPack = station.open(res.body.pwd_pack, id, chip.uid);
      const associated = await send(
        perso.app,
        'post',
        `${P}/${id}/claim-code`,
        { person: w.personalizerA },
        { claim_code: code },
      );
      expect(associated.status).toBe(204);
      bracelets.push({ chip, id, pwdPack, code });
    }
    const [m1, m2, m3, m4] = bracelets as [Bracelet, Bracelet, Bracelet, Bracelet];

    // 6. Clé de données : ouverte par la première personnalisation (une version pour la
    // série),
    //    puis rotation demandée à deux, faite par la personnalisation, rechiffrement fait
    //    par le
    //    processus des clés de bracelet.
    const dataKeys = () =>
      rows<{ id: string; version: number; status: string }>(
        `SELECT id, version, status FROM tag_data_key
          WHERE operator_id = $1 AND key_index = $2 ORDER BY version`,
        [w.ops.a, keyIndex],
      );
    expect((await dataKeys()).map((k) => k.status)).toEqual(['ACTIVE']);
    const rotation = await post(
      { person: w.operatorAdminA },
      `${O()}/tag-keys/${keyIndex}/dek-rotations`,
    );
    expect(rotation.status).toBe(202);
    const rotated = await approve(operatorAdmin2, rotation.body.approval_request_id);
    expect(rotated.body).toMatchObject({ status: 'EXECUTED', result: { kind: 'ROTATE_DEK' } });
    expect(await perso.app.get(DekWorker, { strict: false }).runOnce([w.ops.a])).toBe(1);
    expect(await tagKeys.app.get(ReencryptWorker, { strict: false }).runOnce([w.ops.a])).toBe(1);
    const afterRotation = await dataKeys();
    expect(afterRotation.map((k) => k.status)).toEqual(['RETIRED', 'ACTIVE']);
    expect(
      await rows('SELECT DISTINCT pwd_pack_dek_id AS dek FROM media WHERE batch_id = $1', [
        batchId,
      ]),
    ).toEqual([{ dek: afterRotation[1]!.id }]);
    // Le terminal reçoit (processus des clés de bracelet) le mot de passe qu'a écrit le
    // poste.
    const authKey = await send(
      tagKeys.app,
      'post',
      '/v1/media/auth-keys',
      { device },
      { nfc_uid: m1.chip.uid, key_index: keyIndex },
    );
    expect(authKey.status).toBe(200);
    expect(device.open(authKey.body.enc, Buffer.from(m1.chip.uid, 'hex')).equals(m1.pwdPack)).toBe(
      true,
    );

    // 7. Lot mis en service : PERSONALIZED → DELIVERED → ACTIVE.
    for (const status of ['PERSONALIZED', 'DELIVERED', 'ACTIVE']) {
      const res = await post({ person: w.organizerAdminA }, `${B}/status`, { status });
      expect([res.status, res.body.status]).toEqual([200, status]);
    }

    // 8. Activation au guichet avec caution en espèces, puis lecture.
    const activate = async (b: Bracelet) => {
      const res = await post(desk(), '/v1/media/activations', {
        tap: read(b),
        channel: 'DESK',
        occurred_at: new Date().toISOString(),
        deposit_payment: { method: 'CASH' },
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        media_id: b.id,
        media_status: 'ACTIVE',
        deposit: { status: 'HELD', amount: 1000, mode: 'SEPARATE' },
      });
      return res.body.wallet.wallet_id as string;
    };
    const wallet1 = await activate(m1);
    const tapped = await tap(m1);
    expect(tapped.status).toBe(200);
    expect(tapped.body).toMatchObject({
      result: 'OK',
      media: { media_id: m1.id, status: 'ACTIVE', deposit_status: 'HELD', deposit_held: 1000 },
      wallet: { wallet_id: wallet1, spendable: 0 },
    });

    // 9. Remplacement : le neuf reprend le portefeuille et la caution ; l'ancien ne paie
    // plus.
    const replaced = await post(desk(), `/v1/media/${m1.id}/replace`, {
      new_media_tap: read(m2),
      reason: 'Bracelet déchiré, identité vérifiée sur pièce.',
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body).toEqual({ old_media_id: m1.id, new_media_id: m2.id, wallet_id: wallet1 });
    expect((await tap(m1)).body.result).toBe('REPLACED');
    expect(await mediaState(m2)).toEqual({
      status: 'ACTIVE',
      wallet_id: wallet1,
      deposit_status: 'HELD',
    });

    // 10. Rendu de la caution, en espèces, sur présentation du bracelet.
    const refunded = await post(desk(), `/v1/media/${m2.id}/deposit/refund`, {
      tap: read(m2),
      payment: { method: 'CASH' },
    });
    expect(refunded.status).toBe(200);
    expect(refunded.body).toMatchObject({ status: 'REFUNDED', amount: 1000, mode: 'SEPARATE' });

    // 11. Restitution : solde nul, caution rendue, le bracelet est rendu.
    const released = await post(desk(), `/v1/media/${m2.id}/release`, { tap: read(m2) });
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({ media_id: m2.id, media_status: 'RELEASED' });
    expect((await tap(m2)).body.result).toBe('RELEASED');

    // 12. Rattachement par code d'un autre bracelet, à solde nul : immédiat.
    const wallet3 = await activate(m3);
    const claimed = await post({ customer: alice }, '/v1/me/media', { claim_code: m3.code });
    expect(claimed.status).toBe(201);
    expect(claimed.body).toMatchObject({ media_id: m3.id, status: 'ACTIVE', wallet_id: wallet3 });
    expect(await walletOwner(wallet3)).toBe(alice.customerId);

    // 13. Bracelet approvisionné : demande en attente, confirmée au guichet avec le
    // bracelet.
    const wallet4 = await activate(m4);
    // Écriture directe : aucune route de recharge avant la mission 6 (voir l'en-tête).
    await withOwner((db) =>
      creditWallet(db, {
        operatorId: w.ops.a,
        ledgerId: w.ids.ledgerA,
        walletId: wallet4,
        amount: 3000,
      }),
    );
    const pending = await post({ customer: bob }, '/v1/me/media', { claim_code: m4.code });
    expect(pending.status).toBe(202);
    expect(pending.body).toMatchObject({
      status: 'PENDING_DESK_CONFIRMATION',
      confirmation_code: expect.stringMatching(/^\d{6}$/),
    });
    expect(await walletOwner(wallet4)).toBeNull();
    const deskTap = await tap(m4);
    expect(deskTap.body).toMatchObject({
      result: 'OK',
      wallet: { wallet_id: wallet4, spendable: 3000 },
    });
    const confirmed = await post(desk(), '/v1/media/claims/confirmations', {
      tap_id: deskTap.body.tap_id,
      claim_code: m4.code,
      confirmation_code: pending.body.confirmation_code,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ media_id: m4.id, wallet_id: wallet4 });
    expect(await walletOwner(wallet4)).toBe(bob.customerId);

    // 14. Liste noire, puis sortie à deux personnes.
    const blacklisted = await post({ person: w.supervisorA }, `${O()}/media/${m3.id}/blacklist`, {
      reason: 'Fraude suspectée',
    });
    expect(blacklisted.status).toBe(200);
    expect(blacklisted.body).toMatchObject({ media_id: m3.id, status: 'BLACKLISTED' });
    expect((await tap(m3)).body.result).toBe('BLOCKED');
    const asked = await post({ person: w.supervisorA }, `${O()}/media/${m3.id}/reinstatement`, {
      reason: 'Enquête close, bracelet sain',
    });
    expect(asked.status).toBe(202);
    expect(asked.body).toMatchObject({ action: 'REINSTATE_MEDIA', status: 'PENDING' });
    expect((await approve(w.supervisorA, asked.body.approval_request_id)).status).toBe(409);
    expect((await mediaState(m3)).status).toBe('BLACKLISTED');
    const reinstated = await approve(supervisor2, asked.body.approval_request_id);
    expect(reinstated.body).toMatchObject({
      status: 'EXECUTED',
      result: { media_id: m3.id, status: 'ACTIVE' },
    });
    expect((await tap(m3)).body.result).toBe('OK');

    // 15. Contrôle quotidien (commande tag-check) : les mots de passe stockés sont justes.
    expect(await tagCheck.app.get(DailyCheckWorker, { strict: false }).runOnce([w.ops.a])).toBe(1);
    const runs = await get({ person: w.operatorAdminA }, `${O()}/tag-key-check-runs`);
    expect(runs.status).toBe(200);
    expect(runs.body.data).toHaveLength(1);
    expect(runs.body.data[0]).toMatchObject({ status: 'OK', mismatches: 0 });
    expect(runs.body.data[0].sampled).toBeGreaterThanOrEqual(2);
    expect(tagCheck.workers.alarm()).toBe(0);

    // 16. Clôture du lot : les cautions encore détenues (m3, m4) sont acquises, les
    // bracelets
    //     retirés ; tous les codes ayant été associés, aucun n'est à invalider.
    let closure = await post({ person: w.organizerAdminA }, `${B}/closure`);
    for (let i = 0; i < 3 && closure.body.status !== 'CLOSED'; i += 1) {
      closure = await post({ person: w.organizerAdminA }, `${B}/closure`);
    }
    expect(closure.status).toBe(200);
    expect(closure.body).toMatchObject({
      status: 'CLOSED',
      remaining_deposits: 0,
      invalidated_claim_codes: 0,
    });
    expect((await get({ person: w.organizerAdminA }, B)).body.status).toBe('CLOSED');
    expect(await mediaState(m4)).toMatchObject({ status: 'RETIRED', deposit_status: 'FORFEITED' });
    // Selon l'ordre des contrôles de register_tap : lot clos ou bracelet retiré.
    expect(['RETIRED', 'BATCH_INACTIVE']).toContain((await tap(m4)).body.result);

    // Le grand livre de l'événement est équilibré, ses soldes en cache égaux au recalcul.
    expect(await ledgerIsSound(w.ids.ledgerA)).toEqual({ unbalanced: 0, drift: 0 });
  });
});
