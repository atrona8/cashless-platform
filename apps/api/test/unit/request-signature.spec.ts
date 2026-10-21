// Profil de signature des requêtes de terminal (research R-04, lot WP12, T056/T062) : base de
// signature exacte sur un exemple écrit à la main (la vérification ne s'appuie pas sur
// `signRequest`), puis chaque écart au profil refusé.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  authorityAllowed,
  contentDigest,
  normalizeAuthority,
  requestParts,
  signatureBase,
  signatureParamsList,
  SignatureProfileError,
  signRequest,
  verifyContentDigest,
  verifyRequestSignature,
  WRITE_COMPONENTS,
  type SignedRequestParts,
} from '../../src/device-identity/request-signature';

const DEVICE = '3f7d2c10-6a55-4b6e-9d0e-1c2b3a4d5e6f';
const REQUEST_ID = '0b9f4c6e-2d1a-4c3b-8e7f-6a5b4c3d2e1f';
const BODY = Buffer.from('{"nfc_uid":"04a1b2c3d4e5f6","key_index":1}', 'utf8');
const PARAMS = { created: 1797000000, nonce: 'q3RfUjx7d8bL0mNp4sVw2A', keyid: DEVICE };
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const parts = (overrides: Partial<SignedRequestParts> = {}): SignedRequestParts => ({
  method: 'POST',
  authority: 'api.cashless.example',
  path: '/v1/media/auth-keys',
  query: '',
  contentDigest: contentDigest(BODY),
  requestId: REQUEST_ID,
  idempotencyKey: null,
  ...overrides,
});

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SignatureProfileError) return error.reason;
    throw error;
  }
  return 'accepté';
}

const verifyWith = (
  headers: { signatureInput: string; signature: string },
  p: SignedRequestParts = parts(),
  key = keys.publicKey,
) => reason(() => verifyRequestSignature(p, headers, DEVICE, key));

