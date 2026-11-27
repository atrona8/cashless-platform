// Parcours d'essai des PSP et du coffre des secrets (WP11, T049 ; research R-12). Les adaptateurs et le coffre sont
// construits par les MÊMES fabriques que les processus (`createPspAdapters`, `createPspSecretStore`), réglage `real`,
// hors production. Aucun paiement n'est conclu : la session créée est relue (`PENDING`) puis expirée.
// Points « à confirmer à l'essai » : le montant minimal accepté par chaque PSP (100 XOF peut être refusé), le
// relevé du jour de Wave et de la veille de Stripe (contenu éventuellement vide).
import { createPspAdapters, createPspSecretStore } from '../../psp/psp.providers';
import { PspHttpClient, type PspHttpRequest } from '../../psp/http/psp-http';
import type { PspAdapter } from '../../psp/psp-adapter.port';
import {
  PspSecretError,
  type PspSecrets,
  type PspSecretStore,
} from '../../psp/psp-secret-store.port';
import { PROVIDER_PATH_SEGMENT, type PspMethod, type PspProviderName } from '../../psp/psp.types';
import { Recorder, StepFailure, type StatusProbe } from './report';
import type { TrialContext } from './context';

/** Client HTTP des PSP qui retient le statut de la dernière réponse (pour `httpStatus` d'une étape). */
export class RecordingHttp extends PspHttpClient implements StatusProbe {
  private last: number | undefined;

  override async send(req: PspHttpRequest): ReturnType<PspHttpClient['send']> {
    const res = await super.send(req);
    this.last = res.status;
    return res;
  }

  reset(): void {
    this.last = undefined;
  }

  status(): number | undefined {
    return this.last;
  }
}

const SERVICE_PROVIDER: Record<string, { provider: PspProviderName; method: PspMethod }> = {
  'psp.wave': { provider: 'WAVE', method: 'WAVE' },
  'psp.paydunya': { provider: 'PAYDUNYA', method: 'CARD' },
  'psp.stripe': { provider: 'STRIPE', method: 'CARD' },
};

export const isPspService = (service: string): boolean => service in SERVICE_PROVIDER;

/** Valeurs en clair d'un jeu d'identifiants : réservées à la recherche de fuite dans la sortie. */
export function revealAll(secrets: PspSecrets): string[] {
  const out: string[] = [];
  for (const value of Object.values(secrets.credentials))
    if (typeof value === 'object' && value !== null && 'reveal' in value)
      out.push((value as { reveal(): string }).reveal());
  out.push(secrets.notification.current.reveal());
  if (secrets.notification.previous !== null) out.push(secrets.notification.previous.reveal());
  return out;
}

/** Client « coffre » à une seule réponse : le contenu du fichier d'identifiants passe par le vrai analyseur du coffre. */
function fileBackedClient(text: string): NonNullable<Parameters<typeof createPspSecretStore>[2]> {
  return {
    send: async () => ({ SecretString: text }),
  } as unknown as NonNullable<Parameters<typeof createPspSecretStore>[2]>;
}

/** Détenteur : segment après `psp/` d'une référence ; l'essai agit pour le détenteur de la référence donnée. */
const holderOf = (ref: string): string => ref.split('/')[1] ?? '';

export function createTrialStore(ctx: TrialContext): PspSecretStore {
  if (ctx.options.secretRef !== undefined) return createPspSecretStore(ctx.config);
  const path = ctx.options.credentialsFile;
  if (path === undefined) throw new StepFailure('identifiants-absents');
  let text: string;
  try {
    text = ctx.readFile(path);
  } catch {
    throw new StepFailure('fichier-illisible');
  }
  return createPspSecretStore(ctx.config, undefined, fileBackedClient(text));
}

async function readSecrets(ctx: TrialContext, provider: PspProviderName): Promise<PspSecrets> {
  const store = createTrialStore(ctx);
  const secretRef = ctx.options.secretRef ?? 'psp/essai/essai';
  ctx.seen.push(secretRef);
  const secrets = await store.get({
    configurationId: 'essai',
    holderPartyId: holderOf(secretRef),
    secretRef,
    provider,
  });
  ctx.seen.push(...revealAll(secrets));
  return secrets;
}

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

