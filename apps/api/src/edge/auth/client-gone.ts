// Détection d'un client parti (WP10, cycle 2) : posée par la garde `edgeMtls` DÈS L'ENTRÉE, avant toute requête SQL
// asynchrone, pour qu'une coupure pendant la garde ne soit pas manquée (l'événement `close` n'est émis qu'une fois).
// Le signal part sur `close` de la réponse, de la socket ou de la requête interrompue ; l'état déjà détruit est testé
// à la création et à chaque armement (`clientGoneSignal`).
import type { Request, Response } from 'express';

const SIGNAL = Symbol('edgeClientGone');
type Tracked = Request & { [SIGNAL]?: AbortController };

function gone(req: Request, res: Response): boolean {
  return res.destroyed || req.socket.destroyed || (req.destroyed && !req.complete);
}

/** Écoute la coupure du client ; idempotent. À appeler avant tout `await`. */
export function trackClientGone(req: Request, res: Response): AbortSignal {
  const tracked = req as Tracked;
  if (tracked[SIGNAL]) return tracked[SIGNAL].signal;
  const abort = new AbortController();
  tracked[SIGNAL] = abort;
  const stop = (): void => abort.abort();
  const onReqClose = (): void => {
    if (!req.complete) stop();
  };
  // Fin de la réponse (finish ou close, une seule fois) : retire tout, la socket keep-alive survit à la requête.
  const release = (): void => {
    req.socket.off('close', stop);
    req.off('close', onReqClose);
    res.off('close', onResClose);
    res.off('finish', release);
  };
  const onResClose = (): void => {
    if (!res.writableFinished) stop();
    release();
  };
  res.once('close', onResClose);
  res.once('finish', release);
  req.socket.once('close', stop);
  req.once('close', onReqClose);
  if (gone(req, res)) stop();
  return abort.signal;
}

/** Signal de la requête, avec nouveau test de l'état (à l'armement d'une attente). */
export function clientGoneSignal(req: Request, res: Response): AbortSignal {
  const signal = trackClientGone(req, res);
  if (gone(req, res) && !signal.aborted) (req as Tracked)[SIGNAL]?.abort();
  return signal;
}
