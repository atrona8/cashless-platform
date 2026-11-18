// Droits des parties d'un grand livre (mission 9b, lot WP08, T035 ; FR-009 ; décision 8 du porteur).
// `party_position` est DÉJÀ diminué des versements en cours (`PAYOUT_INITIATED` débite le compte de droits ;
// `PAYOUT_FAILED` le recrédite) : `available = party_position` (plafond d'un nouveau versement), `in_progress` =
// versements `INITIATED` non réglés, `net_claim = party_position + in_progress` (droit avant versements en cours).
// Ainsi `available = net_claim - in_progress` sans double déduction. Une seule requête par page.
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../db/tenant-tx';

/** Natures de partie qui peuvent recevoir un versement. */
export const PAYEE_KINDS = ['MERCHANT', 'ORGANIZER', 'OPERATOR', 'PLATFORM'] as const;
export type PayeeKind = (typeof PAYEE_KINDS)[number];

export interface PartyEntitlement {
  partyId: string;
  partyKind: PayeeKind;
  legalName: string;
  currency: string;
  /** Droit avant versements en cours : `party_position` + `inProgress` (décision 8 du porteur). */
  netClaim: bigint;
  /** Versements `INITIATED` non réglés : information, jamais déduite. */
  inProgress: bigint;
  /** Plafond d'un nouveau versement : le droit net courant, jamais négatif. */
  available: bigint;
}

interface Row {
  party_id: string;
  party_kind: PayeeKind;
  legal_name: string;
  currency: string;
  net_claim: string;
  in_progress: string;
}

function toEntitlement(row: Row): PartyEntitlement {
  // `party_position` est déjà diminué des versements en cours : le droit avant versements les y rajoute.
  const position = BigInt(row.net_claim);
  const inProgress = BigInt(row.in_progress);
  return {
    partyId: row.party_id,
    partyKind: row.party_kind,
    legalName: row.legal_name,
    currency: row.currency,
    netClaim: position + inProgress,
    inProgress,
    available: position > 0n ? position : 0n,
  };
}

const SELECT = `
  SELECT pp.owner_party_id AS party_id, p.kind::text AS party_kind, p.legal_name,
         trim(l.currency) AS currency, pp.net_claim::text AS net_claim,
         coalesce(pend.total, 0)::text AS in_progress
    FROM party_position pp
    JOIN party p ON p.id = pp.owner_party_id
    JOIN ledger l ON l.id = pp.ledger_id
    LEFT JOIN (SELECT beneficiary_id, sum(amount) AS total FROM payout
                WHERE ledger_id = $1 AND status = 'INITIATED' GROUP BY beneficiary_id) pend
           ON pend.beneficiary_id = pp.owner_party_id
   WHERE pp.ledger_id = $1 AND p.kind::text = ANY($2::text[])`;

@Injectable()
export class EntitlementService {
  /** Une page de droits, par identifiant de partie croissant (`after` : dernier identifiant lu). */
  async forLedger(
    client: TxClient,
    ledgerId: string,
    page: { after: string | null; limit: number },
  ): Promise<PartyEntitlement[]> {
    const { rows } = await client.query<Row>(
      `${SELECT} AND ($3::uuid IS NULL OR pp.owner_party_id > $3::uuid)
        ORDER BY pp.owner_party_id LIMIT $4`,
      [ledgerId, [...PAYEE_KINDS], page.after, page.limit],
    );
    return rows.map(toEntitlement);
  }

  /** Droits des parties demandées (précontrôle d'un lot), en une requête. */
  async forParties(
    client: TxClient,
    ledgerId: string,
    partyIds: readonly string[],
  ): Promise<Map<string, PartyEntitlement>> {
    const { rows } = await client.query<Row>(`${SELECT} AND pp.owner_party_id = ANY($3::uuid[])`, [
      ledgerId,
      [...PAYEE_KINDS],
      [...partyIds],
    ]);
    return new Map(rows.map((row) => [row.party_id, toEntitlement(row)]));
  }
}
