import 'reflect-metadata';
// Processus enfant de la passerelle pour les points d'arrêt : même code de production (pool,
// GatewayTx, EdgeQueue, DrainService), points d'arrêt configurés comme au démarrage. Un test tue
// ce processus (SIGKILL) puis le relance sur la MÊME base.
//   MODE=append  N=<nombre> FROM=<premier seq du terminal> : N opérations, chacune dans sa
//                transaction, `after-local-write-before-reply` franchi après chaque commit.
//   MODE=drain   : un `runOnce` contre le faux central du parent (mTLS).
import { createGatewayPool } from '../../../src/db/pool';
import { GatewayTx } from '../../../src/db/gateway-tx';
import { CentralClient } from '../../../src/central-client/central-client';
import { FakeHardwareKeystore } from '../../../src/key-store/fake-hardware-keystore';
import { DrainService } from '../../../src/queue/drain.service';
import { EdgeQueue } from '../../../src/queue/edge-queue';
import { configureFailpoints, failpoint } from '../../../src/testing/failpoints';
import { purchase } from './queue-harness';

configureFailpoints({
  nodeEnv: process.env.NODE_ENV ?? '',
  failpoint: process.env.EDGE_FAILPOINT || null,
  allowFailpoints: process.env.EDGE_ALLOW_FAILPOINTS || null,
});

void (async () => {
  const pool = createGatewayPool(process.env.CHILD_DATABASE_URL!);
  const tx = new GatewayTx(pool);
  if (process.env.MODE === 'append') {
    const queue = new EdgeQueue();
    const from = Number(process.env.FROM ?? 1);
    for (let i = 0; i < Number(process.env.N ?? 1); i += 1) {
      const row = await tx.run((t) => queue.append(t, purchase(from + i), []));
      await failpoint('after-local-write-before-reply');
      process.stdout.write(`COMMITTED ${row.edgeSeq}\n`);
    }
  } else {
    const config = {
      production: false,
      centralUrl: null,
      centralClientCertFile: process.env.CLIENT_CERT,
      centralClientKeyFile: process.env.CLIENT_KEY,
    } as never;
    const clock = {
      now: () => new Date(),
      observeCentral: async () => undefined,
      skewAlert: () => false,
      refusesAck: () => false,
    };
    const drain = new DrainService(
      tx,
      new CentralClient(config, tx, clock),
      new FakeHardwareKeystore({ keyFile: process.env.GATEWAY_DEV_KEY_FILE! }),
      clock,
    );
    const outcome = await drain.runOnce();
    process.stdout.write(`DRAINED ${JSON.stringify(outcome)}\n`);
  }
  await pool.end();
  process.stdout.write('DONE\n');
})().catch((error: unknown) => {
  process.stderr.write(`CHILD ERROR ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
