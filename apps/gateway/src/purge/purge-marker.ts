// Marqueur de purge HORS BASE (T108, étape 1). Un fichier local `purge.marker`, écrit puis
// synchronisé
// (fichier, puis dossier) AVANT toute destruction : il survit à un arrêt brutal et à une base
// vidée.
// Il ne contient ni secret ni donnée de site : l'état, le déclencheur, l'heure et les noms des deux
// responsables (ordre manuel).
//   STARTED : la purge est commencée ; le démarrage la termine avant tout service ;
//   DONE    : la purge est terminée ; la passerelle refuse de redémarrer sur ces données.
// Un fichier illisible vaut STARTED (échec fermé : on ne sert rien, on termine la purge).
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';

export type PurgeState = 'STARTED' | 'DONE';
export type PurgeTriggerKind = 'AUTO' | 'MANUAL' | 'UNKNOWN';

export interface PurgeMarker {
  state: PurgeState;
  trigger: PurgeTriggerKind;
  holders: string[];
  at: string;
}

export class PurgeMarkerFile {
  readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  exists(): boolean {
    return existsSync(this.path);
  }

  read(): PurgeMarker | null {
    if (!this.exists()) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<PurgeMarker>;
      const state: PurgeState | null =
        parsed.state === 'DONE' ? 'DONE' : parsed.state === 'STARTED' ? 'STARTED' : null;
      if (state === null) throw new Error('état inconnu');
      const trigger: PurgeTriggerKind =
        parsed.trigger === 'AUTO' || parsed.trigger === 'MANUAL' ? parsed.trigger : 'UNKNOWN';
      return {
        state,
        trigger,
        holders: Array.isArray(parsed.holders)
          ? parsed.holders.filter((h): h is string => typeof h === 'string')
          : [],
        at: typeof parsed.at === 'string' ? parsed.at : new Date(0).toISOString(),
      };
    } catch {
      return { state: 'STARTED', trigger: 'UNKNOWN', holders: [], at: new Date(0).toISOString() };
    }
  }

  /** Écriture atomique et durable : fichier temporaire, `fsync`, `rename`, `fsync` du dossier. */
  write(marker: PurgeMarker): void {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true });
    const temp = `${this.path}.${randomBytes(6).toString('hex')}.tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try {
      writeSync(fd, JSON.stringify(marker));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, this.path);
    const dirFd = openSync(dir, 'r');
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  }
}

/**
 * Porte du service : fermée (503 sans détail) dès qu'un marqueur existe, ou dès qu'une purge
 * démarre dans ce processus. Ne se rouvre jamais.
 */
export class PurgeGate {
  private closed: boolean;

  constructor(private readonly marker: PurgeMarkerFile) {
    this.closed = marker.exists();
  }

  get engaged(): boolean {
    return this.closed || this.marker.exists();
  }

  engage(): void {
    this.closed = true;
  }
}
