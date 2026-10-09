"""Construit l'extension pgTAP pour PostgreSQL >= 10 sans `make`.

Reproduit les étapes du Makefile de pgTAP 1.3.x (règle `sql/pgtap.sql`, puis copie vers
`sql/pgtap--$(EXTVERSION).sql`) : aucun patch de compatibilité n'est appliqué au-delà de PostgreSQL 9.6, et
seules trois substitutions sont faites — MODULE_PATHNAME -> pgtap, __OS__ -> nom du système, __VERSION__ ->
version courte (ex. 1.3). pgTAP 1.x est du SQL pur : pas de bibliothèque C à compiler.

Usage : python -I build_pgtap.py <dossier source pgTAP> <dossier share/extension> <nom du système>
"""
import pathlib
import re
import sys


def main() -> int:
    src = pathlib.Path(sys.argv[1])
    dest = pathlib.Path(sys.argv[2])
    osname = sys.argv[3]

    control = (src / 'pgtap.control').read_text(encoding='utf-8')
    match = re.search(r"default_version\s*=\s*'([^']*)'", control)
    if not match:
        print('default_version introuvable dans pgtap.control', file=sys.stderr)
        return 1
    extversion = match.group(1)
    numversion = re.match(r'(\d+\.\d+)', extversion).group(1)

    sql = (src / 'sql' / 'pgtap.sql.in').read_text(encoding='utf-8')
    sql = sql.replace('MODULE_PATHNAME', 'pgtap').replace('__OS__', osname).replace('__VERSION__', numversion)

    dest.mkdir(parents=True, exist_ok=True)
    (dest / f'pgtap--{extversion}.sql').write_bytes(sql.replace('\r\n', '\n').encode('utf-8'))
    (dest / 'pgtap.control').write_bytes(control.replace('\r\n', '\n').encode('utf-8'))
    print(f'pgTAP {extversion} installé dans {dest}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
