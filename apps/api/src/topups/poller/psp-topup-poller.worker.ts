// Interrogation des recharges PSP en attente (mission 6, lot WP12, T062 ; R-12, A15, A33). `psp_poll_candidates`
// (lecture neutre, tous prestataires) rend les recharges `PENDING` de plus de 2 minutes. Pour chacune : le statut est
// lu chez le PSP HORS de toute transaction, PUIS le processeur de WP11 prend le verrou de la recharge et applique,
// dans `TenantTx.run` (WP03 : cette lecture et cette application vivent dans `PspStatusConfirmer`). Une configuration SUSPENDED n'arrête pas l'interrogation de ses recharges (A15). En production
// avec un fournisseur indisponible : travailleur inactif (0, aucune erreur). Aucun secret, aucune référence de
// secret, aucun corps dans un journal.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantTx } from '../../db/tenant-tx';
import { WorkerRegistry, type ProcessWorker } from '../../processes/worker';
import type { PspAdapterRegistry } from '../../psp/psp-adapter-registry';
import { PSP_ADAPTERS } from '../../psp/psp.tokens';
import type { PspProviderName } from '../../psp/psp.types';
import { errorReason, logPspAlert } from '../../webhooks/psp-alert-log';
import { PspStatusConfirmer } from '../psp/psp-status-confirmer';
import { ALARM_POLL_FAILURE } from './poller-alarms';

/** Recharges lues par passage (borne de `psp_poll_candidates` : 500). */
export const POLL_BATCH = 100;

interface Candidate {
  psp_topup_id: string;
  operator_id: string;
  psp_configuration_id: string;
  provider: PspProviderName;
  method: string;
  provider_payment_ref: string | null;
  created_at: Date;
  expires_at: Date;
  expired: boolean;
}

@Injectable()
export class PspTopupPollerWorker implements ProcessWorker {
  readonly name = 'psp-poller';
  private readonly log = new Logger(PspTopupPollerWorker.name);
  private alarmCode = 0;

  constructor(
    registry: WorkerRegistry,
    private readonly tx: TenantTx,
    private readonly confirmer: PspStatusConfirmer,
    @Inject(PSP_ADAPTERS) private readonly adapters: PspAdapterRegistry,
  ) {
    registry.register(this);
  }

  /** Fournisseur indisponible (production, OP-N81) : rien à interroger. */
  private get active(): boolean {
    return this.adapters.available;
  }

  private candidates(): Promise<Candidate[]> {
    return this.tx.withoutTenant(async (client) => {
      const { rows } = await client.query<Candidate>('SELECT * FROM psp_poll_candidates($1)', [
        POLL_BATCH,
      ]);
      return rows;
    });
  }

  /** Rend le nombre de recharges tranchées ; une recharge dont le PSP ne répond pas n'est pas comptée. */
  async runOnce(): Promise<number> {
    if (!this.active) return 0;
    let settled = 0;
    for (const candidate of await this.candidates()) {
      try {
        if (await this.poll(candidate)) settled += 1;
      } catch (error) {
        this.alarmCode = ALARM_POLL_FAILURE;
        logPspAlert(this.log, {
          event: 'psp.poll.failed',
          severity: 'ERROR',
          reason: errorReason(error),
          psp_topup_id: candidate.psp_topup_id,
          psp_config_id: candidate.psp_configuration_id,
        });
      }
    }
    return settled;
  }

  /** `true` si la recharge a été tranchée (crédit, refus définitif, échec, expiration, annulation). */
  private async poll(candidate: Candidate): Promise<boolean> {
    // Lecture hors transaction et application : service commun avec la relecture des signaux (WP03).
    const { settled } = await this.confirmer.check(
      {
        pspTopupId: candidate.psp_topup_id,
        operatorId: candidate.operator_id,
        pspConfigurationId: candidate.psp_configuration_id,
        provider: candidate.provider,
        providerPaymentRef: candidate.provider_payment_ref,
      },
      { expired: candidate.expired },
    );
    return settled;
  }

  alarm(): number {
    return this.alarmCode;
  }

  async describe(): Promise<string[]> {
    if (!this.active) return [`${this.name} : inactif (fournisseur PSP indisponible)`];
    return (await this.candidates()).map(
      (c) =>
        `${this.name} : recharge ${c.psp_topup_id} (${c.provider}, ${c.method}) à interroger` +
        `${c.expired ? ', échéance dépassée' : ''}`,
    );
  }
}
