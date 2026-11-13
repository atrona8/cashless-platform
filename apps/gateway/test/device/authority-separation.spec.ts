// WP19 / A20 : une requête signée pour l'adresse de la passerelle est refusée par le vérificateur
// du central, et inversement, avec des listes d'autorités disjointes et SANS joker. Le test
// échoue si les listes se recouvrent. Le vérificateur du central est celui de l'API
// (`authorityAllowed`, `verifyRequestSignature`), importé par ce test seulement. Parité : le même
// message signé par le code du central est accepté par celui de la passerelle, et inversement.
import { generateKeyPairSync, randomBytes, sign as nodeSign } from 'node:crypto';
import {
  authorityAllowed as centralAuthorityAllowed,
  contentDigest as centralDigest,
  requestParts as centralParts,
  signRequest as centralSign,
  verifyRequestSignature as centralVerify,
} from '../../../api/src/device-identity/request-signature';
import {
  authorityEquals,
  contentDigest,
  normalizeAuthority,
  READ_COMPONENTS,
  requestParts,
  signatureBase,
  signatureParamsList,
  verifyRequestSignature,
  WRITE_COMPONENTS,
} from '../../src/device-proofs/request-signature';
import { serializeDictionary, type Item } from 'structured-headers';
import { makeBench, type Bench } from './_support/harness';

const CENTRAL_AUTHORITIES = ['api.cashless.test'];
const GATEWAY_AUTHORITY = 'edge.local:8443';
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const DEVICE = '0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b';

const request = (host: string, key: string | null = null) => ({
  method: 'GET',
  originalUrl: '/v1/device/config?x=1',
  headers: {
    host,
    'x-request-id': '5c9856f1-475e-4a45-b13d-d459c5793361',
    'content-digest': centralDigest(Buffer.alloc(0)),
    ...(key ? { 'idempotency-key': key } : {}),
  } as Record<string, string>,
});

function signFor(host: string, key: string | null = null) {
  const parts = centralParts(request(host, key));
  const created = Math.floor(Date.now() / 1000);
  const headers = centralSign(
    parts,
    { created, nonce: randomBytes(16).toString('base64url'), keyid: DEVICE },
    privateKey,
  );
  return { parts, headers };
}

describe('listes d’autorités disjointes, sans joker', () => {
  it('le test échoue si les listes se recouvrent ou contiennent un joker', () => {
    const central = CENTRAL_AUTHORITIES.map((a) => normalizeAuthority(a));
    const gateway = [GATEWAY_AUTHORITY].map((a) => normalizeAuthority(a));
    expect(central.filter((a) => gateway.includes(a))).toEqual([]);
    for (const a of [...central, ...gateway]) expect(a).not.toContain('*');
  });
});

describe('requête signée pour la passerelle, présentée au central', () => {
  it('le vérificateur du central refuse cette @authority', () => {
    const { parts } = signFor(GATEWAY_AUTHORITY);
    expect(parts.authority).toBe(GATEWAY_AUTHORITY);
    expect(centralAuthorityAllowed(parts.authority, CENTRAL_AUTHORITIES)).toBe(false);
  });

  it('même avec un joker de développement du central, l’hôte de la passerelle ne passe pas', () => {
    expect(centralAuthorityAllowed('edge.local:8443', ['api.cashless.test:*'])).toBe(false);
  });
});

describe('requête signée pour le central, présentée à la passerelle', () => {
  it('égalité exacte : l’autorité du central est refusée', () => {
    const { parts } = signFor('api.cashless.test');
    expect(authorityEquals(parts.authority, GATEWAY_AUTHORITY)).toBe(false);
    expect(authorityEquals(GATEWAY_AUTHORITY, GATEWAY_AUTHORITY)).toBe(true);
  });

  it('un caractère de différence, une casse, un port : refusé ou normalisé exactement', () => {
    expect(authorityEquals('edge.local:8444', GATEWAY_AUTHORITY)).toBe(false);
    expect(authorityEquals('edge.local:84430', GATEWAY_AUTHORITY)).toBe(false);
    expect(authorityEquals('xedge.local:8443', GATEWAY_AUTHORITY)).toBe(false);
    expect(authorityEquals('edge.local', GATEWAY_AUTHORITY)).toBe(false);
    expect(authorityEquals('edge.local:8443', 'EDGE.LOCAL:8443')).toBe(true); // normalisation RFC 9421
  });

  it('AUCUN joker, même configuré : `host:*` n’égale jamais rien', () => {
    expect(authorityEquals('edge.local:8443', 'edge.local:*')).toBe(false);
    expect(authorityEquals('edge.local:*', 'edge.local:*')).toBe(false);
    expect(authorityEquals('edge.local:8443', '*')).toBe(false);
    expect(authorityEquals('edge.local:8443', null)).toBe(false);
  });
});

