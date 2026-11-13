// Processus enfant : crée la clé d'UN usage dans le fichier de clés de développement, à un instant
// de départ commun (les processus se chevauchent), et imprime la clé publique obtenue.
import { FakeHardwareKeystore } from '../../../src/key-store/fake-hardware-keystore';
import type { KeyUse } from '../../../src/key-store/hardware-keystore.port';

const startAt = Number(process.env.START_AT);
while (Date.now() < startAt) {
  // attente active : alignement des processus à la milliseconde
}
void (async () => {
  const store = new FakeHardwareKeystore({ keyFile: process.env.KEY_FILE! });
  const spki = await store.publicKey(process.env.USE as KeyUse);
  process.stdout.write(`PUBLIC ${spki.toString('hex')}\n`);
})().catch((error: unknown) => {
  process.stderr.write(`CHILD ERROR ${String(error)}\n`);
  process.exit(1);
});
