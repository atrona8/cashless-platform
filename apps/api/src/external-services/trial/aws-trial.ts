// Parcours d'essai de AWS KMS et de la copie des scellements sur S3 Object Lock (WP11, T050). Le service de clés et
// la copie sont construits par les MÊMES fabriques que les processus (`createKms`, `createSealCopy`), réglage
// `real`, hors production. Les identifiants AWS viennent de la chaîne par défaut du SDK, jamais de la commande.
// Points « à confirmer à l'essai » : une clé créée est utilisable tout de suite (sinon, nouvel essai à la main) ;
// une clé désactivée n'est pas supprimée (la suppression est une décision humaine : `ScheduleKeyDeletion`) ; l'objet
// de test reste dans le compartiment, verrouillé pour la durée de rétention choisie (COMPLIANCE : irrévocable).
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { createKms } from '../../kms/kms.module';
import type {
  DataKeyPort,
  DecryptPort,
  KeyAdminPort,
  KmsKeyKind,
  MacPort,
  SignPort,
} from '../../kms/kms.ports';
import { zeroize } from '../../kms/zeroize';
import { createSealCopy } from '../../sealing/sealing.module';
import type { SealIdentity } from '../../sealing/seal-copy';
import type { TrialContext } from './context';
import { Recorder, StepFailure } from './report';

type AllPorts = MacPort & DataKeyPort & DecryptPort & SignPort & KeyAdminPort;

export async function runKmsTrial(ctx: TrialContext): Promise<Recorder> {
  const rec = new Recorder(null, ctx.clock);
  const kms = await rec.run(
    'construction',
    async () =>
      createKms(ctx.config, ['mac', 'dataKey', 'decrypt', 'keyAdmin', 'sign']) as AllPorts,
  );
  const ports = kms as AllPorts;
  const created: string[] = [];
  const create = (kind: KmsKeyKind) => async (): Promise<string> => {
    const ref = await ports.createKey(kind);
    created.push(ref);
    ctx.seen.push(ref);
    return ref;
  };
  try {
    const macKey = await rec.run('creation-cle-mac', create('HMAC_256'), ['construction']);
    const wrapKey = await rec.run('creation-cle-donnees', create('SYMMETRIC_DEFAULT'), [
      'construction',
    ]);
    const signKey = await rec.run('creation-cle-signature', create('ECC_NIST_P256'), [
      'construction',
    ]);

    await rec.run(
      'mac',
      async () => {
        const message = Buffer.from('essai-cashless');
        const first = await ports.generateMac(macKey!, message);
        const second = await ports.generateMac(macKey!, message);
        try {
          if (first.length !== 32) throw new StepFailure('mac-longueur');
          if (!first.equals(second)) throw new StepFailure('mac-instable');
        } finally {
          zeroize(first, second);
        }
      },
      ['creation-cle-mac'],
    );

    await rec.run(
      'cle-de-donnees',
      async () => {
        const key = await ports.generateDataKey(wrapKey!);
        let reopened: Buffer | null = null;
        try {
          reopened = await ports.decrypt(wrapKey!, key.encrypted);
          if (!reopened.equals(key.plaintext)) throw new StepFailure('aller-retour-different');
        } finally {
          zeroize(key.plaintext, key.encrypted, reopened);
        }
      },
      ['creation-cle-donnees'],
    );

    await rec.run(
      'signature',
      async () => {
        const message = randomBytes(32);
        const signature = await ports.sign(signKey!, message);
        const spki = await ports.publicKey(signKey!);
        const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
        if (!verify('sha256', message, publicKey, signature))
          throw new StepFailure('signature-invalide');
        // Une signature d'un autre message ne doit pas passer.
        if (verify('sha256', randomBytes(32), publicKey, signature))
          throw new StepFailure('signature-acceptee-a-tort');
      },
      ['creation-cle-signature'],
    );
  } finally {
    // Les clés de test créées sont désactivées même si une étape a échoué.
    await rec.run('desactivation-cles', async () => {
      let failed = false;
      for (const ref of created) {
        try {
          await ports.disableKey(ref);
        } catch {
          failed = true;
        }
      }
      if (failed) throw new StepFailure('cle-restee-active');
    });
  }
  return rec;
}

export async function runSealCopyTrial(ctx: TrialContext): Promise<Recorder> {
  const rec = new Recorder(null, ctx.clock);
  const retentionDays = ctx.options.retentionDays ?? ctx.config.sealCopy.retentionDays;
  if (ctx.config.sealCopy.bucket !== null) ctx.seen.push(ctx.config.sealCopy.bucket);
  const copy = await rec.run('construction', async () => {
    if (ctx.config.sealCopy.bucket === null) throw new StepFailure('compartiment-absent');
    return createSealCopy({ ...ctx.config, sealCopy: { ...ctx.config.sealCopy, retentionDays } });
  });
  const seal: SealIdentity = { kind: 'AUDIT', id: `essai-${ctx.newId()}`, sealNo: 1 };
  const hash = randomBytes(32);
  const ref = await rec.run(
    'ecriture-verrouillee',
    async () => {
      const written = await copy!.write(seal, hash);
      ctx.seen.push(written);
      return written;
    },
    ['construction'],
  );
  await rec.run(
    'relecture',
    async () => {
      const back = await copy!.read(ref!);
      if (back === null || !back.equals(hash)) throw new StepFailure('relecture-differente');
    },
    ['ecriture-verrouillee'],
  );
  await rec.run(
    'ecrasement-refuse',
    async () => {
      try {
        await copy!.write(seal, randomBytes(32));
      } catch (error) {
        if (error instanceof Error && error.message === 'copie de scellement divergente') {
          const back = await copy!.read(ref!);
          if (back === null || !back.equals(hash)) throw new StepFailure('objet-modifie');
          return;
        }
        throw error;
      }
      throw new StepFailure('ecrasement-accepte');
    },
    ['ecriture-verrouillee'],
  );
  return rec;
}
