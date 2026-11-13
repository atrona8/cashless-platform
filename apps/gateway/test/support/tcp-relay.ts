// Relais TCP coupable du banc de bout en bout (research R-26, quickstart § 5). `node:net` seul :
// les octets passent tels quels, donc le TLS mutuel est transparent (le certificat client voyage
// jusqu'au central). Commandes : pause, drop, resume, delayMs, close. Utilisable par code et en
// ligne
// de commande : `npx tsx apps/gateway/test/support/tcp-relay.ts --listen 3201 --target
// 127.0.0.1:3101`
// (puis, sur l'entrée standard : pause, drop, resume, delay <ms>, close).
import { createServer, connect, type Server, type Socket } from 'node:net';

export type RelayMode = 'open' | 'paused' | 'dropped';

export interface RelayOptions {
  /** Port d'écoute (0 : port libre). */
  listen?: number;
  host?: string;
  target: { host: string; port: number };
}

export class TcpRelay {
  mode: RelayMode = 'open';
  /** Octets transmis dans chaque sens depuis le démarrage (pour les preuves). */
  bytesToTarget = 0;
  bytesFromTarget = 0;
  private delay = 0;
  private readonly pairs = new Set<{ client: Socket; upstream: Socket }>();
  private readonly held: Array<() => void> = [];
  private server!: Server;

  private constructor(private readonly options: RelayOptions) {}

  static async start(options: RelayOptions): Promise<TcpRelay> {
    const relay = new TcpRelay(options);
    relay.server = createServer((client) => relay.accept(client));
    await new Promise<void>((resolve, reject) => {
      relay.server.once('error', reject);
      relay.server.listen(options.listen ?? 0, options.host ?? '127.0.0.1', resolve);
    });
    return relay;
  }

  get port(): number {
    const address = this.server.address();
    if (address === null || typeof address === 'string') throw new Error('relais fermé');
    return address.port;
  }

  get connections(): number {
    return this.pairs.size;
  }

  /** Retient les octets (dans les deux sens) jusqu'à `resume()`. */
  pause(): void {
    this.mode = 'paused';
  }

  /** Ferme toutes les connexions et refuse les nouvelles jusqu'à `resume()`. */
  drop(): void {
    this.mode = 'dropped';
    for (const pair of [...this.pairs]) this.destroyPair(pair);
  }

  /** Rouvre le relais et libère les octets retenus, dans l'ordre. */
  resume(): void {
    this.mode = 'open';
    for (const release of this.held.splice(0)) release();
  }

  /** Retard fixe ajouté à chaque segment, dans chaque sens (LAN simulé). */
  delayMs(ms: number): void {
    this.delay = Math.max(0, ms);
  }

  async close(): Promise<void> {
    this.mode = 'dropped';
    for (const pair of [...this.pairs]) this.destroyPair(pair);
    this.held.length = 0;
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private destroyPair(pair: { client: Socket; upstream: Socket }): void {
    pair.client.destroy();
    pair.upstream.destroy();
    this.pairs.delete(pair);
  }

  private accept(client: Socket): void {
    if (this.mode === 'dropped') {
      client.destroy();
      return;
    }
    const upstream = connect(this.options.target.port, this.options.target.host);
    const pair = { client, upstream };
    this.pairs.add(pair);
    const gone = (): void => this.destroyPair(pair);
    client.on('error', gone);
    upstream.on('error', gone);
    client.on('close', gone);
    upstream.on('close', gone);
    client.on('data', (chunk) => this.forward(chunk, upstream, 'toTarget'));
    upstream.on('data', (chunk) => this.forward(chunk, client, 'fromTarget'));
  }

  private forward(chunk: Buffer, to: Socket, way: 'toTarget' | 'fromTarget'): void {
    const send = (): void => {
      if (to.destroyed) return;
      if (way === 'toTarget') this.bytesToTarget += chunk.length;
      else this.bytesFromTarget += chunk.length;
      to.write(chunk);
    };
    const later = (): void => {
      if (this.mode === 'dropped') return;
      if (this.mode === 'paused') {
        this.held.push(later);
        return;
      }
      if (this.delay > 0) setTimeout(send, this.delay);
      else send();
    };
    later();
  }
}

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

if (require.main === module) {
  const listen = Number(argument('--listen') ?? '0');
  const target = (argument('--target') ?? '').split(':');
  if (target.length !== 2) {
    process.stderr.write('usage : --listen <port> --target <hôte:port>\n');
    process.exit(1);
  }
  void TcpRelay.start({ listen, target: { host: target[0]!, port: Number(target[1]) } }).then(
    (relay) => {
      process.stdout.write(`relais ${relay.port} vers ${argument('--target')}\n`);
      process.stdin.setEncoding('utf8').on('data', (text: string) => {
        for (const line of text.split('\n').map((l) => l.trim())) {
          if (line === 'pause') relay.pause();
          else if (line === 'drop') relay.drop();
          else if (line === 'resume' || line === 'reprise') relay.resume();
          else if (line.startsWith('delay ')) relay.delayMs(Number(line.slice(6)));
          else if (line === 'close') void relay.close().then(() => process.exit(0));
        }
      });
    },
  );
}
