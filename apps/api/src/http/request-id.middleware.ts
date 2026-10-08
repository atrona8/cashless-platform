// X-Request-Id (SPECIFICATION §10.1) : repris s'il est un UUID, sinon généré ; renvoyé dans la réponse.
// Journal structuré : une ligne JSON par requête.
import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REQUEST_ID_HEADER = 'X-Request-Id';

export function requestIdOf(req: Request): string {
  return (req as Request & { requestId?: string }).requestId ?? '';
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId = incoming && UUID.test(incoming) ? incoming : randomUUID();
    (req as Request & { requestId?: string }).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = (process.hrtime.bigint() - started) / 1_000_000n;
      process.stdout.write(
        `${JSON.stringify({
          level: 'info',
          requestId,
          method: req.method,
          route: req.originalUrl.split('?')[0],
          status: res.statusCode,
          durationMs: Number(durationMs),
        })}\n`,
      );
    });
    next();
  }
}
