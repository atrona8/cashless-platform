import { NODE_ENVS, nodeEnv } from '../src/node-env';

describe('nodeEnv', () => {
  it.each(['production', 'development', 'test'])('accepte %s', (value) => {
    expect(nodeEnv(value)).toBe(value);
  });

  it('énumère exactement les trois valeurs', () => {
    expect([...NODE_ENVS]).toEqual(['production', 'development', 'test']);
  });

  it.each([
    [undefined, 'NODE_ENV manquant : production, development, test attendu'],
    ['', 'NODE_ENV manquant : production, development, test attendu'],
    ['prod', 'NODE_ENV inconnu (« prod ») : production, development, test attendu'],
    ['staging', 'NODE_ENV inconnu (« staging ») : production, development, test attendu'],
  ])('refuse %p avec le message d’origine', (value, message) => {
    expect(() => nodeEnv(value)).toThrow(message);
  });
});
