import 'reflect-metadata';
// Processus tué par `after-releasing-persisted` : RELEASING est commité AVANT le SIGKILL.
import { AuthorityService, toHandoverView } from '../../../src/authority/authority.service';
import { CentralClient } from '../../../src/central-client/central-client';
import type { GatewayClock } from '../../../src/clock/gateway-clock';
import type { GatewayConfig } from '../../../src/config/config';
import { GatewayTx } from '../../../src/db/gateway-tx';
import { createGatewayPool } from '../../../src/db/pool';
import { configureFailpoints } from '../../../src/testing/failpoints';

const clock: GatewayClock = {
  now: () => new Date(),
  observeCentral: async () => undefined,
  skewAlert: () => false,
  refusesAck: () => false,
};
configureFailpoints({
  nodeEnv: 'test',
  failpoint: 'after-releasing-persisted',
  allowFailpoints: '1',
});
void (async () => {
  const pool = createGatewayPool(process.env.GATEWAY_DATABASE_URL!);
  const tx = new GatewayTx(pool);
  const client = new CentralClient({ production: false } as unknown as GatewayConfig, tx, clock);
  const authority = new AuthorityService(tx, clock, client);
  await authority.onHandover(
    toHandoverView(
      {
        handover_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        direction: 'TO_CENTRAL',
        state: 'RELEASE_REQUESTED',
        epoch: 5,
      },
      new Date(),
    ),
  );
  process.stdout.write('SURVIVED\n');
})();
