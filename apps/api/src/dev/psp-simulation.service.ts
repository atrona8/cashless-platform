// Simulation du paiement d'une recharge PSP, DÉVELOPPEMENT seulement (OP-N121, ADR-181). Aucune écriture au grand
// livre ici : la notification que le PSP enverrait est fabriquée (faux adaptateur, secret de démo du faux coffre) puis
// remise au VRAI chemin de réception (`WebhookIntake` : signature, conservation idempotente, traitement, plafonds).
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { requestCustomer } from '../customer-identity/customer-identity.port';
import { TenantTx } from '../db/tenant-tx';
import { ProblemException } from '../errors/problem';
import type { PspSecretStore } from '../psp/psp-secret-store.port';
import { DEV_NOTIFICATION_FABRICATOR, PSP_SECRET_STORE } from '../psp/psp.tokens';
import type { DevNotificationFabricator } from '../psp/psp.providers';
import { conflict } from '../organization/platform/platform.dto';
import { PROVIDER_PATH_SEGMENT, type PspProviderName } from '../psp/psp.types';
import { topupView, type PspTopupView } from '../topups/psp/psp-topups.dto';
import { PspPaymentProcessor } from '../topups/psp/psp-payment-processor';
import { PspTopupLookup, type PspTopupRow } from '../topups/psp/psp-topup-lookup';
import { WebhookIntake } from '../webhooks/webhook-intake.service';

export type SimulatedOutcome = 'SUCCEEDED' | 'FAILED';

@Injectable()
export class PspSimulationService {
  constructor(
    private readonly tx: TenantTx,
    private readonly lookup: PspTopupLookup,
    private readonly processor: PspPaymentProcessor,
    private readonly intake: WebhookIntake,
    @Inject(PSP_SECRET_STORE) private readonly secrets: PspSecretStore,
    @Inject(DEV_NOTIFICATION_FABRICATOR) private readonly fabricate: DevNotificationFabricator,
  ) {}

  async simulate(req: Request, topupId: string, outcome: SimulatedOutcome): Promise<PspTopupView> {
    const customer = requestCustomer(req);
    const found = await this.tx.run(customer.operatorId, async (client) => {
      const row = await this.lookup.find(client, topupId);
      // Recharge d'un autre festivalier, d'un autre prestataire ou inconnue : 404 identique.
      if (!row || row.requestedByKind !== 'CUSTOMER' || row.customerId !== customer.customerId)
        throw new ProblemException('NOT_FOUND');
      const config = await client.query<{ holder_party_id: string; secret_ref: string }>(
        `SELECT holder_party_id, psp_configuration_secret_ref(psp_configuration_id) AS secret_ref
           FROM psp_configuration WHERE psp_configuration_id = $1`,
        [row.configurationId],
      );
      return { row, config: config.rows[0]! };
    });
    const row = found.row;
    if (row.status !== 'PENDING') {
      // Déjà dans l'état demandé : état courant (idempotence). Autre état final : 409.
      if (row.status === outcome) return topupView(row);
      throw conflict(`Cette recharge est déjà ${row.status} : elle ne peut plus être simulée.`);
    }
    const secrets = await this.secrets.get({
      configurationId: row.configurationId,
      holderPartyId: found.config.holder_party_id,
      secretRef: found.config.secret_ref,
    });
    const provider = row.provider as PspProviderName;
    const signed = this.fabricate({
      provider,
      secret: secrets.notification.current,
      outcome,
      // Identifiant d'événement déterministe : un second appel est un doublon pour `record_psp_event`.
      notificationId: `dev-sim-${row.topupId}-${outcome}`,
      merchantReference: row.topupId,
      paymentId: row.providerPaymentRef ?? `fake_dev_${row.topupId}`,
      amount: Number(row.amount),
      currency: row.currency,
      ...(row.method === 'CARD'
        ? { card: { fingerprint: `demo-${row.walletId.slice(0, 8)}`, threeDs: 'SUCCEEDED' } }
        : {}),
    });
    await this.intake.receive({
      providerSegment: PROVIDER_PATH_SEGMENT[provider],
      configId: row.configurationId,
      rawBody: signed.rawBody,
      headers: signed.headers,
      ip: req.ip,
    });
    let after = await this.reread(customer.operatorId, row);
    // Contrat R-20 : une notification d'échec n'a AUCUN effet, seule la finalisation d'un paiement non abouti
    // (celle du travailleur d'interrogation quand le PSP confirme l'échec) passe la recharge à FAILED.
    if (outcome === 'FAILED' && after.status === 'PENDING') {
      await this.tx.run(customer.operatorId, (client) =>
        this.processor.settleUnpaid(client, {
          configurationId: row.configurationId,
          topupId: row.topupId,
          verdict: 'FAILED',
          observedAt: new Date(),
        }),
      );
      after = await this.reread(customer.operatorId, row);
    }
    return topupView(after);
  }

  private reread(operatorId: string, row: PspTopupRow): Promise<PspTopupRow> {
    return this.tx.run(
      operatorId,
      async (client) => (await this.lookup.find(client, row.topupId))!,
    );
  }
}
