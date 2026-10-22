// Empreinte de requête à clé (OP-N54, ADR-99, research R-13) : l'empreinte du registre
// d'idempotence ne se recalcule pas à partir de la requête seule. Chemin concret et appelant
// (OP-N71, ADR-116) : la même clé sur une autre ressource, ou par un autre appelant, change
// l'empreinte.
import { createHash, createHmac } from 'node:crypto';
import type { Request } from 'express';
import {
  concretePath,
  requestCaller,
  requestHash,
  routeTemplate,
} from '../../../src/idempotency/request-hash';

const KEY_A = Buffer.alloc(32, 0xa5);
const KEY_B = Buffer.alloc(32, 0x5a);
const PATH = '/v1/media/0b5f4c1e-8f1b-4d55-9a3c-1f2e3d4c5b6a/claims';
const PERSON = { person: '7d1c2a9e-3b4f-4c5d-8e6f-0a1b2c3d4e5f' };
const OTHER_PERSON = { person: '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b' };
const BODY = { claim_code: 'K7QM4XH9RT', email: 'festivalier@example.org' };
const JCS_BODY = '{"claim_code":"K7QM4XH9RT","email":"festivalier@example.org"}';
const MESSAGE = `POST\n${PATH}\n{"person":"${PERSON.person}"}\n${JCS_BODY}`;

describe('requestHash (OP-N54)', () => {
  it('est un HMAC-SHA256 sous la clé, jamais le SHA-256 de la requête seule', () => {
    const hash = requestHash('POST', PATH, PERSON, BODY, KEY_A);
    expect(hash).toBe(createHmac('sha256', KEY_A).update(MESSAGE, 'utf8').digest('hex'));
    expect(hash).not.toBe(createHash('sha256').update(MESSAGE, 'utf8').digest('hex'));
  });

  it('deux clés donnent deux empreintes', () => {
    expect(requestHash('POST', PATH, PERSON, BODY, KEY_A)).not.toBe(
      requestHash('POST', PATH, PERSON, BODY, KEY_B),
    );
  });

  it('même requête, même empreinte, au format de la contrainte `api_idempotency_hash_hex`', () => {
    const hash = requestHash('post', PATH, PERSON, BODY, KEY_A);
    expect(hash).toBe(requestHash('POST', PATH, { ...PERSON }, { ...BODY }, KEY_A));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('corps réordonné : même empreinte (JCS) ; autre corps, autre chemin : autre empreinte', () => {
    const reordered = { email: BODY.email, claim_code: BODY.claim_code };
    const hash = requestHash('POST', PATH, PERSON, BODY, KEY_A);
    expect(requestHash('POST', PATH, PERSON, reordered, KEY_A)).toBe(hash);
    expect(
      requestHash('POST', PATH, PERSON, { ...BODY, claim_code: 'K7QM4XH9RU' }, KEY_A),
    ).not.toBe(hash);
    expect(requestHash('POST', '/v1/media/:media_id/claims', PERSON, BODY, KEY_A)).not.toBe(hash);
  });

  it('corps absent ou vide : empreinte d’un corps `null`', () => {
    const hash = requestHash('POST', PATH, PERSON, null, KEY_A);
    expect(requestHash('POST', PATH, PERSON, undefined, KEY_A)).toBe(hash);
    expect(requestHash('POST', PATH, PERSON, '', KEY_A)).toBe(hash);
  });

  it('refuse une clé de moins de 32 octets, sans la reprendre dans le message', () => {
    const short = Buffer.from('cle-courte-secrete', 'utf8');
    expect(() => requestHash('POST', PATH, PERSON, BODY, short)).toThrow(/32 octets/);
    expect(() => requestHash('POST', PATH, PERSON, BODY, Buffer.alloc(0))).toThrow(/32 octets/);
    expect.assertions(3);
    try {
      requestHash('POST', PATH, PERSON, BODY, short);
    } catch (error) {
      expect(String(error)).not.toContain('cle-courte-secrete');
    }
  });
});

describe('requestHash : chemin concret et appelant (OP-N71, ADR-116)', () => {
  const revoke = (id: string) => `/v1/devices/${id}/revoke`;
  const A = '3c0a8f62-1d2e-4b3c-9d4e-5f6a7b8c9d0e';
  const B = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';

  it('même clé, même corps, deux `:id` : deux empreintes', () => {
    const body = { reason: 'perdu' };
    expect(requestHash('POST', revoke(A), PERSON, body, KEY_A)).not.toBe(
      requestHash('POST', revoke(B), PERSON, body, KEY_A),
    );
  });

  it('même requête par deux personnes : deux empreintes', () => {
    expect(requestHash('POST', PATH, PERSON, BODY, KEY_A)).not.toBe(
      requestHash('POST', PATH, OTHER_PERSON, BODY, KEY_A),
    );
  });

  it('route de guichet : personne ET terminal, l’un sans l’autre ne suffit pas', () => {
    const device = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const both = requestHash('POST', PATH, { ...PERSON, device }, BODY, KEY_A);
    expect(requestHash('POST', PATH, { device, ...PERSON }, BODY, KEY_A)).toBe(both);
    expect(requestHash('POST', PATH, PERSON, BODY, KEY_A)).not.toBe(both);
    expect(requestHash('POST', PATH, { device }, BODY, KEY_A)).not.toBe(both);
    expect(requestHash('POST', PATH, { ...OTHER_PERSON, device }, BODY, KEY_A)).not.toBe(both);
  });

  it('un identifiant ne passe pas d’un membre à l’autre de l’appelant', () => {
    const id = PERSON.person;
    expect(requestHash('POST', PATH, { person: id }, BODY, KEY_A)).not.toBe(
      requestHash('POST', PATH, { device: id }, BODY, KEY_A),
    );
    expect(requestHash('POST', PATH, { customer: id }, BODY, KEY_A)).not.toBe(
      requestHash('POST', PATH, { device: id }, BODY, KEY_A),
    );
  });
});

describe('concretePath, requestCaller', () => {
  const req = (fields: Record<string, unknown>) => fields as unknown as Request;

  it('chemin concret : paramètres compris, chaîne de requête exclue', () => {
    const r = req({
      baseUrl: '',
      path: '/v1/devices/abc/revoke',
      originalUrl: '/v1/devices/abc/revoke?x=1',
      route: { path: '/v1/devices/:device_id/revoke' },
    });
    expect(concretePath(r)).toBe('/v1/devices/abc/revoke');
    // Le modèle de route ne sert plus qu'aux journaux.
    expect(routeTemplate(r)).toBe('/v1/devices/:device_id/revoke');
  });

  it('appelant : ce que les gardes ont posé, rien de ce que la requête déclare', () => {
    expect(requestCaller(req({ headers: { 'x-test-user': 'u' }, body: { person: 'x' } }))).toEqual(
      {},
    );
    expect(
      requestCaller(
        req({
          principal: { userId: 'u-1', operatorId: 'o' },
          device: { deviceId: 'd-1', operatorId: 'o' },
          customer: { customerId: 'c-1', operatorId: 'o' },
        }),
      ),
    ).toEqual({ person: 'u-1', device: 'd-1', customer: 'c-1' });
    expect(requestCaller(req({ principal: { userId: 'u-2' } }))).toEqual({ person: 'u-2' });
  });
});
