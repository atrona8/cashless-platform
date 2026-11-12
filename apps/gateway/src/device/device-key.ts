// Clé d'origine d'une opération de terminal : `<serial>:<seq>`, `seq` complété à gauche de zéros
// jusqu'à 4 chiffres, jamais tronqué (décision 52). Même forme que `deviceKey` du central
// (apps/api/src/idempotency/device-key.ts) : sans elle, une même opération reçue du terminal et de
// la passerelle ne serait pas reconnue comme un doublon.

export function deviceKey(serial: string, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1)
    throw new Error('deviceKey : seq hors de [1, 2^53 - 1]');
  return `${serial}:${String(seq).padStart(4, '0')}`;
}
