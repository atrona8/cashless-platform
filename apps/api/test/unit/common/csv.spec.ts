import { Csv, CsvParseError, type CsvColumn } from '../../../src/common/csv';

const COLUMNS: CsvColumn[] = [
  { key: 'name', header: 'name', kind: 'text' },
  { key: 'amount', header: 'amount', kind: 'number' },
  { key: 'note', header: 'note', kind: 'text' },
];

describe('Csv.write', () => {
  it('écrit les en-têtes puis les lignes, fin de ligne CRLF, y compris la dernière', () => {
    const text = Csv.write([{ name: 'Stand A', amount: 1500, note: 'ok' }], COLUMNS);
    expect(text).toBe('name,amount,note\r\nStand A,1500,ok\r\n');
  });

  it('met entre guillemets un champ avec séparateur, guillemet ou saut de ligne', () => {
    const rows = [
      { name: 'a,b', amount: 1, note: 'dit "oui"' },
      { name: 'ligne1\nligne2', amount: 2, note: 'x\r\ny' },
    ];
    expect(Csv.write(rows, COLUMNS)).toBe(
      'name,amount,note\r\n"a,b",1,"dit ""oui"""\r\n"ligne1\nligne2",2,"x\r\ny"\r\n',
    );
  });

  it('écrit les valeurs absentes comme des champs vides', () => {
    expect(Csv.write([{ name: 'a', amount: null }], COLUMNS)).toBe('name,amount,note\r\na,,\r\n');
  });

  it('neutralise les formules : =, +, -, @, tabulation, retour chariot', () => {
    for (const start of ["=cmd|' /C calc'!A0", '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      const text = Csv.write([{ name: start, amount: 1, note: '' }], COLUMNS);
      const [, line = ''] = text.split('\r\n');
      expect(
        line.startsWith(`'${start.charAt(0)}`) || line.startsWith(`"'${start.charAt(0)}`),
      ).toBe(true);
      const back = Csv.parse(text, COLUMNS);
      // Aucune neutralisation à la lecture : l'apostrophe est conservée.
      expect(back[0]?.name).toBe(`'${start}`);
    }
  });

  it('laisse intact un champ qui ne commence pas par un déclencheur', () => {
    const text = Csv.write([{ name: 'a=b+c-d@e', amount: 1, note: '' }], COLUMNS);
    expect(text).toContain('\r\na=b+c-d@e,1,');
  });

  it('ne neutralise jamais un nombre : un montant négatif reste -500', () => {
    expect(Csv.write([{ name: 'a', amount: -500, note: '' }], COLUMNS)).toContain('\r\na,-500,');
  });

  it('ne neutralise pas les en-têtes (constantes de code)', () => {
    const columns: CsvColumn[] = [{ key: 'k', header: '=en-tête', kind: 'text' }];
    expect(Csv.write([], columns)).toBe('=en-tête\r\n');
  });

  it('refuse un nombre invalide dans une colonne numérique', () => {
    expect(() => Csv.write([{ name: 'a', amount: Number.NaN }], COLUMNS)).toThrow();
    expect(() => Csv.write([{ name: 'a', amount: '12' }], COLUMNS)).toThrow();
  });

  it('prend un séparateur et un BOM en option', () => {
    const text = Csv.write([{ name: 'a;b', amount: 1, note: 'c' }], COLUMNS, {
      delimiter: ';',
      bom: true,
    });
    expect(text).toBe('﻿name;amount;note\r\n"a;b";1;c\r\n');
    expect(() => Csv.write([], COLUMNS, { delimiter: '"' })).toThrow();
    expect(() => Csv.write([], COLUMNS, { delimiter: ';;' })).toThrow();
  });
});

describe('Csv.parse', () => {
  it('relit ce que write a écrit (aller-retour), champs difficiles compris', () => {
    const rows = [
      { name: 'a,b', amount: 10, note: 'dit "oui"' },
      { name: 'ligne1\nligne2', amount: -20, note: 'x\r\ny' },
      { name: 'é ü 😀', amount: 0, note: '' },
    ];
    expect(Csv.parse(Csv.write(rows, COLUMNS), COLUMNS)).toEqual(rows);
  });

  it('accepte LF seul, CRLF, BOM, et ignore la ligne finale vide', () => {
    const expected = [{ name: 'a', amount: 1, note: 'b' }];
    expect(Csv.parse('name,amount,note\na,1,b\n', COLUMNS)).toEqual(expected);
    expect(Csv.parse('name,amount,note\r\na,1,b\r\n', COLUMNS)).toEqual(expected);
    expect(Csv.parse('﻿name,amount,note\r\na,1,b', COLUMNS)).toEqual(expected);
    expect(Csv.parse('name,amount,note\na,1,b\n\n', COLUMNS)).toEqual(expected);
    expect(Csv.parse('name,amount,note\n', COLUMNS)).toEqual([]);
  });

  it('lit avec un autre séparateur', () => {
    const rows = Csv.parse('name;amount;note\n"a;b";5;c\n', COLUMNS, { delimiter: ';' });
    expect(rows).toEqual([{ name: 'a;b', amount: 5, note: 'c' }]);
  });

  it('refuse des en-têtes manquants, dans le désordre ou en trop, avec le numéro de ligne', () => {
    for (const text of [
      '',
      'name,amount\na,1\n',
      'amount,name,note\n1,a,b\n',
      'name,amount,note,x\n',
    ]) {
      expect(() => Csv.parse(text, COLUMNS)).toThrow(CsvParseError);
    }
  });

  it('refuse un nombre de colonnes faux et nomme la ligne', () => {
    try {
      Csv.parse('name,amount,note\na,1,b\nc,2\n', COLUMNS);
      throw new Error('aucune erreur');
    } catch (error) {
      expect(error).toBeInstanceOf(CsvParseError);
      expect((error as CsvParseError).line).toBe(3);
    }
    expect(() => Csv.parse('name,amount,note\na,1,b,c\n', COLUMNS)).toThrow(CsvParseError);
  });

  it('refuse un guillemet non fermé (fichier tronqué) ou mal placé', () => {
    expect(() => Csv.parse('name,amount,note\n"a,1,b\n', COLUMNS)).toThrow(CsvParseError);
    expect(() => Csv.parse('name,amount,note\na"b,1,c\n', COLUMNS)).toThrow(CsvParseError);
    expect(() => Csv.parse('name,amount,note\n"a"b,1,c\n', COLUMNS)).toThrow(CsvParseError);
  });

  it('refuse une valeur non entière dans une colonne numérique', () => {
    for (const bad of ['', '1.5', 'abc', '1e3', ' 1']) {
      expect(() => Csv.parse(`name,amount,note\na,${bad},c\n`, COLUMNS)).toThrow(CsvParseError);
    }
  });

  it('compte les lignes physiques quand un champ contient un saut de ligne', () => {
    try {
      Csv.parse('name,amount,note\n"a\nb",1,c\nd,2\n', COLUMNS);
      throw new Error('aucune erreur');
    } catch (error) {
      expect((error as CsvParseError).line).toBe(4);
    }
  });

  it('écrit et relit 10 000 lignes en moins de 2 secondes', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      name: `Ligne ${i}, "citée"`,
      amount: i - 5000,
      note: 'ok',
    }));
    const start = Date.now();
    const back = Csv.parse(Csv.write(rows, COLUMNS), COLUMNS);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(back).toHaveLength(10_000);
    expect(back[9999]).toEqual(rows[9999]);
  });
});
