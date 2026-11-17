// Faux de la copie externe des scellements (mission 9b, WP12 ; décision du porteur : simulée jusqu'à la 12b, C-006).
// SANS état en mémoire : un redémarrage du processus ne perd rien. La référence est `fake:<empreinte en hexadécimal>`
// et la relecture se déduit de la référence : la copie ne protège de rien, elle ne sert qu'à exercer le chemin.
import type { SealExternalCopy, SealIdentity } from './seal-copy';

export const FAKE_SEAL_REF_PREFIX = 'fake:';

export class FakeSealCopy implements SealExternalCopy {
  readonly isFake = true;

  write(_seal: SealIdentity, sealHash: Buffer): Promise<string> {
    return Promise.resolve(`${FAKE_SEAL_REF_PREFIX}${sealHash.toString('hex')}`);
  }

  read(ref: string): Promise<Buffer | null> {
    if (!ref.startsWith(FAKE_SEAL_REF_PREFIX)) return Promise.resolve(null);
    const hex = ref.slice(FAKE_SEAL_REF_PREFIX.length);
    return Promise.resolve(
      /^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0 ? Buffer.from(hex, 'hex') : null,
    );
  }
}
