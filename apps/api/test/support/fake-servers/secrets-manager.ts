// Faux Secrets Manager local (protocole JSON d'AWS : `POST /`, `X-Amz-Target: secretsmanager.GetSecretValue`).
// Sert les tests de `AwsSecretsManagerStore` : le client SDK est pointé sur `url`, avec des identifiants factices.
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { startFakeServer, type FakeServer, type RecordedRequest } from './http-fake';

export interface FakeSecretVersion {
  current?: string;
  previous?: string;
}

export interface FakeSecretsManager {
  server: FakeServer;
  client: SecretsManagerClient;
  /** Définit (ou remplace) le contenu d'un secret ; `undefined` ne rend rien pour la version. */
  put(secretId: string, versions: FakeSecretVersion): void;
  /** Fait échouer la lecture d'un secret (`stage` : toutes les versions si absent). */
  fail(secretId: string, error: string, status?: number, stage?: 'AWSPREVIOUS'): void;
  clearFailures(): void;
  /** Requêtes `GetSecretValue` reçues. */
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startFakeSecretsManager(): Promise<FakeSecretsManager> {
  const secrets = new Map<string, FakeSecretVersion>();
  const failures = new Map<string, { error: string; status: number }>();
  const key = (id: string, stage?: string): string => `${id}#${stage ?? 'AWSCURRENT'}`;

  const server = await startFakeServer((req, res) => {
    res.setHeader('content-type', 'application/x-amz-json-1.1');
    if (req.method !== 'POST' || req.headers['x-amz-target'] !== 'secretsmanager.GetSecretValue') {
      res.statusCode = 400;
      res.end(JSON.stringify({ __type: 'InvalidRequestException' }));
      return;
    }
    const body = JSON.parse(req.body.toString('utf8')) as {
      SecretId: string;
      VersionStage?: string;
    };
    const failure =
      failures.get(key(body.SecretId, body.VersionStage)) ?? failures.get(key(body.SecretId, '*'));
    if (failure !== undefined) {
      res.statusCode = failure.status;
      res.end(JSON.stringify({ __type: failure.error, message: 'fake' }));
      return;
    }
    const entry = secrets.get(body.SecretId);
    const value = body.VersionStage === 'AWSPREVIOUS' ? entry?.previous : entry?.current;
    if (value === undefined) {
      res.statusCode = 400;
      res.end(JSON.stringify({ __type: 'ResourceNotFoundException', message: 'fake' }));
      return;
    }
    res.end(
      JSON.stringify({
        ARN: 'arn:aws:secretsmanager:eu-west-3:000000000000:secret:fake',
        Name: body.SecretId,
        SecretString: value,
        VersionStages: [body.VersionStage ?? 'AWSCURRENT'],
      }),
    );
  });

  const client = new SecretsManagerClient({
    region: 'eu-west-3',
    endpoint: server.url,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
  });

  return {
    server,
    client,
    put: (id, versions) => void secrets.set(id, versions),
    fail: (id, error, status = 400, stage) => {
      failures.set(key(id, stage ?? '*'), { error, status });
    },
    clearFailures: () => failures.clear(),
    get requests() {
      return server.requests;
    },
    close: async () => {
      client.destroy();
      await server.close();
    },
  };
}
