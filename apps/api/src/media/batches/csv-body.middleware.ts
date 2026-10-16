// Corps `text/csv` des routes de lots (fichier de correspondance de l'imprimeur) : l'analyseur JSON de l'application
// ne le lit pas. Lu ici, avant l'intercepteur d'idempotence, pour que l'empreinte de la requête porte sur le fichier.
// Taille bornée : au-delà, le corps est écarté et la route répond 400.
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const MAX_CSV_BYTES = 1_048_576;
export type CsvRequest = Request & { csvTooLarge?: boolean };

@Injectable()
export class CsvBodyMiddleware implements NestMiddleware {
  use(req: CsvRequest, _res: Response, next: NextFunction): void {
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (req.method !== 'POST' || (type !== 'text/csv' && type !== 'text/plain')) return next();
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_CSV_BYTES) {
        req.csvTooLarge = true;
        chunks.length = 0;
      } else if (!req.csvTooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      req.body = req.csvTooLarge ? '' : Buffer.concat(chunks).toString('utf8');
      next();
    });
    req.on('error', next);
  }
}
