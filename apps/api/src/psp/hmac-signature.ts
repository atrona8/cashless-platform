// Signature des notifications PSP : en-tête `t=<unix>,v1=<hex>[,v1=<hex>]`, HMAC-SHA256 sur `t.corps_brut`.
// Partagé avec WP12. Les deux secrets sont toujours évalués contre toutes les signatures, sans sortie
// anticipée ; la signature est jugée avant l'horodatage.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PspSecrets } from './psp-secret-store.port';
import { Secret } from './secret';

export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function parseSignatureHeader(
  value: string,
): { timestamp: number; signatures: string[] } | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of value.split(',')) {
    const item = part.trim();
    const eq = item.indexOf('=');
    if (eq < 0) return null;
    const key = item.slice(0, eq).trim();
    const val = item.slice(eq + 1).trim();
    if (key === 't') {
      if (timestamp !== null || !/^[0-9]{1,15}$/.test(val)) return null;
      timestamp = Number(val);
    } else if (key === 'v1') {
      if (!/^(?:[0-9a-fA-F]{2})+$/.test(val)) return null;
      signatures.push(val.toLowerCase());
    } else return null;
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export function computeSignature(secret: Secret, timestamp: number, rawBody: Buffer): string {
  return createHmac('sha256', secret.reveal())
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
}

/** Compare à temps constant ; longueur différente : comparaison à un tampon de remplissage, résultat faux. */
function constantTimeEquals(expectedHex: string, receivedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex, 'hex');
  if (expected.length !== received.length) {
    timingSafeEqual(expected, Buffer.alloc(expected.length));
    return false;
  }
  return timingSafeEqual(expected, received);
}

export type HmacRejection =
  | 'SIGNATURE_MISSING'
  | 'SIGNATURE_MALFORMED'
  | 'SIGNATURE_INVALID'
  | 'TIMESTAMP_OUT_OF_TOLERANCE';

export type HmacVerification =
  | { ok: true; signedAt: Date; secretUsed: 'current' | 'previous' }
  | { ok: false; reason: HmacRejection };

export function verifyHmacSignature(input: {
  header: string | undefined;
  rawBody: Buffer;
  secrets: PspSecrets;
  now: Date;
}): HmacVerification {
  if (input.header === undefined || input.header.trim() === '')
    return { ok: false, reason: 'SIGNATURE_MISSING' };
  const parsed = parseSignatureHeader(input.header);
  if (parsed === null) return { ok: false, reason: 'SIGNATURE_MALFORMED' };

  const { current, previous, previousValidUntil } = input.secrets.notification;
  // Secret précédent absent : secret factice aléatoire, pour évaluer toujours deux secrets.
  const previousOrDummy = previous ?? Secret.of(randomBytes(32).toString('hex'));
  const expectedCurrent = computeSignature(current, parsed.timestamp, input.rawBody);
  const expectedPrevious = computeSignature(previousOrDummy, parsed.timestamp, input.rawBody);
  let currentMatches = false;
  let previousMatches = false;
  for (const received of parsed.signatures) {
    currentMatches = constantTimeEquals(expectedCurrent, received) || currentMatches;
    previousMatches = constantTimeEquals(expectedPrevious, received) || previousMatches;
  }
  const previousLive =
    previous !== null &&
    previousValidUntil !== null &&
    input.now.getTime() <= previousValidUntil.getTime();

  let secretUsed: 'current' | 'previous';
  if (currentMatches) secretUsed = 'current';
  else if (previousMatches && previousLive) secretUsed = 'previous';
  else return { ok: false, reason: 'SIGNATURE_INVALID' };

  const signedAtMs = parsed.timestamp * 1000;
  if (Math.abs(signedAtMs - input.now.getTime()) > WEBHOOK_TOLERANCE_SECONDS * 1000)
    return { ok: false, reason: 'TIMESTAMP_OUT_OF_TOLERANCE' };
  return { ok: true, signedAt: new Date(signedAtMs), secretUsed };
}
