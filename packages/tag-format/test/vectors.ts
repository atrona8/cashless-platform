import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const VECTORS_DIR = join(__dirname, '..', 'vectors');
export const vectors = JSON.parse(readFileSync(join(VECTORS_DIR, 'vectors.json'), 'utf8'));
export const hex = (value: string): Buffer => Buffer.from(value, 'hex');
