// Garde « aucun appel réseau externe en test » (mission 12b-1, NFR-001). Enregistrée dans `jest.config.cjs`
// (`setupFiles`). Toute résolution de nom ou connexion vers un hôte autre que 127.0.0.1, ::1 ou localhost échoue
// avec « réseau externe interdit en test » (code `ERR_EXTERNAL_NETWORK_FORBIDDEN`). Les sockets de fichier
// (base de données locale par socket Unix) restent permises. TLS, `http`, `fetch` passent par `net.Socket#connect`.
import dns from 'node:dns';
import net from 'node:net';

const MESSAGE = 'réseau externe interdit en test';
const CODE = 'ERR_EXTERNAL_NETWORK_FORBIDDEN';
const PATCHED = Symbol.for('cashless.noExternalNetwork');

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

function forbidden(): Error {
  return Object.assign(new Error(MESSAGE), { code: CODE });
}

function isLocalHost(host: unknown): boolean {
  if (typeof host !== 'string') return false;
  return LOCAL_HOSTS.has(host.toLowerCase());
}

/** Hôte visé par les formes d'appel de `socket.connect` : (options[, cb]), (port[, host][, cb]), (path[, cb]). */
function targetOf(args: unknown[]): { local: boolean } {
  const first = args[0];
  if (Array.isArray(first)) return targetOf(first as unknown[]);
  if (first !== null && typeof first === 'object') {
    const options = first as { path?: unknown; host?: unknown; hostname?: unknown };
    if (typeof options.path === 'string') return { local: true };
    return { local: isLocalHost(options.host ?? options.hostname ?? 'localhost') };
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^[0-9]+$/.test(first))) {
    const host = typeof args[1] === 'string' ? args[1] : 'localhost';
    return { local: isLocalHost(host) };
  }
  return { local: true }; // chemin de socket Unix
}

type Callback = (...cbArgs: unknown[]) => void;

function install(): void {
  const marked = net as unknown as Record<symbol, boolean>;
  if (marked[PATCHED]) return;
  marked[PATCHED] = true;

  const originalConnect = net.Socket.prototype.connect as (...a: unknown[]) => net.Socket;
  (net.Socket.prototype as unknown as { connect: unknown }).connect = function (
    this: net.Socket,
    ...args: unknown[]
  ): net.Socket {
    if (!targetOf(args).local) {
      const error = forbidden();
      process.nextTick(() => this.destroy(error));
      return this;
    }
    return originalConnect.apply(this, args);
  };

  const originalLookup = dns.lookup as unknown as (...a: unknown[]) => unknown;
  (dns as unknown as { lookup: unknown }).lookup = function (
    hostname: unknown,
    ...rest: unknown[]
  ) {
    if (isLocalHost(hostname)) return originalLookup.call(dns, hostname, ...rest);
    const callback = rest.find((a) => typeof a === 'function') as Callback | undefined;
    process.nextTick(() => callback?.(forbidden()));
    return {};
  };

  const promises = dns.promises as unknown as {
    lookup: (h: string, ...r: unknown[]) => Promise<unknown>;
  };
  const originalPromiseLookup = promises.lookup.bind(dns.promises);
  promises.lookup = (hostname: string, ...rest: unknown[]) =>
    isLocalHost(hostname) ? originalPromiseLookup(hostname, ...rest) : Promise.reject(forbidden());
}

install();
