// Faux serveur S3 local (REST, adressage par chemin `/<compartiment>/<clé>`) avec Object Lock. Il fait ce que S3
// fait de ce qui compte pour la copie des scellements : refus d'un objet verrouillé sans mode ni date de rétention,
// `If-None-Match: *` (412 si l'objet existe), contrôle de la somme SHA-256 annoncée, refus de suppression d'un objet
// verrouillé. Jamais d'appel à AWS : le client pointe sur 127.0.0.1 avec des identifiants factices.
import { S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { FAKE_AWS_CREDENTIALS } from './kms';
import { startFakeServer, type FakeServer, type RecordedRequest } from './http-fake';

export interface FakeS3Object {
  body: Buffer;
  lockMode: string | null;
  retainUntil: string | null;
  checksumSha256: string | null;
}

export interface FakeS3Server extends FakeServer {
  bucket: string;
  /** Objets stockés, par clé (sans le compartiment). */
  objects: Map<string, FakeS3Object>;
}

function xmlError(res: ServerResponse, status: number, code: string, message: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/xml');
  res.end(
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`,
  );
}

/** Décode un corps `aws-chunked` (taille hexadécimale, données, trailer de somme) si le SDK l'a employé. */
function decodeBody(req: RecordedRequest): { body: Buffer; trailerChecksum: string | null } {
  const encoding = String(req.headers['content-encoding'] ?? '');
  if (!encoding.includes('aws-chunked')) return { body: req.body, trailerChecksum: null };
  const parts: Buffer[] = [];
  let offset = 0;
  let trailer: string | null = null;
  while (offset < req.body.length) {
    const eol = req.body.indexOf('\r\n', offset);
    const size = parseInt(req.body.subarray(offset, eol).toString('ascii').split(';')[0] ?? '', 16);
    offset = eol + 2;
    if (size === 0) {
      const tail = req.body.subarray(offset).toString('utf8');
      trailer = /x-amz-checksum-sha256:(\S+)/i.exec(tail)?.[1] ?? null;
      break;
    }
    parts.push(req.body.subarray(offset, offset + size));
    offset += size + 2;
  }
  return { body: Buffer.concat(parts), trailerChecksum: trailer };
}

export async function startFakeS3(bucket = 'cashless-seals-test'): Promise<FakeS3Server> {
  const objects = new Map<string, FakeS3Object>();
  const handler = (req: RecordedRequest, res: ServerResponse): void => {
    if (!String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256 Credential=AKIAFAKE'))
      return xmlError(res, 403, 'AccessDenied', 'signature absente');
    const path = decodeURIComponent((req.path.split('?')[0] ?? '').replace(/^\//, ''));
    const slash = path.indexOf('/');
    const requestBucket = slash < 0 ? path : path.slice(0, slash);
    const key = slash < 0 ? '' : path.slice(slash + 1);
    if (requestBucket !== bucket)
      return xmlError(res, 404, 'NoSuchBucket', 'The specified bucket does not exist');

    if (req.method === 'PUT') {
      const { body, trailerChecksum } = decodeBody(req);
      const announced =
        (req.headers['x-amz-checksum-sha256'] as string | undefined) ?? trailerChecksum;
      const actual = createHash('sha256').update(body).digest('base64');
      if (announced !== undefined && announced !== null && announced !== actual)
        return xmlError(res, 400, 'BadDigest', 'The SHA256 you specified did not match');
      const mode = (req.headers['x-amz-object-lock-mode'] as string | undefined) ?? null;
      const until =
        (req.headers['x-amz-object-lock-retain-until-date'] as string | undefined) ?? null;
      if ((mode === null) !== (until === null))
        return xmlError(res, 400, 'InvalidArgument', 'mode et date de rétention vont ensemble');
      if (req.headers['if-none-match'] === '*' && objects.has(key))
        return xmlError(
          res,
          412,
          'PreconditionFailed',
          'At least one of the pre-conditions you specified did not hold',
        );
      if (objects.get(key)?.lockMode === 'COMPLIANCE')
        return xmlError(res, 403, 'AccessDenied', 'objet verrouillé');
      objects.set(key, {
        body,
        lockMode: mode,
        retainUntil: until,
        checksumSha256: announced ?? null,
      });
      res.statusCode = 200;
      res.setHeader('etag', `"${createHash('md5').update(body).digest('hex')}"`);
      return void res.end();
    }
    if (req.method === 'GET') {
      const object = objects.get(key);
      if (object === undefined)
        return xmlError(res, 404, 'NoSuchKey', 'The specified key does not exist.');
      res.statusCode = 200;
      res.setHeader('content-type', 'application/octet-stream');
      res.setHeader('content-length', String(object.body.length));
      if (object.lockMode !== null) res.setHeader('x-amz-object-lock-mode', object.lockMode);
      if (object.retainUntil !== null)
        res.setHeader('x-amz-object-lock-retain-until-date', object.retainUntil);
      return void res.end(object.body);
    }
    if (req.method === 'DELETE' && objects.get(key)?.lockMode === 'COMPLIANCE')
      return xmlError(res, 403, 'AccessDenied', 'objet verrouillé');
    return xmlError(res, 405, 'MethodNotAllowed', 'méthode non simulée');
  };
  const server = await startFakeServer(handler);
  return { ...server, bucket, objects };
}

/** Client S3 du SDK pointé sur le faux : adressage par chemin, identifiants factices, un seul essai. */
export function s3ClientFor(server: FakeServer): S3Client {
  return new S3Client({
    region: 'eu-west-3',
    endpoint: server.url,
    forcePathStyle: true,
    credentials: FAKE_AWS_CREDENTIALS,
    maxAttempts: 1,
  });
}
