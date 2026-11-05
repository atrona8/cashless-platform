// Processeur par défaut tant que le traitement d'une opération (lot WP19) n'est pas branché. Ce n'est PAS un faux
// (il n'invente aucun résultat) : il refuse. Le lot s'arrête alors à l'opération courante, `PROCESSING`, `500`.
import { Injectable } from '@nestjs/common';
import type { OfflineOperationProcessor, OperationResult } from './batch.types';

@Injectable()
export class UnavailableOperationProcessor implements OfflineOperationProcessor {
  process(): Promise<OperationResult> {
    return Promise.reject(new Error('Processeur d’opérations hors ligne non branché (lot WP19)'));
  }
}
