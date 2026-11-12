// Processus de test des points d'arrêt : configure comme au démarrage, passe le point, dit s'il a
// survécu.
import {
  configureFailpoints,
  failpoint,
  type FailpointName,
} from '../../../src/testing/failpoints';

const outcome = configureFailpoints({
  nodeEnv: process.env.NODE_ENV ?? '',
  failpoint: process.env.EDGE_FAILPOINT || null,
  allowFailpoints: process.env.EDGE_ALLOW_FAILPOINTS || null,
});
process.stdout.write(`OUTCOME armed=${outcome.armed} refused=${outcome.refused}\n`);
void (async () => {
  const name = (process.env.PASS_NAME ?? 'before-local-write') as FailpointName;
  for (let i = 0; i < Number(process.env.PASSES ?? 1); i += 1) {
    await failpoint(name);
    process.stdout.write(`PASSED ${i + 1}\n`);
  }
  process.stdout.write('SURVIVED\n');
})();
