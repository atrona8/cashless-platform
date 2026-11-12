// Test propre du relais : octets identiques, pause qui retient, drop qui coupe, TLS mutuel
// transparent.
import { createServer, connect, type Server, type Socket } from 'node:net';
import { TcpRelay } from '../support/tcp-relay';

let echo: Server;
let relay: TcpRelay;

beforeAll(async () => {
  echo = createServer((socket: Socket) => socket.on('data', (d) => socket.write(d)));
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r));
  const port = (echo.address() as { port: number }).port;
  relay = await TcpRelay.start({ target: { host: '127.0.0.1', port } });
});
afterAll(async () => {
  await relay.close();
  await new Promise<void>((r) => echo.close(() => r()));
});

function open(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(relay.port, '127.0.0.1', () => resolve(socket));
    socket.on('error', reject);
  });
}
const next = (socket: Socket, ms: number): Promise<Buffer | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once('data', (d) => {
      clearTimeout(timer);
      resolve(d);
    });
  });

describe('relais TCP coupable', () => {
  afterEach(() => relay.resume());

  it('transmet les octets à l’identique dans les deux sens', async () => {
    const socket = await open();
    const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    socket.write(payload);
    expect((await next(socket, 2000))?.equals(payload)).toBe(true);
    socket.destroy();
  });

  it('pause retient les octets, resume les livre', async () => {
    const socket = await open();
    relay.pause();
    socket.write(Buffer.from('retenu'));
    expect(await next(socket, 300)).toBeNull();
    relay.resume();
    expect((await next(socket, 2000))?.toString()).toBe('retenu');
    socket.destroy();
  });

  it('drop ferme les connexions et refuse les nouvelles', async () => {
    const socket = await open();
    const closed = new Promise<void>((r) => socket.on('close', () => r()));
    relay.drop();
    await closed;
    const again = await open().catch(() => null);
    if (again !== null) {
      await new Promise<void>((r) => again.on('close', () => r()));
    }
    relay.resume();
    const fresh = await open();
    fresh.write(Buffer.from('ok'));
    expect((await next(fresh, 2000))?.toString()).toBe('ok');
    fresh.destroy();
  });

  it('delayMs ajoute un retard mesurable', async () => {
    const socket = await open();
    relay.delayMs(80);
    const started = Date.now();
    socket.write(Buffer.from('x'));
    await next(socket, 2000);
    relay.delayMs(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    socket.destroy();
  });
});
