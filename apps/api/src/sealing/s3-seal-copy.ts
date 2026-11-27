// Copie externe des scellements sur S3 Object Lock (mission 12b-1, WP09 ; contracts/aws.md, research R-10, D8).
// Écriture unique : mode CONFORMITÉ (COMPLIANCE, que ni le compte racine ne lève), rétention de
// `SEAL_COPY_RETENTION_DAYS` (3 650 jours = 10 ans), somme SHA-256 contrôlée par S3, `If-None-Match: *` (aucun
// écrasement). Identifiants AWS : chaîne par défaut du SDK. Les erreurs ne portent ni le nom du seau ni la clé.
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config/config';
import type { SealExternalCopy, SealIdentity } from './seal-copy';

const DAY_MS = 86_400_000;

export class S3SealCopy implements SealExternalCopy {
  readonly isFake = false;
  readonly service = 'seal-copy' as const;
  private readonly bucket: string;
  private readonly retentionDays: number;

  constructor(
    private readonly client: S3Client,
    config: Pick<AppConfig, 'sealCopy'>,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (config.sealCopy.bucket === null || config.sealCopy.bucket === '')
      throw new Error('copie des scellements : compartiment non configuré');
    this.bucket = config.sealCopy.bucket;
    this.retentionDays = config.sealCopy.retentionDays;
  }

  async write(seal: SealIdentity, sealHash: Buffer): Promise<string> {
    const key = `${seal.kind}/${seal.id}/${seal.sealNo}`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: sealHash,
          ObjectLockMode: 'COMPLIANCE',
          ObjectLockRetainUntilDate: new Date(this.clock().getTime() + this.retentionDays * DAY_MS),
          ChecksumAlgorithm: 'SHA256',
          IfNoneMatch: '*',
        }),
      );
      return key;
    } catch (error) {
      if (statusOf(error) !== 412) throw s3Error('write', error);
    }
    // Déjà écrit (412) : même empreinte → la référence ; différente → erreur d'intégrité, jamais d'écrasement.
    const existing = await this.read(key);
    if (existing !== null && existing.equals(sealHash)) return key;
    throw new Error('copie de scellement divergente');
  }

  async read(ref: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: ref }));
      if (out.Body === undefined) return null;
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (error) {
      if (codeOf(error) === 'NoSuchKey') return null;
      throw s3Error('read', error);
    }
  }
}

function codeOf(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && /^[A-Za-z0-9_.]{1,64}$/.test(name) ? name : 'Unknown';
}

function statusOf(error: unknown): number | null {
  const status = (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata
    ?.httpStatusCode;
  return typeof status === 'number' ? status : null;
}

/** Classe et code AWS seulement : jamais le message du SDK, le compartiment ni la clé d'objet. */
function s3Error(operation: string, error: unknown): Error {
  return new Error(`copie des scellements (${operation}) : ${codeOf(error)}`);
}
