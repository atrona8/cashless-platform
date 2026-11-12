// Identité de la passerelle (research R-04, edge-routes.md « Garde `edgeMtls` »). Trois preuves, dans cet ordre, un
// seul échec = `null` (la garde répond 401 sans dire lequel) :
//   1. certificat client présenté sur la connexion TLS, reconnu par la seule autorité des passerelles
//      (`socket.authorized`, EDGE_CA_CERT_FILE) et dans sa validité (revérifiée : une session reprise ne la
//      revérifie pas) ;
//   2. empreinte SHA-256 du DER relue en base à CHAQUE requête (`identify_edge_gateway` refuse l'inconnue et la
//      `REVOKED` : la révocation est immédiate, aucune mémoire cache) ;
//   3. prestataire, événement et grand livre viennent de cette ligne, jamais de la requête.
// La raison exacte d'un refus va au journal technique (jamais le certificat, ni l'empreinte).
import { createHash } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { TenantTx } from '../../db/tenant-tx';
import type { EdgeGateway } from './edge-gateway';

interface IdentifiedRow {
  gateway_id: string;
  operator_id: string;
  event_id: string | null;
  ledger_id: string | null;
  role: 'PRIMARY' | 'STANDBY';
  status: string;
  lan_url: string | null;
  public_key: Buffer | null;
}

/** Certificat client de la connexion et son empreinte, sinon la raison du refus (journal seulement). */
export function peerFingerprint(req: Request, now: Date): Buffer | { refused: string } {
  const socket = req.socket as Partial<TLSSocket> | undefined;
  if (typeof socket?.getPeerX509Certificate !== 'function')
    return { refused: 'connexion sans TLS' };
  if (socket.authorized !== true)
    return { refused: 'certificat client absent ou hors de l’autorité des passerelles' };
  const certificate = socket.getPeerX509Certificate();
  if (!certificate) return { refused: 'certificat client absent' };
  const at = now.getTime();
  if (
    new Date(certificate.validFrom).getTime() > at ||
    new Date(certificate.validTo).getTime() <= at
  )
    return { refused: 'certificat client hors de sa validité' };
  return createHash('sha256').update(certificate.raw).digest();
}

@Injectable()
export class EdgeIdentityService {
  private readonly logger = new Logger('EdgeIdentity');

  constructor(private readonly tx: TenantTx) {}

  async identify(req: Request, now: Date = new Date()): Promise<EdgeGateway | null> {
    const fingerprint = peerFingerprint(req, now);
    if ('refused' in fingerprint) {
      this.logger.warn(`passerelle refusée : ${fingerprint.refused}`);
      return null;
    }
    // Aucun prestataire connu avant cette lecture : la fonction (SECURITY DEFINER) ne rend que la ligne de
    // l'empreinte, et refuse l'inconnue comme la révoquée par le même `no_data_found`.
    const row = await this.tx.withoutTenant(async (client) => {
      try {
        const { rows } = await client.query<IdentifiedRow>(
          `SELECT gateway_id, operator_id, event_id, ledger_id, role, status, lan_url, public_key
             FROM identify_edge_gateway($1)`,
          [fingerprint],
        );
        return rows[0] ?? null;
      } catch (error) {
        if ((error as { code?: string }).code === 'P0002') return null;
        throw error;
      }
    });
    if (!row) {
      this.logger.warn('passerelle refusée : empreinte inconnue ou passerelle révoquée');
      return null;
    }
    return {
      gatewayId: row.gateway_id,
      operatorId: row.operator_id,
      eventId: row.event_id,
      ledgerId: row.ledger_id,
      role: row.role,
      status: row.status,
      lanUrl: row.lan_url,
      publicKey: row.public_key,
    };
  }
}
