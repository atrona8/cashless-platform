import { ProblemException } from '../errors/problem';
import type { PspAdapter } from './psp-adapter.port';
import type { PspProviderName } from './psp.types';

export class PspAdapterRegistry {
  constructor(
    private readonly adapters: readonly PspAdapter[],
    readonly available: boolean,
  ) {}

  forProvider(provider: PspProviderName): PspAdapter {
    const adapter = this.available
      ? this.adapters.find((candidate) => candidate.provider === provider)
      : undefined;
    if (adapter === undefined) throw new ProblemException('PSP_UNAVAILABLE', { status: 503 });
    return adapter;
  }

  /** Lu par la garde de production : vrai si UN adaptateur contenu est un faux. */
  get isFake(): true | undefined {
    return this.adapters.some((adapter) => adapter.isFake === true) ? true : undefined;
  }
}