async function expectState(
  adapter: PspAdapter,
  query: { merchantReference: string; providerPaymentRef: string },
  secrets: PspSecrets,
  expected: string,
): Promise<void> {
  const status = await adapter.getStatus(query, secrets);
  if (status.state !== expected) throw new StepFailure(`etat-${status.state.toLowerCase()}`);
}

export async function runPspTrial(ctx: TrialContext, service: string): Promise<Recorder> {
  const { provider, method } = SERVICE_PROVIDER[service]!;
  const http = new RecordingHttp(ctx.config);
  const rec = new Recorder(http, ctx.clock);
  const adapter = await rec.run('construction', async () =>
    createPspAdapters(ctx.config, http).forProvider(provider),
  );
  const secrets = await rec.run('lecture-identifiants', () => readSecrets(ctx, provider), [
    'construction',
  ]);
  const ready = ['lecture-identifiants'];
  // Les étapes suivantes ne s'exécutent que si `adapter` et `secrets` existent (sinon elles sont sautées).
  const a = adapter as PspAdapter;
  const s = secrets as PspSecrets;

  const merchantReference = ctx.newId();
  const createName = provider === 'PAYDUNYA' ? 'creation-facture' : 'creation-session';
  const created = await rec.run(
    createName,
    async () => {
      const result = await a.initiate(
        {
          pspTopupId: merchantReference,
          method,
          amount: 100n,
          currency: 'XOF',
          payerMsisdn: null,
          returnUrl: ctx.options.returnUrl ?? null,
          notificationUrl:
            ctx.options.notificationUrl ??
            `https://essai.invalid/v1/webhooks/${PROVIDER_PATH_SEGMENT[provider]}/essai`,
        },
        s,
      );
      if (result.providerPaymentRef === '') throw new StepFailure('reference-absente');
      return result.providerPaymentRef;
    },
    ready,
  );
  const query = { merchantReference, providerPaymentRef: created ?? '' };

  await rec.run(
    provider === 'PAYDUNYA' ? 'confirmation' : 'relecture-statut',
    () => expectState(a, query, s, 'PENDING'),
    [createName],
  );
  if (provider !== 'PAYDUNYA')
    // Nettoyage : la session créée est expirée même si la relecture a échoué.
    await rec.run(
      'expiration',
      async () => {
        const { cancelled } = await a.cancel(query, s);
        if (!cancelled) throw new StepFailure('non-expiree');
      },
      [createName],
    );
  if (provider === 'WAVE')
    await rec.run(
      'releve-du-jour',
      async () => {
        const now = new Date(ctx.clock());
        await a.readStatement({ from: startOfUtcDay(now), to: now }, s);
      },
      ready,
    );
  if (provider === 'STRIPE')
    await rec.run(
      'releve-de-la-veille',
      async () => {
        const today = startOfUtcDay(new Date(ctx.clock()));
        const from = new Date(today.getTime() - 86_400_000);
        await a.readStatement({ from, to: new Date(today.getTime() - 1000) }, s);
      },
      ready,
    );
  return rec;
}

/** Coffre : lecture d'une référence de test, puis refus d'un autre détenteur (isolement des détenteurs de fonds). */
export async function runSecretsTrial(ctx: TrialContext): Promise<Recorder> {
  const rec = new Recorder(null, ctx.clock);
  const provider = ctx.options.provider;
  const ref = ctx.options.secretRef;
  if (provider === undefined || ref === undefined) {
    rec.steps.push({ name: 'lecture-secret', ok: false, durationMs: 0, reason: 'arguments' });
    return rec;
  }
  const store = await rec.run('construction', async () => createPspSecretStore(ctx.config));
  ctx.seen.push(ref);
  await rec.run(
    'lecture-secret',
    async () => {
      ctx.seen.push(
        ...revealAll(
          await store!.get({
            configurationId: 'essai',
            holderPartyId: holderOf(ref),
            secretRef: ref,
            provider,
          }),
        ),
      );
    },
    ['construction'],
  );
  await rec.run(
    'refus-autre-detenteur',
    async () => {
      try {
        await store!.get({
          configurationId: 'essai',
          holderPartyId: `${holderOf(ref)}-autre`,
          secretRef: ref,
          provider,
        });
      } catch (error) {
        if (error instanceof PspSecretError && error.code === 'HOLDER_MISMATCH') return;
        throw error;
      }
      throw new StepFailure('detenteur-accepte');
    },
    ['construction'],
  );
  return rec;
}
