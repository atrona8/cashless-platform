// Unitaire : la relecture d'un signal part à `finish` OU à `close` de la réponse, une seule fois (mission 12b-1,
// lot WP03, cycle 2 : connexion coupée avant `finish`).
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { runOnceAfterResponse } from '../../../src/webhooks/webhooks.controller';

const fakeResponse = (): Response => new EventEmitter() as unknown as Response;

describe('runOnceAfterResponse', () => {
  it('rien avant la fin de la réponse', () => {
    const task = jest.fn();
    runOnceAfterResponse(fakeResponse(), task);
    expect(task).not.toHaveBeenCalled();
  });

  it('connexion coupée avant `finish` : `close` seul déclenche la tâche', () => {
    const res = fakeResponse();
    const task = jest.fn();
    runOnceAfterResponse(res, task);
    res.emit('close');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('`finish` puis `close` : une seule exécution', () => {
    const res = fakeResponse();
    const task = jest.fn();
    runOnceAfterResponse(res, task);
    res.emit('finish');
    res.emit('close');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('`finish` seul déclenche la tâche', () => {
    const res = fakeResponse();
    const task = jest.fn();
    runOnceAfterResponse(res, task);
    res.emit('finish');
    expect(task).toHaveBeenCalledTimes(1);
  });
});
