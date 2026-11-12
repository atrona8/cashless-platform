// Preuve 1 des terminaux sur la passerelle : le certificat client de la connexion TLS (research
// R-19). Deux contrôles indépendants, tous deux exigés :
//  1. la couche TLS l'a reconnu (`socket.authorized`, CA = `GATEWAY_DEVICE_CA_FILE`) ;
//  2. la chaîne est revérifiée ICI contre la même autorité (signature de l'émetteur, noms,
//     validité sur `GatewayClock`), et le certificat n'est pas lui-même une autorité.
// Un certificat de passerelle, hors chaîne, expiré ou d'une autre autorité est refusé. Aucun
// en-tête de répartiteur n'est cru. La raison du refus va au journal technique, jamais au client.
import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TLSSocket } from 'node:tls';
import type { Request } from 'express';

export type PeerCertificate =
  | { certificate: X509Certificate; sha256: Buffer }
  | { refused: string };

/** Autorités de `GATEWAY_DEVICE_CA_FILE` (PEM, une ou plusieurs) ; illisible ou vide : aucune. */
export function loadDeviceCas(file: string | null): X509Certificate[] {
  if (file === null) return [];
  try {
    const pem = readFileSync(file, 'utf8');
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
    return blocks.map((block) => new X509Certificate(block));
  } catch {
    return [];
  }
}

function chainsTo(
  certificate: X509Certificate,
  cas: readonly X509Certificate[],
  at: number,
): boolean {
  return cas.some((ca) => {
    try {
      return (
        certificate.issuer === ca.subject &&
        certificate.verify(ca.publicKey) &&
        new Date(ca.validFrom).getTime() <= at &&
        new Date(ca.validTo).getTime() > at
      );
    } catch {
      return false;
    }
  });
}

export function peerCertificate(
  req: Request,
  now: Date,
  cas: readonly X509Certificate[],
): PeerCertificate {
  const socket = req.socket as Partial<TLSSocket> | undefined;
  if (typeof socket?.getPeerX509Certificate !== 'function')
    return { refused: 'connexion sans TLS' };
  if (socket.authorized !== true)
    return { refused: 'certificat client absent ou hors de l’autorité des terminaux' };
  const certificate = socket.getPeerX509Certificate();
  if (!certificate) return { refused: 'certificat client absent' };
  const at = now.getTime();
  if (
    new Date(certificate.validFrom).getTime() > at ||
    new Date(certificate.validTo).getTime() <= at
  )
    return { refused: 'certificat client hors de sa validité' };
  if (certificate.ca) return { refused: 'certificat d’autorité présenté comme certificat client' };
  if (!chainsTo(certificate, cas, at)) return { refused: 'chaîne non vérifiée par la passerelle' };
  return { certificate, sha256: createHash('sha256').update(certificate.raw).digest() };
}
