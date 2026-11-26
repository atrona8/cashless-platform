// Profil du personnel `GET /staff/me` (mission routes-backoffice 11b, WP05 ; FR-001, FR-002, NFR-006).
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PLATFORM_DISPLAY_NAME } from '../../../src/staff-profile/staff-profile.service';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import { createTestCustomer } from '../../support/fake-customer';
import { createTestDevice } from '../../support/fake-device';
import type { FakeIdp, TestPerson } from '../../support/fake-idp';
import { createMediaWorld } from '../../support/media-fixtures';
import type { Operators } from '../transverse/fixtures';

const NAMES = {
  multi: 'Nom-Multi',
  revoked: 'Nom-Revoque',
  toRevoke: 'Nom-ARevoquer',
  other: 'Nom-Autre',
};
const EMAIL_PART = '@test.local';

describe('GET /staff/me', () => {
  let idp: FakeIdp;
  let app: INestApplication;
  let ops: Operators;
  let org: string;
  let event: string;
  let multi: TestPerson; // OPERATOR_ADMIN du prestataire + SUPERVISOR de l'événement
  let platform: TestPerson;
  let revoked: TestPerson; // seule attribution révoquée
  let toRevoke: TestPerson; // attribution révoquée entre deux appels
  let other: TestPerson; // personne d'un autre prestataire

  const people = () => ({ multi, revoked, toRevoke, other });

  beforeAll(async () => {
    const w = await createMediaWorld();
    ({ idp, ops } = w);
    org = w.ids.organizerA;
    event = w.ids.eventA;
    await withOwner(async (db) => {
      multi = await idp.createPerson(db, {
        operatorId: ops.a,
        roles: [
          { role: 'SUPERVISOR', scopeType: 'EVENT', scopeId: event },
          { role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a },
        ],
      });
      platform = await idp.createPerson(db, {
        operatorId: null,
        roles: [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }],
      });
      revoked = await idp.createPerson(db, {
        operatorId: ops.a,
        roles: [{ role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: org }],
      });
      toRevoke = await idp.createPerson(db, {
        operatorId: ops.a,
        roles: [
          { role: 'ORGANIZER_ADMIN', scopeType: 'ORGANIZER', scopeId: org },
          { role: 'CASHIER', scopeType: 'EVENT', scopeId: event },
        ],
      });
      other = await idp.createPerson(db, {
        operatorId: ops.b,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.b }],
      });
      await db.query(
        `UPDATE role_assignment SET revoked_at = clock_timestamp(), revoked_by = $2
          WHERE user_id = $1`,
        [revoked.userId, multi.userId],
      );
      // Un nom distinct par personne : lire la ligne d'une autre personne ne passe pas inaperçu.
      for (const [person, name] of Object.entries(NAMES))
        await db.query('UPDATE app_user SET display_name = $2 WHERE id = $1', [
          people()[person as keyof typeof NAMES].userId,
          name,
        ]);
    });
    app = await createTestApp({ identity: idp });
  });

  afterAll(async () => {
    await app.close();
  });

  const me = (person: TestPerson) =>
    request(app.getHttpServer()).get('/v1/staff/me').set('Authorization', `Bearer ${person.token}`);

  it('deux attributions : les deux, dans l’ordre stable, portées exactes', async () => {
    const res = await me(multi);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user_id: multi.userId,
      display_name: NAMES.multi,
      operator_id: ops.a,
      assignments: [
        { role: 'OPERATOR_ADMIN', scope_type: 'OPERATOR', scope_id: ops.a },
        { role: 'SUPERVISOR', scope_type: 'EVENT', scope_id: event },
      ],
    });
    expect(contractViolations('StaffProfile', res.body)).toEqual([]);
  });

  it('administrateur de plateforme : operator_id nul, scope_id nul', async () => {
    const res = await me(platform);
    expect(res.status).toBe(200);
    expect(res.body.operator_id).toBeNull();
    expect(res.body.display_name).toBe(PLATFORM_DISPLAY_NAME);
    expect(res.body.assignments).toEqual([
      { role: 'PLATFORM_ADMIN', scope_type: 'PLATFORM', scope_id: null },
    ]);
    expect(contractViolations('StaffProfile', res.body)).toEqual([]);
  });

  it('sans aucun rôle actif : la garde laisse passer, 200 avec assignments vide (FR-002)', async () => {
    const res = await me(revoked);
    expect(res.status).toBe(200);
    expect(res.body.assignments).toEqual([]);
    expect(res.body.user_id).toBe(revoked.userId);
    expect(res.body.display_name).toBe(NAMES.revoked);
    expect(contractViolations('StaffProfile', res.body)).toEqual([]);
  });

  it('attribution révoquée entre deux appels : absente au second (relue en base)', async () => {
    const first = await me(toRevoke);
    expect(first.body.display_name).toBe(NAMES.toRevoke);
    expect(first.body.assignments.map((a: { role: string }) => a.role)).toEqual([
      'CASHIER',
      'ORGANIZER_ADMIN',
    ]);
    await withOwner((db) =>
      db.query(
        `UPDATE role_assignment SET revoked_at = clock_timestamp(), revoked_by = $2
          WHERE user_id = $1 AND role = 'CASHIER'`,
        [toRevoke.userId, multi.userId],
      ),
    );
    const second = await me(toRevoke);
    expect(second.body.assignments.map((a: { role: string }) => a.role)).toEqual([
      'ORGANIZER_ADMIN',
    ]);
  });

  it('personne d’un autre prestataire : son seul profil, jamais celui d’une autre personne', async () => {
    const res = await me(other);
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(other.userId);
    expect(res.body.display_name).toBe(NAMES.other);
    expect(res.body.operator_id).toBe(ops.b);
    expect(JSON.stringify(res.body)).not.toContain(multi.userId);
    expect(JSON.stringify(res.body)).not.toContain(ops.a);
  });

  it('réponse : aucune clé hors StaffProfile, ni courriel ni identifiant de fournisseur', async () => {
    const res = await me(multi);
    expect(Object.keys(res.body).sort()).toEqual([
      'assignments',
      'display_name',
      'operator_id',
      'user_id',
    ]);
    for (const a of res.body.assignments)
      expect(Object.keys(a).sort()).toEqual(['role', 'scope_id', 'scope_type']);
    expect(res.text).not.toContain(EMAIL_PART);
    expect(res.text).not.toContain(multi.subject);
    expect(res.text).not.toContain(idp.config.issuer);
  });

  it('sans jeton : 401', async () => {
    expect((await request(app.getHttpServer()).get('/v1/staff/me')).status).toBe(401);
  });

  it('jeton festivalier et terminal : refus, le service n’est pas atteint', async () => {
    const { customer, device } = await withOwner(async (db) => ({
      customer: await createTestCustomer(db, ops.a),
      device: await createTestDevice(db, { operatorId: ops.a }),
    }));
    const asCustomer = await request(app.getHttpServer()).get('/v1/staff/me').set(customer.headers);
    const asDevice = await request(app.getHttpServer()).get('/v1/staff/me').set(device.headers);
    expect(asCustomer.status).toBe(401);
    expect(asDevice.status).toBe(401);
    // Terminal portant en plus un jeton de personne dans l'en-tête de guichet : refusé aussi.
    const mixed = await request(app.getHttpServer())
      .get('/v1/staff/me')
      .set({ ...device.headers, 'X-Staff-Authorization': `Bearer ${multi.token}` });
    expect(mixed.status).toBe(401);
  });

  it('personne désactivée : 401', async () => {
    const disabled = await withOwner((db) =>
      idp.createPerson(db, {
        operatorId: ops.a,
        roles: [{ role: 'OPERATOR_ADMIN', scopeType: 'OPERATOR', scopeId: ops.a }],
        status: 'DISABLED',
      }),
    );
    expect((await me(disabled)).status).toBe(401);
  });
});