describe('base de signature (RFC 9421, profil R-04)', () => {
  it('exemple fixe : base exacte, ligne par ligne', () => {
    const digest = `sha-256=:${createHash('sha256').update(BODY).digest('base64')}:`;
    expect(contentDigest(BODY)).toBe(digest);
    const base = signatureBase(
      parts(),
      signatureParamsList(
        ['@method', '@authority', '@path', '@query', 'content-digest', 'x-request-id'],
        PARAMS,
      ),
    );
    expect(base).toBe(
      [
        '"@method": POST',
        '"@authority": api.cashless.example',
        '"@path": /v1/media/auth-keys',
        '"@query": ?',
        `"content-digest": ${digest}`,
        `"x-request-id": ${REQUEST_ID}`,
        '"@signature-params": ("@method" "@authority" "@path" "@query" "content-digest" ' +
          `"x-request-id");created=1797000000;nonce="q3RfUjx7d8bL0mNp4sVw2A";keyid="${DEVICE}";` +
          'alg="ecdsa-p256-sha256"',
      ].join('\n'),
    );
  });

  it('écriture : idempotency-key couvert, @query brute', () => {
    const write = parts({ idempotencyKey: 'TPE-01:0003', query: 'a=1&b=%20' });
    const base = signatureBase(write, signatureParamsList(WRITE_COMPONENTS, PARAMS));
    expect(base).toContain('"@query": ?a=1&b=%20\n');
    expect(base).toContain('"idempotency-key": TPE-01:0003\n"@signature-params": (');
  });

  it('signature écrite à la main sur la base fixe : acceptée, created et nonce rendus', () => {
    const list = signatureParamsList(
      ['@method', '@authority', '@path', '@query', 'content-digest', 'x-request-id'],
      PARAMS,
    );
    const raw = sign('sha256', Buffer.from(signatureBase(parts(), list)), {
      key: keys.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    const headers = {
      signatureInput:
        'dev=("@method" "@authority" "@path" "@query" "content-digest" "x-request-id")' +
        `;created=1797000000;nonce="q3RfUjx7d8bL0mNp4sVw2A";keyid="${DEVICE}"` +
        ';alg="ecdsa-p256-sha256"',
      signature: `dev=:${raw.toString('base64')}:`,
    };
    const verified = verifyRequestSignature(parts(), headers, DEVICE, keys.publicKey);
    expect(verified.created).toEqual(new Date(1797000000 * 1000));
    expect(verified.nonce).toEqual(Buffer.from(PARAMS.nonce, 'base64url'));
    // signRequest produit les mêmes en-têtes d'entrée (geste symétrique).
    expect(signRequest(parts(), PARAMS, keys.privateKey).signatureInput).toBe(
      headers.signatureInput,
    );
  });
});

describe('refus du profil', () => {
  const signed = (p = parts(), components?: readonly string[], params = PARAMS) =>
    signRequest(p, params, keys.privateKey, components);

  it('chaque composant manquant : refusé', () => {
    const all = ['@method', '@authority', '@path', '@query', 'content-digest', 'x-request-id'];
    for (const missing of all) {
      const components = all.filter((c) => c !== missing);
      expect(verifyWith(signed(parts(), components))).toMatch(/composants attendus/);
    }
  });

  it('composant en trop, ordre changé, idempotency-key absent d’une écriture : refusés', () => {
    const write = parts({ idempotencyKey: 'TPE-01:0004' });
    expect(verifyWith(signed(write, WRITE_COMPONENTS), parts())).toMatch(/composants attendus/);
    const swapped = ['@authority', '@method', '@path', '@query', 'content-digest', 'x-request-id'];
    expect(verifyWith(signed(parts(), swapped))).toMatch(/composants attendus/);
    const readOnly = WRITE_COMPONENTS.slice(0, -1);
    expect(verifyWith(signed(write, readOnly), write)).toMatch(/composants attendus/);
    expect(verifyWith(signed(write), write)).toBe('accepté');
  });

  it('@authority, chemin, requête, méthode ou identifiant différents : signature invalide', () => {
    const headers = signed();
    for (const changed of [
      { authority: 'edge.cashless.example' },
      { path: '/v1/taps' },
      { query: 'x=1' },
      { method: 'PUT' },
      { requestId: '0b9f4c6e-2d1a-4c3b-8e7f-6a5b4c3d2e10' },
    ])
      expect(verifyWith(headers, parts(changed))).toBe('signature ECDSA invalide');
    expect(verifyWith(headers, parts(), other.publicKey)).toBe('signature ECDSA invalide');
  });

  it('corps modifié : Content-Digest refusé ; sha-512, deux empreintes, paramètre : refusés', () => {
    expect(reason(() => verifyContentDigest(contentDigest(BODY), BODY))).toBe('accepté');
    expect(reason(() => verifyContentDigest(contentDigest(BODY), Buffer.from('{}')))).toMatch(
      /différent du corps/,
    );
    expect(reason(() => verifyContentDigest(undefined, BODY))).toMatch(/absent/);
    const b64 = createHash('sha512').update(BODY).digest('base64');
    expect(reason(() => verifyContentDigest(`sha-512=:${b64}:`, BODY))).toMatch(/sha-256 seul/);
    expect(
      reason(() => verifyContentDigest(`${contentDigest(BODY)}, sha-512=:${b64}:`, BODY)),
    ).toMatch(/sha-256 seul/);
    expect(reason(() => verifyContentDigest(`${contentDigest(BODY)};x=1`, BODY))).toMatch(
      /sans paramètre/,
    );
    // Corps vide : empreinte de la chaîne vide.
    expect(reason(() => verifyContentDigest(contentDigest(Buffer.alloc(0)), Buffer.alloc(0)))).toBe(
      'accepté',
    );
  });

  it('signature encodée en DER : refusée', () => {
    const list = signatureParamsList(
      ['@method', '@authority', '@path', '@query', 'content-digest', 'x-request-id'],
      PARAMS,
    );
    const der = sign('sha256', Buffer.from(signatureBase(parts(), list)), keys.privateKey);
    const headers = { ...signed(), signature: `dev=:${der.toString('base64')}:` };
    expect(verifyWith(headers)).toMatch(/64 octets|ECDSA invalide/);
  });

  it('expires, paramètre inconnu, alg ou keyid différents, nonce trop court : refusés', () => {
    const base = signed().signatureInput;
    expect(verifyWith({ ...signed(), signatureInput: `${base};expires=1797000300` })).toBe(
      'paramètre expires refusé',
    );
    expect(verifyWith({ ...signed(), signatureInput: `${base};tag="x"` })).toMatch(/paramètres/);
    expect(
      verifyWith({ ...signed(), signatureInput: base.replace('ecdsa-p256-sha256', 'ed25519') }),
    ).toMatch(/alg/);
    expect(verifyWith(signed(parts(), undefined, { ...PARAMS, keyid: 'autre' }))).toMatch(/keyid/);
    expect(verifyWith(signed(parts(), undefined, { ...PARAMS, nonce: 'AAAA' }))).toMatch(/nonce/);
  });

  it('libellé dev seul : une autre signature est ignorée, son absence refusée', () => {
    const own = signed();
    expect(
      verifyWith({
        signatureInput: `x=("@method");created=1;nonce="a";keyid="k";alg="y", ${own.signatureInput}`,
        signature: `x=:AAAA:, ${own.signature}`,
      }),
    ).toBe('accepté');
    expect(
      verifyWith({
        signatureInput: own.signatureInput.replace(/^dev=/, 'app='),
        signature: own.signature.replace(/^dev=/, 'app='),
      }),
    ).toMatch(/libellé dev absent/);
    expect(verifyWith({ signatureInput: 'dev=(', signature: own.signature })).toMatch(/illisible/);
  });
});

describe('lecture de la requête et autorités', () => {
  const req = (headers: Record<string, string | string[] | undefined>, url = '/v1/taps?x=1') => ({
    method: 'post',
    originalUrl: url,
    headers: {
      host: 'API.Cashless.Example:443',
      'x-request-id': REQUEST_ID,
      'content-digest': contentDigest(BODY),
      ...headers,
    },
  });

  it('parties lues telles que reçues : Host normalisé, requête brute, clé d’idempotence', () => {
    expect(requestParts(req({ 'idempotency-key': 'TPE-01:0001' }))).toEqual({
      method: 'POST',
      authority: 'api.cashless.example',
      path: '/v1/taps',
      query: 'x=1',
      contentDigest: contentDigest(BODY),
      requestId: REQUEST_ID,
      idempotencyKey: 'TPE-01:0001',
    });
    expect(requestParts(req({}, '/v1/taps')).query).toBe('');
  });

  it('X-Request-Id absent ou mal formé, Host absent ou invalide : refusés', () => {
    expect(reason(() => requestParts(req({ 'x-request-id': undefined })))).toMatch(/X-Request-Id/);
    expect(reason(() => requestParts(req({ 'x-request-id': 'abc' })))).toMatch(/UUID/);
    expect(reason(() => requestParts(req({ host: undefined })))).toMatch(/Host/);
    expect(reason(() => requestParts(req({ host: 'a@b.example' })))).toMatch(/Host/);
    expect(reason(() => requestParts(req({ 'content-digest': undefined })))).toMatch(/absent/);
  });

  it('autorités servies : égalité exacte, joker de port hors production', () => {
    expect(normalizeAuthority('LocalHost:8443')).toBe('localhost:8443');
    expect(authorityAllowed('api.cashless.example', ['api.cashless.example'])).toBe(true);
    expect(authorityAllowed('edge.cashless.example', ['api.cashless.example'])).toBe(false);
    expect(authorityAllowed('api.cashless.example:8443', ['api.cashless.example'])).toBe(false);
    expect(authorityAllowed('localhost:51234', ['localhost:*'])).toBe(true);
    expect(authorityAllowed('localhost.evil:1', ['localhost:*'])).toBe(false);
  });
});
