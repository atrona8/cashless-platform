// Erreurs typées du client du central (interfaces.md § 7, contracts/edge-routes.md « Erreurs de
// bascule »). Un code inconnu n'est JAMAIS transformé en succès (`UNKNOWN_CENTRAL_ERROR`).

/** Codes du contrat que la passerelle sait traiter. */
export const CENTRAL_PROBLEM_CODES = [
  'HANDOVER_INVALID_STATE',
  'EDGE_NOT_CAUGHT_UP',
  'STALE_AUTHORITY_EPOCH',
  'SEQ_OUT_OF_ORDER',
  'CHAIN_BROKEN',
  'BATCH_SIGNATURE_INVALID',
  'BATCH_TOO_LARGE',
  'DEBIT_AUTHORITY_EDGE',
  'DEBIT_AUTHORITY_MOVING',
] as const;
export type CentralProblemCode = (typeof CENTRAL_PROBLEM_CODES)[number];

export type CentralErrorCode =
  | CentralProblemCode
  /** 401 ou 403 : le central refuse le certificat de la passerelle (révoquée). */
  | 'CERTIFICATE_REJECTED'
  /** Réponse HTTP d'erreur dont le code n'est pas connu (ou sans corps conforme). */
  | 'UNKNOWN_CENTRAL_ERROR'
  /** Succès HTTP au corps illisible ou statut de succès inattendu : jamais pris pour un succès. */
  | 'MALFORMED_RESPONSE'
  /** Corps tronqué (connexion coupée avant la fin). */
  | 'TRUNCATED_RESPONSE'
  /** Connexion impossible, coupée, ou certificat du central différent de l'épinglage. */
  | 'NETWORK'
  | 'PINNING_FAILED'
  | 'TIMEOUT'
  | 'ABORTED';

export class CentralError extends Error {
  constructor(
    readonly code: CentralErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly details: {
      missingEdgeSeqs?: number[];
      authorityEpoch?: number;
      problemCode?: string;
    } = {},
  ) {
    super(message);
    this.name = 'CentralError';
  }

  /** Le lien est coupé ou lent : la reprise est du ressort de l'appelant. */
  get isLinkFailure(): boolean {
    return (
      this.code === 'NETWORK' ||
      this.code === 'TIMEOUT' ||
      this.code === 'TRUNCATED_RESPONSE' ||
      this.code === 'PINNING_FAILED'
    );
  }

  get isCertificateRejected(): boolean {
    return this.code === 'CERTIFICATE_REJECTED';
  }
}

const KNOWN = new Set<string>(CENTRAL_PROBLEM_CODES);

/** Transforme une réponse HTTP d'erreur en erreur typée. */
export function errorFromResponse(status: number, body: unknown): CentralError {
  if (status === 401 || status === 403) {
    return new CentralError(
      'CERTIFICATE_REJECTED',
      `central : certificat refusé (${status})`,
      status,
    );
  }
  const record =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const code = typeof record.code === 'string' ? record.code : null;
  if (code !== null && KNOWN.has(code)) {
    const missing = Array.isArray(record.missing_edge_seqs)
      ? record.missing_edge_seqs.filter((n): n is number => Number.isSafeInteger(n))
      : undefined;
    const epoch = Number.isSafeInteger(record.authority_epoch)
      ? (record.authority_epoch as number)
      : undefined;
    return new CentralError(code as CentralProblemCode, `central : ${code}`, status, {
      ...(missing ? { missingEdgeSeqs: missing } : {}),
      ...(epoch !== undefined ? { authorityEpoch: epoch } : {}),
      problemCode: code,
    });
  }
  return new CentralError(
    'UNKNOWN_CENTRAL_ERROR',
    `central : réponse d'erreur inconnue (statut ${status})`,
    status,
    code === null ? {} : { problemCode: code.slice(0, 64) },
  );
}