describe('de bout en bout sur la passerelle', () => {
  let b: Bench;
  beforeAll(async () => {
    b = await makeBench({ failureFloorMs: 5 });
  });
  afterAll(async () => b.close());

  it('requête signée ET adressée au central : 401 ; rejouée vers la passerelle avec sa signature : 401', async () => {
    const d = await b.newDevice();
    const forCentral = await b.request(d, {
      path: '/v1/device/seq-status',
      authority: 'api.cashless.test',
      hostHeader: 'api.cashless.test',
    });
    expect(forCentral.status).toBe(401);
    const sameSignatureNewHost = await b.request(d, {
      path: '/v1/device/seq-status',
      authority: 'api.cashless.test',
      hostHeader: b.authority,
    });
    expect(sameSignatureNewHost.status).toBe(401);
  });

  it('configuration jokerisée de la passerelle : toute requête est refusée', async () => {
    const d = await b.newDevice();
    const saved = b.config.requestAuthority;
    b.config.requestAuthority = `127.0.0.1:*`;
    try {
      expect((await b.request(d, { path: '/v1/device/seq-status' })).status).toBe(401);
    } finally {
      b.config.requestAuthority = saved;
    }
  });
});

describe('parité avec le code du central (même base de signature)', () => {
  it('signé par le central, vérifié par la passerelle (lecture et écriture)', () => {
    for (const key of [null, 'T-1:1']) {
      const { parts, headers } = signFor(GATEWAY_AUTHORITY, key);
      const mine = requestParts(request(GATEWAY_AUTHORITY, key));
      expect(mine).toEqual(parts);
      const verified = verifyRequestSignature(
        mine,
        { signatureInput: headers.signatureInput, signature: headers.signature },
        DEVICE,
        publicKey,
      );
      expect(verified.nonce).toHaveLength(16);
    }
  });

  it('signé par la passerelle, vérifié par le central', () => {
    for (const key of [null, 'T-1:1']) {
      const parts = requestParts(request(GATEWAY_AUTHORITY, key));
      const list = signatureParamsList(key === null ? READ_COMPONENTS : WRITE_COMPONENTS, {
        created: Math.floor(Date.now() / 1000),
        nonce: randomBytes(16).toString('base64url'),
        keyid: DEVICE,
      });
      const signature = nodeSign('sha256', Buffer.from(signatureBase(parts, list)), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      });
      const verified = centralVerify(
        parts,
        {
          signatureInput: serializeDictionary(new Map([['dev', list]])),
          signature: serializeDictionary(new Map([['dev', [signature, new Map()] as Item]])),
        },
        DEVICE,
        publicKey,
      );
      expect(verified.keyid).toBe(DEVICE);
    }
  });

  it('même Content-Digest que le central', () => {
    const body = Buffer.from('{"a":1}');
    expect(contentDigest(body)).toBe(centralDigest(body));
  });

  it('base de signature écrite à la main (RFC 9421 §2.5)', () => {
    const parts = requestParts(request('edge.local:8443'));
    const list = signatureParamsList(READ_COMPONENTS, {
      created: 1797000000,
      nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
      keyid: DEVICE,
    });
    expect(signatureBase(parts, list)).toBe(
      [
        '"@method": GET',
        '"@authority": edge.local:8443',
        '"@path": /v1/device/config',
        '"@query": ?x=1',
        `"content-digest": ${centralDigest(Buffer.alloc(0))}`,
        '"x-request-id": 5c9856f1-475e-4a45-b13d-d459c5793361',
        `"@signature-params": ("@method" "@authority" "@path" "@query" "content-digest" "x-request-id");created=1797000000;nonce="AAAAAAAAAAAAAAAAAAAAAA";keyid="${DEVICE}";alg="ecdsa-p256-sha256"`,
      ].join('\n'),
    );
  });
});
