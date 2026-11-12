// Demande de certificat PKCS#10 (RFC 2986) signée par le port matériel : la clé privée ne sort
// jamais du port, donc
// la demande est assemblée en DER ici et seule la signature (ES256, `r ‖ s`) est demandée au port.
// Aucune dépendance
// nouvelle (ADR-78) : les structures ASN.1 d'une demande à sujet simple tiennent en quelques
// lignes.
import type { HardwareKeystore, KeyUse } from '../key-store/hardware-keystore.port';

const der = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  const n = body.length;
  const length =
    n < 0x80
      ? Buffer.from([n])
      : n < 0x100
        ? Buffer.from([0x81, n])
        : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};

/** Entier ASN.1 positif minimal à partir d'octets non signés. */
function derInteger(raw: Buffer): Buffer {
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start += 1;
  let body = raw.subarray(start);
  if (body[0]! & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return der(0x02, body);
}

/** Signature ES256 brute (r ‖ s, 64 octets) vers `ECDSA-Sig-Value` DER. */
export function p1363ToDer(signature: Buffer): Buffer {
  if (signature.length !== 64) throw new Error('signature ES256 de 64 octets attendue');
  return der(0x30, derInteger(signature.subarray(0, 32)), derInteger(signature.subarray(32)));
}

const OID_COMMON_NAME = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);
const OID_ECDSA_SHA256 = Buffer.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);

/** Demande PEM de sujet `CN=<serial>`, pour la clé publique de `use` du port, signée par cette même clé. */
export async function buildCsrPem(
  keystore: HardwareKeystore,
  use: Exclude<KeyUse, 'agreement'>,
  commonName: string,
): Promise<string> {
  const spki = await keystore.publicKey(use);
  const subject = der(
    0x30,
    der(0x31, der(0x30, OID_COMMON_NAME, der(0x0c, Buffer.from(commonName, 'utf8')))),
  );
  const info = der(0x30, Buffer.from([0x02, 0x01, 0x00]), subject, spki, Buffer.from([0xa0, 0x00]));
  const signature = p1363ToDer(await keystore.sign(use, info));
  const request = der(
    0x30,
    info,
    der(0x30, OID_ECDSA_SHA256),
    der(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  const lines = request.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE REQUEST-----\n${lines.join('\n')}\n-----END CERTIFICATE REQUEST-----\n`;
}
