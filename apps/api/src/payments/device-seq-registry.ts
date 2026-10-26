// Registre des numéros d'un terminal (mission 5b, lot WP11, T052 ; A4, A14 ; docs/sync_protocol.md §3.2 et
// §3.3, PRIORITAIRE sur la SPECIFICATION ; contracts/payments.md « Clé et registre des numéros »). Fourni à
// WP12 (annulation) et WP13 (demande QR) sans modification.
//
// Toute réponse FINALE (2xx ou 4xx) d'une route de terminal à clé `<serial>:<seq>` est enregistrée par
// `record_device_seq` :
//   - réussite : dans la transaction de l'écriture (`accept`), le terminal étant déjà tenu FOR UPDATE (le
//     service prend `SELECT … FOR UPDATE` du terminal en première instruction : la fonction exige l'issue et
//     `transaction_id`, connus seulement à la fin, et le registre est immuable — voir le compte rendu du lot) ;
//   - refus définitif 4xx : dans une transaction SÉPARÉE et validée, après l'annulation de l'écriture
//     (`reject`), avec le code du problème comme raison ;
//   - refus NON définitifs (`NON_FINAL_CODES`), 5xx, et refus levés par `record_device_seq` lui-même (`CL002`
//     même numéro autre contenu, `CL021` hors plage) : rien n'est enregistré (`isRegistrable`).
//
// `content_sha256` = SHA-256(JCS(champs chaînés présents)), sync_protocol.md §3.3. Champs d'une vente
// (`purchaseContent`) : `seq`, `type` (`PURCHASE`), `occurred_at` (chaîne telle que reçue), `amount`,
// `currency`, `tap` (lecture embarquée, telle que reçue) et `lines` (telles que reçues). JAMAIS `tap_id`,
// `customer_qr_token`, `vendor_session_id` ni un champ d'état (`snapshot_version`, `config_id`,
// `online_*`…). La forme devra être celle des lots hors ligne (mission 7).
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import canonicalize from 'canonicalize';
import type { TxClient } from '../db/tenant-tx';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import { NON_FINAL_CODES } from '../idempotency/device-key';
import { isSqlError } from '../errors/sqlstate-map';
import type { ResolvedProblem } from '../errors/problem.filter';

export type SeqChannel = 'ONLINE' | 'BATCH' | 'EDGE';

/** Champs chaînés d'une vente que le terminal a pu envoyer (noms de `OfflineOperation`). */
const PURCHASE_FIELDS = ['occurred_at', 'amount', 'currency', 'tap', 'lines'] as const;

/**
 * SHA-256 de la forme canonique (RFC 8785) des champs fournis ; les champs `undefined` sont omis (« champs
 * absents = omis »). Aucun champ d'état ne doit être passé par l'appelant.
 */
export function contentSha256(fields: Record<string, unknown>): Buffer {
  const present = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const canonical = canonicalize(present);
  if (canonical === undefined) throw new Error('content_sha256 : forme canonique impossible');
  return createHash('sha256').update(canonical, 'utf8').digest();
}

/**
 * Contenu d'une vente `createPayment` : calculé sur le corps TEL QUE REÇU (même un corps mal formé a un
 * contenu, de sorte que son refus se range au registre). `null` si le corps n'est pas un objet JSON : aucun
 * contenu calculable, rien n'est enregistré.
 */
export function purchaseContent(seq: bigint, body: unknown): Buffer | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of PURCHASE_FIELDS) picked[field] = raw[field];
  return contentSha256({ seq: seqNumber(seq), type: 'PURCHASE', ...picked });
}

/** `seq` en nombre JSON (exact jusqu'à 2^53 − 1 ; au-delà, le contrat des lots devra le dire). */
function seqNumber(seq: bigint): number {
  return Number(seq);
}

/** Ce refus doit-il être rangé au registre ? Seuls les refus 4xx définitifs, sauf ceux du registre lui-même. */
export function isRegistrable(problem: ResolvedProblem, error: unknown): boolean {
  if (problem.status < 400 || problem.status >= 500) return false;
  if (NON_FINAL_CODES.has(problem.code)) return false;
  // `CL002` (même numéro, autre contenu) et `CL021` (hors plage) viennent du registre : traduits tels quels.
  if (isSqlError(error) && (error.code === 'CL002' || error.code === 'CL021')) return false;
  return true;
}

@Injectable()
export class DeviceSeqRegistry {
  constructor(private readonly tx: TenantTx) {}

  /** Réussite : dans la transaction de l'écriture (terminal déjà tenu FOR UPDATE). */
  async accept(
    client: TxClient,
    input: { deviceId: string; seq: bigint; content: Buffer; transactionId: string },
    channel: SeqChannel = 'ONLINE',
  ): Promise<void> {
    const { rows } = await client.query<{ replayed: boolean }>(
      `SELECT replayed FROM record_device_seq($1, $2, $3, 'ACCEPTED', $4, $5)`,
      [input.deviceId, input.seq.toString(), input.content, channel, input.transactionId],
    );
    // Numéro déjà rangé avec ce contenu : cette écriture n'aurait pas dû avoir lieu (l'idempotence aurait rejoué
    // la réponse). Tout annuler plutôt que lier deux ventes à un numéro.
    if (rows[0]?.replayed !== false)
      throw new ProblemException('IDEMPOTENCY_KEY_REUSED', {
        detail: 'Ce numéro du terminal est déjà enregistré.',
      });
  }

  /**
   * Refus définitif : transaction séparée, validée, APRÈS l'annulation de l'écriture. `inside` s'exécute dans
   * cette même transaction (lecture du solde d'un refus `INSUFFICIENT_FUNDS`), après la prise du terminal.
   */
  async reject<T = void>(
    operatorId: string,
    input: { deviceId: string; seq: bigint; content: Buffer; reason: string },
    channel: SeqChannel = 'ONLINE',
    inside?: (client: TxClient) => Promise<T>,
  ): Promise<T | undefined> {
    return this.tx.run(operatorId, async (client) => {
      await client.query('SELECT 1 FROM device WHERE id = $1 FOR UPDATE', [input.deviceId]);
      const extra = inside ? await inside(client) : undefined;
      await client.query(`SELECT record_device_seq($1, $2, $3, 'REJECTED', $4, NULL, $5)`, [
        input.deviceId,
        input.seq.toString(),
        input.content,
        channel,
        input.reason,
      ]);
      return extra;
    });
  }
}
