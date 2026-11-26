// Recherche d'un festivalier par numéro exact (mission routes-backoffice, WP08 ; FR-013, FR-014, FR-018, NFR-006,
// SC-003, SC-004 ; research D7 : l'audit ne porte jamais le numéro).
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { maskPhone } from '../../../src/search/phone-mask';
import { createTestApp } from '../../support/app';
import { contractViolations } from '../../support/contract-schema';
import { withOwner } from '../../support/db';
import type { TestPerson } from '../../support/fake-idp';
import { createMediaWorld, ownerRows, type MediaWorld } from '../../support/media-fixtures';
import {
  addWallet,
  createPhoneCustomer,
  createSearchPeople,
  createSecondEvent,
  phoneNumber,
  type SearchPeople,
} from './search-fixtures';

/** Toutes les chaînes d'une valeur JSON (clés et valeurs). */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  return out;
}

describe('recherche d’un festivalier par numéro', () => {
  let w: MediaWorld;
  let app: INestApplication;
  let people: SearchPeople;
  let second: Awaited<ReturnType<typeof createSecondEvent>>;
  let phone: string;
  let walletE1: string; // événement A
  let walletE2: string; // événement A2 (autre organisateur), même festivalier
  let customerId: string;
  let neighbor: string; // numéro voisin d'un autre festivalier
  let neighborWallet: string;
  let longerWallet: string; // numéro dont le nôtre est un préfixe
  const responses: unknown[] = [];
  const logged: string[] = [];

  const search = (person: TestPerson | null, body: unknown) => {
    const req = request(app.getHttpServer()).post('/v1/search/customers');
    return (person ? req.set('Authorization', `Bearer ${person.token}`) : req).send(body as object);
  };
  const ok = async (person: TestPerson, number: string) => {
    const res = await search(person, { phone: number });
    expect(res.status).toBe(200);
    responses.push(res.body);
    return res.body as { masked_phone: string; wallets: Array<{ wallet_id: string }> };
  };
  const auditRows = (actor: string, action = 'STAFF_CUSTOMER_SEARCH') =>
    ownerRows<{ after: Record<string, unknown>; actor_role: string }>(
      `SELECT after, actor_role FROM audit_log WHERE actor_id = $1 AND action = $2 ORDER BY id`,
      [actor, action],
    );

  beforeAll(async () => {
    w = await createMediaWorld();
    for (const stream of [process.stdout, process.stderr])
      jest.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
        logged.push(String(chunk));
        return true;
      }) as never);
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const)
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    app = await createTestApp({ identity: w.idp });
    await withOwner(async (db) => {
      second = await createSecondEvent(db, w);
      people = await createSearchPeople(db, w, second);
      const c = await createPhoneCustomer(db, {
        operatorId: w.ops.a,
        ledgerId: w.ids.ledgerA,
        funds: 2500,
      });
      phone = c.phone;
      customerId = c.customerId;
      walletE1 = c.walletId;
      walletE2 = await addWallet(db, {
        operatorId: w.ops.a,
        ledgerId: second.ledgerId,
        customerId,
        funds: 300,
      });
      const last = Number(phone.slice(-1));
      neighbor = `${phone.slice(0, -1)}${(last + 1) % 10}`;
      neighborWallet = (
        await createPhoneCustomer(db, {
          operatorId: w.ops.a,
          ledgerId: w.ids.ledgerA,
          phone: neighbor,
        })
      ).walletId;
      longerWallet = (
        await createPhoneCustomer(db, {
          operatorId: w.ops.a,
          ledgerId: w.ids.ledgerA,
          phone: `${phone}5`,
        })
      ).walletId;
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('numéro exact : ses deux portefeuilles, numéro masqué, forme du contrat', async () => {
    const res = await search(w.operatorAdminA, { phone });
    expect(res.status).toBe(200);
    responses.push(res.body);
    expect(res.body.masked_phone).toBe(maskPhone(phone));
    expect(res.body.masked_phone).toMatch(/^\+221 7\d \*\*\* \*\* \d\d$/);
    expect(res.body.wallets.map((x: { wallet_id: string }) => x.wallet_id).sort()).toEqual(
      [walletE1, walletE2].sort(),
    );
    expect(Object.keys(res.body).sort()).toEqual(['masked_phone', 'wallets']);
    expect(contractViolations('CustomerSearchResult', res.body)).toEqual([]);
    const refs = new Set(res.body.wallets.map((x: { customer_ref: string }) => x.customer_ref));
    expect(refs.size).toBe(1);
    // Même forme que getWalletOverview.
    const overview = await request(app.getHttpServer())
      .get(`/v1/search/wallets/${walletE1}`)
      .set('Authorization', `Bearer ${w.operatorAdminA.token}`);
    expect(res.body.wallets.find((x: { wallet_id: string }) => x.wallet_id === walletE1)).toEqual(
      overview.body,
    );
  });

  it('aucune recherche partielle ni approchée', async () => {
    for (const bad of [
      phone.slice(0, 6), // préfixe sans +
      '+22177', // préfixe
      `${phone} `, // espace final
      ` ${phone}`,
      phone.replace('+221', '+221 '),
      phone.slice(1), // sans +
      `${phone}%`,
      `${phone.slice(0, -2)}%%`,
      `${phone.slice(0, -2)}__`,
      '+221*',
      '',
    ]) {
      const res = await search(w.operatorAdminA, { phone: bad });
      expect({ bad: bad.length, status: res.status }).toEqual({ bad: bad.length, status: 422 });
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(res.body)).not.toContain(phone.slice(1));
    }
    expect((await search(w.operatorAdminA, {})).status).toBe(400);
    expect((await search(w.operatorAdminA, { phone: 22177 })).status).toBe(422);
    expect((await search(w.operatorAdminA, { phone, extra: 1 })).status).toBe(400);
    // Le voisin ne retrouve que son propre portefeuille ; un numéro inconnu, rien.
    const n = await ok(w.operatorAdminA, neighbor);
    expect(n.wallets.map((x) => x.wallet_id)).toEqual([neighborWallet]);
    expect((await ok(w.operatorAdminA, phoneNumber())).wallets).toEqual([]);
    // Le numéro dont celui-ci est le préfixe n'est pas rendu : égalité exacte seulement.
    const exact = await ok(w.operatorAdminA, phone);
    expect(exact.wallets.map((x) => x.wallet_id)).not.toContain(longerWallet);
    expect(exact.wallets).toHaveLength(2);
  });

  it('portée : chacun ne voit que les portefeuilles de ses événements', async () => {
    const ids = async (person: TestPerson) =>
      (await ok(person, phone)).wallets.map((x) => x.wallet_id).sort();
    expect(await ids(w.operatorAdminA)).toEqual([walletE1, walletE2].sort());
    expect(await ids(w.organizerAdminA)).toEqual([walletE1]);
    expect(await ids(people.organizerAdminA2)).toEqual([walletE2]);
    expect(await ids(w.supervisorA)).toEqual([walletE1]);
    expect(await ids(people.supervisorEventA)).toEqual([walletE1]);
    // Autre prestataire : identique à un numéro inconnu.
    expect(await ids(people.operatorAdminB)).toEqual([]);
    const other = await search(people.operatorAdminB, { phone });
    const unknown = await search(people.operatorAdminB, { phone: phoneNumber() });
    expect(other.status).toBe(unknown.status);
    expect(Object.keys(other.body)).toEqual(Object.keys(unknown.body));
  });

  it('PLATFORM_ADMIN, CASHIER, VENDOR, MERCHANT_ADMIN : 403, et aucune ligne d’audit', async () => {
    const refused = [w.platformAdmin, w.cashierA, people.vendorA, people.merchantAdminParticipant];
    for (const person of refused) {
      const res = await search(person, { phone });
      expect({ user: person.userId, status: res.status }).toEqual({
        user: person.userId,
        status: 403,
      });
      expect(JSON.stringify(res.body)).not.toContain(phone.slice(1));
      expect(await auditRows(person.userId)).toEqual([]);
      expect(await auditRows(person.userId, 'STAFF_CUSTOMER_SEARCH_RATE_LIMITED')).toEqual([]);
    }
    expect((await search(null, { phone })).status).toBe(401);
  });

  it('PLATFORM_ADMIN rattaché à un prestataire : 403 quand même, sans audit (retrait du rôle, OP-N194)', async () => {
    // Le test précédent ne prouve pas seul le retrait : `w.platformAdmin` n'a pas de prestataire. La base refuse de
    // rattacher un PLATFORM_ADMIN (« portée incompatible avec le rattachement ») ; le propriétaire contourne ce
    // déclencheur, comme `sales.spec.ts`, pour que seul le rôle de `@Roles` décide du refus.
    const attached = await withOwner(async (db) => {
      const person = await w.idp.createPerson(db, {
        operatorId: null,
        roles: [{ role: 'PLATFORM_ADMIN', scopeType: 'PLATFORM' }],
      });
      await db.query('BEGIN');
      await db.query('SET LOCAL session_replication_role = replica');
      await db.query('UPDATE app_user SET operator_id = $2 WHERE id = $1', [
        person.userId,
        w.ops.a,
      ]);
      await db.query('COMMIT');
      return person;
    });
    const res = await search(attached, { phone });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(phone.slice(1));
    expect(await auditRows(attached.userId)).toEqual([]);
    expect(await auditRows(attached.userId, 'STAFF_CUSTOMER_SEARCH_RATE_LIMITED')).toEqual([]);
  });

  it('SC-004 : chaque recherche laisse une trace, sans le numéro, même à 0 résultat', async () => {
    const actor = w.supervisorA;
    const before = (await auditRows(actor.userId)).length;
    await ok(actor, phone); // 1 résultat
    await ok(actor, phoneNumber()); // 0 résultat
    await search(actor, { phone: '+22177' }); // refus de validation : pas de recherche, pas de ligne
    const rows = await auditRows(actor.userId);
    expect(rows).toHaveLength(before + 2);
    const [found, none] = rows.slice(-2);
    expect(found!.actor_role).toBe('SUPERVISOR');
    expect(found!.after).toMatchObject({
      result_count: 1,
      customer_ids: [customerId],
      scope: { operator_wide: false, organizer_ids: [w.ids.organizerA], event_ids: [] },
    });
    expect(none!.after).toMatchObject({ result_count: 0, customer_ids: [] });
  });

  it('NFR-006 : le numéro n’apparaît ni en audit, ni en journal, ni en réponse en clair', async () => {
    // Un parcours complet, dont des refus et des erreurs.
    await ok(w.operatorAdminA, phone);
    await search(w.operatorAdminA, { phone: `${phone} ` });
    await search(w.cashierA, { phone });
    const audit = JSON.stringify(
      await ownerRows(`SELECT to_jsonb(a) AS row FROM audit_log a WHERE operator_id = $1`, [
        w.ops.a,
      ]),
    );
    const forbidden = [
      phone,
      phone.slice(1),
      maskPhone(phone),
      phone.slice(-6),
      neighbor,
      neighbor.slice(-6),
    ];
    const logs = logged.join('\n');
    for (const needle of forbidden) {
      expect({ where: 'audit', needle, found: audit.includes(needle) }).toEqual({
        where: 'audit',
        needle,
        found: false,
      });
      expect({ where: 'journaux', needle, found: logs.includes(needle) }).toEqual({
        where: 'journaux',
        needle,
        found: false,
      });
    }
    // Réponses : ni le numéro, ni sa fin ; la seule forme du numéro est `masked_phone`.
    for (const body of responses) {
      for (const text of strings(body)) {
        expect(text).not.toContain(phone.slice(1));
        expect(text).not.toContain(phone.slice(-6));
        expect(text).not.toContain(neighbor.slice(1));
      }
      expect(Object.keys(body as object).sort()).toEqual(['masked_phone', 'wallets']);
    }
  });
});

describe('maskPhone', () => {
  it.each([
    ['+221771234512', '+221 77 *** ** 12'],
    ['+33612345678', '+33 61 *** ** 78'],
    ['+12345678', '+1 ***** 78'],
    ['+4915112345678', '+49 ********* 78'],
  ])('%s', (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });

  it('ne montre jamais plus que l’indicatif et deux chiffres', () => {
    expect(maskPhone('+1234567')).not.toMatch(/\d{3}/);
    expect(maskPhone('+221771234512')).not.toContain('1234');
  });
});
