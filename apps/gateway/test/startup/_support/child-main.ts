// Point d'entrée de test : installe un adaptateur matériel NON factice (sans `isFake`) puis démarre
// la passerelle
// par `main.ts`. Prouve qu'une configuration de production saine démarre (sinon les refus ne
// prouveraient rien).
import 'reflect-metadata';
import { DrainService } from '../../../src/queue/drain.service';
import { FakeHardwareKeystore } from '../../../src/key-store/fake-hardware-keystore';
import { registerHardwareKeystoreAdapter } from '../../../src/key-store/hardware-keystore.factory';

class RealLikeKeystore extends FakeHardwareKeystore {}
// Réglages de test lus ICI seulement (jamais dans src/) :
// - TEST_CHILD_KEYSTORE_KEY_FILE : fichier de clés du port (pour qu'un test en connaisse les clés) ;
// - TEST_CHILD_NO_DELTA_PURGE=1 : ne simule PAS la règle DELTA_PURGE de WP18 (refus attendu).
const keyFile = process.env.TEST_CHILD_KEYSTORE_KEY_FILE;
registerHardwareKeystoreAdapter(() => {
  const keystore = new RealLikeKeystore(keyFile ? { keyFile } : undefined);
  Object.defineProperty(keystore, 'isFake', { value: undefined });
  return keystore;
});

// La règle `DELTA_PURGE` est désormais branchée pour de vrai (ReplicationModule) ; ce réglage ne
// sert qu'à simuler son absence : la garde de production doit refuser le repli.
if (process.env.TEST_CHILD_NO_DELTA_PURGE === '1') {
  Object.defineProperty(DrainService.prototype, 'hasDeltaPurge', { get: () => false });
}

// `main.ts` s'exécute à l'import : démarrage sans argument, sinon `migrate`, `request` ou `enroll`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('../../../src/main');
