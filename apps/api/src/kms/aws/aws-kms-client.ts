// Construction du client AWS KMS (mission 12b-1, WP10). `@aws-sdk/client-kms` ne s'importe que sous `src/kms/aws/`
// (test d'architecture) : la fabrique `createKms` passe par ce fichier. Aucun appel au démarrage : le client ne
// se connecte qu'au premier usage. Identifiants : chaîne par défaut du SDK (rôle d'instance), jamais en configuration.
import { KMSClient } from '@aws-sdk/client-kms';
import type { AppConfig } from '../../config/config';

export function createAwsKmsClient(config: Pick<AppConfig, 'aws'>): KMSClient {
  return new KMSClient({
    region: config.aws.region,
    ...(config.aws.endpoint === null ? {} : { endpoint: config.aws.endpoint }),
  });
}
