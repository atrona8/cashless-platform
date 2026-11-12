// Routes humaines `GET` et `POST /ledgers/{ledger_id}/debit-authority` (mission passerelle-locale, lot WP11, T047 ;
// FR-003, FR-004 ; edge-routes.md `getDebitAuthority`, `requestDebitAuthorityChange`). Bascule vers la passerelle,
// rendu, abandon d'une bascule non accusée (déduit de l'état : le contrat n'a pas de champ pour lui, écart 2),
// rejeu d'une clé, rôles et prestataires. L'accusé de la passerelle est rejoué sous le propriétaire (WP12 viendra).
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { contractViolations } from '../../support/contract-schema';
import { ownerRows } from '../../support/media-fixtures';
import { DebitWorld } from './debit-authority-world';

jest.setTimeout(240_000);

describe('autorité de débit côté humains (WP11, T047)', () => {
  let dw: DebitWorld;
  beforeAll(async () => {
    dw = await DebitWorld.create();
  });
  afterAll(async () => {
    await dw?.close();
  });
  beforeEach(async () => {
    await dw.reset();
  });

  const admin = () => dw.pw.w.operatorAdminA;
  const auditCount = (action: string) =>
    ownerRows<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE action = $1`, [
      action,
    ]).then((r) => r[0]!.n);

  it('lecture CENTRAL : état nul, sans passerelle ni URL ; schéma du contrat', async () => {
    const res = await dw.read(admin());
    expect(res.status).toBe(200);
    expect(contractViolations('DebitAuthorityState', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      ledger_id: dw.ledger,
      authority: 'CENTRAL',
      edge_gateway_id: null,
      edge_base_url: null,
      handover: null,
    });
  });

  it('EDGE : 202, GRANTED, époque +1, URL de la passerelle, audit ; rejeu de la clé sans nouvelle époque', async () => {
    const before = await dw.authority();
    const gateway = await dw.gateway();
    const key = randomUUID();
    const body = { target: 'EDGE', reason: 'Coupure réseau', edge_gateway_id: gateway.id };
    const audits = await auditCount('EDGE_AUTHORITY_GRANTED');
    const res = await dw.change(admin(), body, key);
    expect(res.status).toBe(202);
    expect(contractViolations('DebitAuthorityState', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      authority: 'EDGE',
      epoch: before.authority_epoch + 1,
      edge_gateway_id: gateway.id,
      edge_base_url: gateway.lanUrl,
      handover: { direction: 'TO_EDGE', state: 'GRANTED', epoch: before.authority_epoch + 1 },
    });
    expect(await auditCount('EDGE_AUTHORITY_GRANTED')).toBe(audits + 1);
    const replay = await dw.change(admin(), body, key);
    expect(replay.status).toBe(202);
    expect(replay.body).toEqual(res.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect((await dw.authority()).authority_epoch).toBe(before.authority_epoch + 1);
    expect(await dw.handovers()).toHaveLength(1);
    // La lecture rend la même bascule ouverte.
    const read = await dw.read(admin());
    expect(read.body).toMatchObject({ authority: 'EDGE', handover: { state: 'GRANTED' } });
  });

  it('EDGE refusé : STANDBY, révoquée, autre événement, bascule déjà ouverte (409) ; sans passerelle 422 ; autre prestataire 404', async () => {
    const epoch = (await dw.authority()).authority_epoch;
    const standby = await dw.gateway({ role: 'STANDBY' });
    const revoked = await dw.gateway({ status: 'REVOKED' });
    const otherEvent = await dw.gateway({ eventId: await dw.otherEvent() });
    const ask = (id: string | undefined) =>
      dw.change(admin(), {
        target: 'EDGE',
        reason: 'Test',
        ...(id ? { edge_gateway_id: id } : {}),
      });
    for (const gateway of [standby, revoked, otherEvent]) {
      const res = await ask(gateway.id);
      expect([gateway.serial, res.status, res.body.code]).toEqual([
        gateway.serial,
        409,
        'HANDOVER_INVALID_STATE',
      ]);
    }
    expect((await ask(undefined)).status).toBe(422);
    expect((await ask(randomUUID())).status).toBe(404);
    const foreign = await dw.gateway({
      operatorId: dw.pw.w.ops.b,
      eventId: await dw.foreignEvent(),
    });
    expect((await ask(foreign.id)).status).toBe(404);
    expect((await dw.authority()).authority_epoch).toBe(epoch);
    // Bascule déjà ouverte.
    const good = await dw.gateway();
    await dw.grant(good);
    const again = await ask(good.id);
    expect([again.status, again.body.code]).toEqual([409, 'HANDOVER_INVALID_STATE']);
    expect((await dw.authority()).authority_epoch).toBe(epoch + 1);
  });

  it('CENTRAL sur ACTIVE : RELEASE_REQUESTED, le grand livre reste EDGE ; CENTRAL encore : abandon du rendu (fail_edge_release)', async () => {
    const { gateway } = await dw.edgeActive();
    const epoch = (await dw.authority()).authority_epoch;
    const res = await dw.change(admin(), { target: 'CENTRAL', reason: 'Retour au central' });
    expect(res.status).toBe(202);
    expect(contractViolations('DebitAuthorityState', res.body)).toEqual([]);
    expect(res.body).toMatchObject({
      authority: 'EDGE',
      epoch,
      edge_gateway_id: gateway.id,
      handover: { direction: 'TO_CENTRAL', state: 'RELEASE_REQUESTED' },
    });
    expect((await dw.authority()).debit_authority).toBe('EDGE');
    expect(await auditCount('EDGE_AUTHORITY_RELEASE_REQUESTED')).toBeGreaterThan(0);
    // Règle de déduction : un `CENTRAL` sur un rendu ouvert l'abandonne, l'autorité reste à la passerelle.
    const abandoned = await dw.change(admin(), { target: 'CENTRAL', reason: 'Rendu bloqué' });
    expect(abandoned.status).toBe(202);
    expect(abandoned.body).toMatchObject({
      authority: 'EDGE',
      epoch,
      handover: { direction: 'TO_CENTRAL', state: 'FAILED' },
    });
    expect((await dw.authority()).debit_authority).toBe('EDGE');
  });

  it('CENTRAL sur GRANTED : abandon par fail_edge_grant, époque +2 ; autre clé ensuite : 409, aucune époque de plus', async () => {
    const start = (await dw.authority()).authority_epoch;
    await dw.grant(await dw.gateway());
    const res = await dw.change(admin(), { target: 'CENTRAL', reason: 'Bascule annulée' });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      authority: 'CENTRAL',
      epoch: start + 2,
      edge_gateway_id: null,
      edge_base_url: null,
      handover: { direction: 'TO_EDGE', state: 'FAILED' },
    });
    expect(await auditCount('EDGE_AUTHORITY_ABANDONED')).toBeGreaterThan(0);
    const second = await dw.change(admin(), { target: 'CENTRAL', reason: 'Encore' });
    expect([second.status, second.body.code]).toEqual([409, 'HANDOVER_INVALID_STATE']);
    expect((await dw.authority()).authority_epoch).toBe(start + 2);
  });

  it('CENTRAL sans aucune autorité de passerelle : 409 HANDOVER_INVALID_STATE, rien d’écrit', async () => {
    const epoch = (await dw.authority()).authority_epoch;
    const res = await dw.change(admin(), { target: 'CENTRAL', reason: 'Rien à rendre' });
    expect([res.status, res.body.code]).toEqual([409, 'HANDOVER_INVALID_STATE']);
    expect((await dw.authority()).authority_epoch).toBe(epoch);
  });

  it('rôles : guichet, vendeur et ORGANIZER_ADMIN refusés au POST ; lecture à l’ORGANIZER_ADMIN ; autre prestataire 404 ; sans jeton 401', async () => {
    const { w } = dw.pw;
    const gateway = await dw.gateway();
    const body = { target: 'EDGE', reason: 'Test', edge_gateway_id: gateway.id };
    for (const who of [w.cashierA, w.supervisorA, w.organizerAdminA, w.personalizerA])
      expect((await dw.change(who, body)).status).toBe(403);
    for (const who of [w.cashierA, w.supervisorA, w.personalizerA])
      expect((await dw.read(who)).status).toBe(403);
    expect((await dw.read(w.organizerAdminA)).status).toBe(200);
    expect((await dw.read(admin())).status).toBe(200);
    // Autre prestataire : 404 neutre (le grand livre n'existe pas pour lui) ; ORGANIZER_ADMIN : jamais au POST.
    expect((await dw.change(dw.operatorAdminB, body)).status).toBe(404);
    expect((await dw.read(dw.operatorAdminB)).status).toBe(404);
    expect((await dw.read(dw.organizerAdminB)).status).toBe(404);
    expect((await dw.change(dw.organizerAdminB, body)).status).toBe(403);
    expect(
      (
        await dw.bo('GET', `/ledgers/${dw.ledger}/debit-authority`, admin(), undefined, null, {
          authorization: '',
        })
      ).status,
    ).toBe(401);
    expect((await dw.authority()).debit_authority).toBe('CENTRAL');
    expect(await dw.handovers()).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ status: 'GRANTED' })]),
    );
  });

  it('corps invalide : cible, motif, champ inconnu, booléens, grand livre inconnu : 422 / 404, rien d’écrit', async () => {
    const bad: unknown[] = [
      {},
      { target: 'MOON', reason: 'x' },
      { target: 'EDGE' },
      { target: 'EDGE', reason: '' },
      { target: 'EDGE', reason: 'a\nb' },
      { target: 'CENTRAL', reason: 'x', force: 'yes' },
      { target: 'CENTRAL', reason: 'x', operator_id: randomUUID() },
      { target: 'EDGE', reason: 'x', edge_gateway_id: 'pas-un-uuid' },
      { target: 'EDGE', reason: 'x', force: true, gateway_confirmed_offline: true },
      { target: 'CENTRAL', reason: 'x', force: true },
      { target: 'CENTRAL', reason: 'x', force: true, gateway_confirmed_offline: false },
    ];
    for (const body of bad) {
      const res = await dw.change(admin(), body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 422]);
    }
    expect(
      (await dw.change(admin(), { target: 'CENTRAL', reason: 'x' }, undefined, randomUUID()))
        .status,
    ).toBe(404);
    expect((await dw.authority()).authority_epoch).toBeGreaterThanOrEqual(0);
  });

  it('architecture : l’application n’écrit jamais l’autorité elle-même (aucun UPDATE ledger, set_debit_authority, force_central_authority brute)', () => {
    const root = join(__dirname, '../../../src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk(root);
    const offenders = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return (
        /\bset_debit_authority\b/.test(text.replace(/\/\/.*$/gm, '')) ||
        /\bforce_central_authority\s*\(/.test(text.replace(/\/\/.*$/gm, '')) ||
        /UPDATE\s+ledger\b/i.test(text.replace(/\/\/.*$/gm, ''))
      );
    });
    expect(offenders).toEqual([]);
  });
});
