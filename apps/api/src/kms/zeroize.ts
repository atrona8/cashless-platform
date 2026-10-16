// Effacement des secrets en mémoire (SPECIFICATION §7.4, §7.6 ; NFR-003) : un mot de passe ou une clé de données en
// clair n'existe que le temps de servir, puis son tampon est mis à zéro.

export function zeroize(...buffers: Array<Uint8Array | null | undefined>): void {
  for (const buffer of buffers) buffer?.fill(0);
}

/** Exécute `fn` avec le secret, puis met le tampon à zéro, que `fn` réussisse ou non. */
export async function withSecret<T>(secret: Buffer, fn: (secret: Buffer) => Promise<T> | T): Promise<T> {
  try {
    return await fn(secret);
  } finally {
    zeroize(secret);
  }
}
