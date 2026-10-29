// Valeur secrète qui ne s'affiche jamais : toString, toJSON et util.inspect rendent « [secret] ».
// Seul `reveal()` rend la valeur ; l'appelant ne la journalise ni ne la met dans un message d'erreur.
import { inspect } from 'node:util';

export class Secret {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
  }

  static of(value: string): Secret {
    if (typeof value !== 'string' || value.length === 0) throw new Error('secret vide refusé');
    return new Secret(value);
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[secret]';
  }

  toJSON(): string {
    return '[secret]';
  }

  [inspect.custom](): string {
    return '[secret]';
  }
}
