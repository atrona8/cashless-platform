"""Génère docs/Mission-07-Hors-ligne-snapshots-lots.docx sur le gabarit du document de la 5a.

Appel, depuis la racine du dépôt :
  python3 docs/passation-7/scripts/gen_7_doc.py \
    docs/Mission-05a-Identite-enrolement-terminaux.docx \
    docs/Mission-07-Hors-ligne-snapshots-lots.docx \
    kitty-specs/hors-ligne-snapshots-lots-01M645RN/spec.md
Le gabarit n'est jamais modifié. Le troisième argument (spec.md) fournit les exigences et les critères de succès.
"""
import copy
import re
import sys

import docx
from docx.oxml.ns import qn

SRC, OUT, SPECFILE = sys.argv[1], sys.argv[2], sys.argv[3]
TASKS = SPECFILE.replace('spec.md', 'tasks.md')
d = docx.Document(SRC)
body = d.element.body
els = list(body)
EX = {
    'cover_title': els[0], 'cover_main': els[1], 'cover_sub': els[2], 'cover_tbl': els[3],
    'spacer': els[4], 'blank': els[5], 'toc_title': els[6], 'h1': None, 'h2': None,
    'para': els[33], 'list': els[39],
}
for e in els:
    if e.tag == qn('w:p'):
        ps = e.find(qn('w:pPr'))
        st = ps.find(qn('w:pStyle')) if ps is not None else None
        v = st.get(qn('w:val')) if st is not None else None
        if v == 'Titre1' and EX['h1'] is None and ''.join(e.itertext()).startswith('1.'):
            EX['h1'] = e
        if v == 'Titre2' and EX['h2'] is None:
            EX['h2'] = e
tables = {i: e for i, e in enumerate(els) if e.tag == qn('w:tbl')}
TBL = {2: tables[74], 3: tables[71], 5: tables[113]}
sectPr = els[-1]
for e in els[:-1]:
    body.remove(e)


def clean(text):
    return text.replace(' — ', ' : ').replace('—', ':')


def set_runs(p, text):
    text = clean(text)
    for b in p.findall(qn('w:bookmarkStart')) + p.findall(qn('w:bookmarkEnd')):
        p.remove(b)
    runs = p.findall(qn('w:r'))
    for r in runs[1:]:
        p.remove(r)
    r = runs[0]
    for t in r.findall(qn('w:t')):
        r.remove(t)
    t = r.makeelement(qn('w:t'), {})
    t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    t.text = text
    r.append(t)


def add(e):
    sectPr.addprevious(e)


def para(kind, text):
    p = copy.deepcopy(EX[kind])
    set_runs(p, text)
    add(p)


def table(header, rows, widths_from=None):
    tpl = TBL[len(header)] if widths_from is None else widths_from
    t = copy.deepcopy(tpl)
    trs = t.findall(qn('w:tr'))
    head, data = trs[0], trs[1]
    for tr in trs:
        t.remove(tr)

    def fill(tr, values):
        for tc, v in zip(tr.findall(qn('w:tc')), values):
            ps = tc.findall(qn('w:p'))
            for p in ps[1:]:
                tc.remove(p)
            set_runs(ps[0], v)
        return tr
    t.append(fill(copy.deepcopy(head), header))
    for row in rows:
        t.append(fill(copy.deepcopy(data), row))
    add(t)


def toc():
    p = copy.deepcopy(EX['para'])
    for r in p.findall(qn('w:r')):
        p.remove(r)

    def run(child):
        r = p.makeelement(qn('w:r'), {})
        r.append(child)
        p.append(r)

    def fld(kind):
        f = p.makeelement(qn('w:fldChar'), {qn('w:fldCharType'): kind})
        if kind == 'begin':
            f.set(qn('w:dirty'), 'true')
        return f
    run(fld('begin'))
    it = p.makeelement(qn('w:instrText'), {})
    it.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    it.text = ' TOC \\h \\o "1-2" '
    run(it)
    run(fld('separate'))
    t = p.makeelement(qn('w:t'), {})
    t.text = 'Sommaire : Word le met à jour à l’ouverture (sinon clic droit, « Mettre à jour les champs »).'
    run(t)
    run(fld('end'))
    add(p)


SPEC = open(SPECFILE, encoding='utf-8').read()
TASKS_TXT = open(TASKS, encoding='utf-8').read()


def spec_rows(prefix, cols):
    rows = []
    for line in SPEC.splitlines():
        m = re.match(r'^\| (%s-\d{3}) \|' % prefix, line)
        if m:
            cells = [c.strip().replace('`', '') for c in line.strip().strip('|').split('|')]
            rows.append([cells[i] for i in cols])
    return rows


def subtasks_per_wp():
    n = {}
    for m in re.finditer(r'^\| T\d{3} \|.*\| (WP\d{2}) \|', TASKS_TXT, re.M):
        n[m.group(1)] = n.get(m.group(1), 0) + 1
    return n


# --- Page de garde ---------------------------------------------------------------------------
para('cover_title', 'Cashless Platform')
para('cover_main', 'Mission 7 : Hors ligne (snapshots et lots)')
para('cover_sub', 'Contenu détaillé de la mission : besoin, décisions, architecture, plan de travail, avancement')
table(['Élément', 'Valeur'], [
    ['Identifiant Spec Kitty', 'hors-ligne-snapshots-lots-01M645RN'],
    ['Branche de travail', 'feat/hors-ligne-snapshots-lots (coordination kitty/mission-hors-ligne-snapshots-lots-01M645RN, '
     'lanes kitty/mission-hors-ligne-snapshots-lots-01M645RN-lane-a à u)'],
    ['Type de mission', 'software-dev'],
    ['Dépend de', 'Missions 1 (grand livre), 2 (identité, rôles), 3 (configuration), 4 (bracelets NFC), '
     '5a (identité des terminaux), 5b (encaissement en ligne), 6 (recharges, caisses, PSP)'],
    ['État au 5 novembre 2026', 'Acceptée (2865183c) et consolidée le 05/11/2026 sur feat/hors-ligne-snapshots-lots '
     '(squash f3bef0c0) ; revue post-fusion : releasable avec réserves ; PR vers main pas encore ouverte (À faire, '
     'avec l’accord du porteur) ; KMS simulé jusqu’à la mission 12b'],
], widths_from=EX['cover_tbl'])
add(copy.deepcopy(EX['spacer']))
add(copy.deepcopy(EX['blank']))
para('toc_title', 'Sommaire')
toc()

# --- 1. Résumé ---------------------------------------------------------------------------------
para('h1', '1. Résumé')
para('para', 'Les festivals sénégalais perdent souvent le réseau. La mission 7 donne au serveur ce qu’il faut pour que '
     'les terminaux continuent d’encaisser sans réseau, puis pour réconcilier leurs opérations au retour, sans double '
     'écriture et sans perte silencieuse. L’organisateur règle une politique hors ligne à trois portées, plafonnée par le '
     'prestataire, et lit le risque maximal de son événement. Le serveur produit des instantanés signés de l’état des '
     'bracelets (snapshots FULL et DELTA), chiffre les mots de passe pour le seul terminal destinataire et les sert au '
     'terminal. Au retour du réseau, le terminal envoie ses lots d’opérations signés et chaînés : le serveur les rejoue '
     'dans l’ordre des numéros, une transaction par opération, avec un registre des numéros, une table de conflit '
     '(la part non couverte d’une vente va au compte S-ATTENTE avec une anomalie OFFLINE_SHORTFALL), le contrôle de '
     'conformité sur la configuration réellement détenue, les cas de temps et de période, et la reprise après panne.')
para('para', 'Les trous de numérotation (SEQ_GAP) ne se lèvent qu’à deux personnes (waiveSeqGap), et le journal d’un '
     'terminal révoqué ne s’importe qu’à deux personnes. Aucune recharge espèces n’est permise hors ligne (décision du '
     'porteur du 30/10/2026) : un TOPUP_CASH porté par un lot est rejeté. La mission lève aussi cinq dettes de droits '
     'de la base héritées : OP-N57, OP-N58, OP-N68, OP-N69 et OP-N75, chacune avec un test qui échoue si le droit '
     's’élargit.')
para('para', 'Les services externes sont simulés (décision du porteur du 29/10/2026) : la signature des snapshots et les '
     'clés de contenu passent par des ports de clés dont le faux est refusé au démarrage en production (OP-N89). Aucun '
     'snapshot n’est donc servi en production avant la mission 12b, qui apportera les adaptateurs AWS KMS réels.')
para('para', 'État au 5 novembre 2026 : les 21 lots sont approuvés par des relecteurs distincts (huit lots ont connu un '
     'ou plusieurs cycles de rejet), la matrice d’acceptation donne 44 exigences fonctionnelles sur 44 passées et 5 '
     'invariants négatifs confirmés. La mission est acceptée (2865183c) et consolidée sur '
     'feat/hors-ligne-snapshots-lots (squash f3bef0c0). La revue post-fusion, faite par un relecteur indépendant, conclut '
     '« releasable avec réserves », sans constat bloquant. Batterie annoncée par l’orchestrateur à la tête a7bbd1f8 '
     '(avec SKIP_LATENCY=1) : Jest 3239 tests verts, pgTAP 4896 sur 4896 ; la revue ne les a pas relancés. Mesures '
     'faites par la mission sur le poste de développement : lot de 500 opérations p95 42,8 à 43,4 s (seuil 60 s), '
     'FULL de 50 000 bracelets en 27,6 s (seuil 30 s), DELTA servi p95 60 ms (seuil 2 s), blocage visible en 4,1 s au '
     'plus (seuil 5 s). La PR vers main n’est pas encore ouverte.')
para('h2', 'Ce que la mission doit prouver')
for m in re.finditer(r'^- \*\*(SC-\d{3})\*\* : (.+)$', SPEC, re.M):
    txt = re.sub(r'\s+— \[build\].*$', '', m.group(2)).strip().replace('`', '')
    para('list', f'{txt} ({m.group(1)}).')

# --- 2. Contexte et sources --------------------------------------------------------------------
para('h1', '2. Contexte et sources')
para('para', 'Jusqu’ici, un terminal coupé du réseau ne pouvait plus vendre. Le principe est celui de sync_protocol.md : '
     'hors ligne, le terminal autorise seul, sur un snapshot signé reçu avant la coupure et dans des plafonds qui '
     'bornent la perte possible. À la synchronisation, le serveur rejoue chaque opération dans l’ordre des numéros. Le '
     'commerçant est garanti pour toute vente d’un terminal conforme. Le festivalier n’est jamais débité au-delà de son '
     'solde : la part non couverte va au compte d’attente, avec une anomalie.')
para('para', 'Quatre exigences structurent la mission :')
for s in [
    'une opération, une écriture au plus : quel que soit le chemin (en ligne, lot, rejeu), une clé <série>:<numéro> '
    'n’écrit qu’une fois ;',
    'aucun numéro perdu en silence : chaque numéro consommé aboutit à un résultat final ou à un trou levé par deux '
    'personnes ;',
    'aucun faux en production : les services externes sont simulés derrière des ports, et leurs faux font refuser le '
    'démarrage en configuration de production ;',
    'aucune recharge espèces hors ligne : décision du porteur du 30/10/2026, la garde de caisse reste inchangée.',
]:
    para('list', s)
para('para', 'Héritages des missions précédentes traités ici : forme de content_sha256, numéros au-delà de 2^53, trou '
     'd’un corps en ligne invalide, sonde de numéro falsifié (missions 5b et 6), et cinq dettes de droits des missions '
     '4 et 5a (OP-N57, OP-N58, OP-N68, OP-N69, OP-N75).')
para('para', 'Sources normatives, par ordre de priorité en cas de contradiction (SPECIFICATION §0.3) :')
for s in [
    'les tests exécutables : suites pgTAP (dont la suite de référence générée) et tests de l’API ;',
    'le schéma SQL de référence, le contrat openapi.yaml et sync_protocol.md (§1, §3 à §8, §10 à §13) ;',
    'docs/SPECIFICATION.md (§3.2, §5.3, §5.7, §7.6, §8.5, §9.1 à §9.6, §12.1, §13.1, §14.1 S4 à S11) et les ADR citées '
    'par la spécification ;',
    'PRD.md.',
]:
    para('list', s)
para('para', 'Artefacts de la mission : kitty-specs/hors-ligne-snapshots-lots-01M645RN/ (spec.md, plan.md, tasks.md, '
     'research.md dont R-30 fait foi sur R-01 à R-23 et sur les contrats, research-adversarial.md, data-model.md, '
     'contracts/, tasks/WP01 à WP21, acceptance-matrix.json, retrospective.yaml, decisions/). Suivi d’exécution : '
     'docs/passation-7/suivi-lots.md ; revue post-fusion : docs/passation-7/rapports/revue-post-fusion.md.')

# --- 3. Périmètre ------------------------------------------------------------------------------
para('h1', '3. Périmètre')
para('h2', 'Inclus')
for s in [
    'Politique hors ligne à trois portées (organisation, événement, terminal), plafonds du prestataire, politique '
    'effective (capped), risque maximal, historique des modifications écrit par un déclencheur de la base (OP-N58) ; '
    'cash_topup_offline toujours faux.',
    'Snapshots signés : FULL et DELTA en chaîne, version calculée par la base (OP-N57), nouvelle version en 60 s après '
    'un changement et en 5 s après un blocage, mots de passe chiffrés sous une clé de contenu par version enveloppée '
    'pour chaque terminal ACTIVE, accusé de réception, rien pour un terminal révoqué.',
    'Lots : POST /offline-batches (500 opérations et 1 Mio au plus, un lot en vol par terminal, signature et chaîne '
    'recalculées), registre des numéros, résultats ACCEPTED, DUPLICATE, ACCEPTED_WITH_SHORTFALL, REJECTED, lot '
    'abandonné après 15 min, reprise après panne.',
    'Conflits et conformité : part non couverte vers S-ATTENTE, OFFLINE_SHORTFALL, NON_COMPLIANT_OPERATION, CLOCK_SKEW, '
    'SIGNATURE_MISMATCH, conformité sur la configuration détenue (policy_in_force), synchronisations tardives '
    '(SYNC_DEADLINE_PASSED, LATE_OFFLINE_SYNC), annulation hors ligne.',
    'Trous : SEQ_GAP levé à deux personnes (waiveSeqGap), alerte au-delà de 24 h, trace RETRY pour le rejet '
    'réessayable d’un lot.',
    'Import du journal d’un terminal révoqué, à deux personnes (DEVICE_JOURNAL_IMPORT), traité par le travailleur '
    'journal-import.',
    'Vendeur hors ligne : la session en ligne reste valable 12 h, aucun secret ni empreinte de PIN envoyé au terminal.',
    'Dettes de droits levées : OP-N57, OP-N58, OP-N68 (droit par défaut global), OP-N69, OP-N75 (rôle cashless_maint).',
    'Contrat d’API : 18 opérations servies ou corrigées dont 10 ajoutées ; types TypeScript et Dart régénérés.',
    'Processus nouveaux : snapshot-content, snapshot-signer, maintenance ; Swagger UI hors production sur /docs '
    '(ADR-153, ajoutée sur la branche après la fusion).',
]:
    para('list', s)
para('h2', 'Hors périmètre (missions suivantes)')
table(['Sujet', 'Mission prévue'], [
    ['Passerelle locale et son snapshot propre ; tests minimaux 4 et 5 du protocole (§13)', 'Mission 8'],
    ['Rapprochements, versements et clôture', 'Mission 9'],
    ['Application du terminal (vérification de la signature des snapshots côté terminal)', 'Application déléguée à une autre équipe (mission 12)'],
    ['Écrans du back-office', 'Mission 11 (déléguée)'],
    ['Adaptateurs AWS KMS réels (signature, OP-N41, OP-N73), clés de signature par prestataire', 'Mission 12b'],
    ['Suspension automatique du hors ligne après 24 h de trou (le protocole dit « PEUT »)', 'Non retenue : alerte seule, décision humaine ; éventuelle mission ultérieure'],
    ['Recette V1 et revue des limites acceptées', 'Mission 13'],
])

# --- 4. Décisions de cadrage -------------------------------------------------------------------
para('h1', '4. Décisions de cadrage')
para('para', 'Décisions prises avec le porteur du projet du 29 octobre au 5 novembre 2026 (spécification, plan, tâches, '
     'implémentation, fusion). Les décisions du porteur sont consignées dans kitty-specs/…/decisions/ et dans les ADR.')
table(['Sujet', 'Décision', 'Date'], [
    ['Services externes simulés', 'Signature des snapshots par le port de clés existant, faux refusé en production ; '
     'adaptateurs AWS KMS en mission 12b (OP-N89, ADR-138)', '29/10/2026'],
    ['Vendeur hors ligne', 'Session en ligne valable 12 h ; aucune nouvelle connexion hors ligne ; aucun secret ni '
     'empreinte de PIN envoyé au terminal', '29/10/2026'],
    ['Dettes de droits héritées', 'OP-N57, OP-N58, OP-N68, OP-N69, OP-N75 levées dans la mission, chacune avec son test', '29/10/2026'],
    ['Trou de plus de 24 h', 'Alerte seulement, le terminal continue ; levée à deux', '29/10/2026'],
    ['Seuils de performance', 'Lot de 500 en 60 s (p95), FULL de 50 000 en 30 s, DELTA en 2 s (p95)', '29/10/2026'],
    ['Recharge espèces hors ligne (ADR-137)', 'Retirée : TOPUP_CASH dans un lot rejeté par opération ; garde de caisse '
     '(ADR-132) inchangée', '30/10/2026'],
    ['Exposition des plafonds', 'Ventes non acquittées, un acquittement de moins de 120 s compté (strict)', '30/10/2026'],
    ['Snapshots en deux processus', 'snapshot-content (Decrypt + DataKey) prépare le brouillon, snapshot-signer (Sign '
     'seul) vérifie, signe et publie ; l’API publique n’a aucun port de clé', '30/10/2026'],
    ['Trace RETRY (ADR-139, OP-N90)', 'Le quatrième CL007 laisse une trace écrite par la base, seule admise à la clôture '
     'du lot ; alerte à 24 h', '30/10/2026'],
    ['Droits ajoutés aux tâches (ADR-140, OP-N91)', 'Signataire : discard_offline_snapshot_draft et '
     'mark_offline_retry_alerted ; device_journal_imports_processing() à cashless_app', '30/10/2026'],
    ['INSERT direct sur anomaly (ADR-141, OP-N86)', 'Gardé pour cashless_app : sept appelants de la mission 6 ; écart au '
     'plan, consigné le 04/11/2026', '30/10/2026'],
    ['Clés de signature (ADR-142 et ADR-143, OP-N92)', 'Lectures accordées à cashless_keyadmin et cashless_snapsign ; '
     'rotation sans approbation à deux, acteur non vérifié', '30/10 et 02/11/2026'],
    ['Traitement des lots (ADR-145, OP-N94)', 'Vente hors catalogue écrite sans lignes ; config_id inconnu refusé ; '
     'vendor_session_id ajouté au contrat des opérations', '03/11/2026'],
    ['Migration 0050 (ADR-146)', 'Annulation d’un import resté PENDING ; lock_device ajoutée au contrat', '03/11/2026'],
    ['Migration 0051 (ADR-148, OP-N96)', 'Enveloppe event_device_sync_status_api ouverte à cashless_app pour la '
     'remontée des terminaux', '04/11/2026'],
    ['404 neutre (ADR-149)', 'Sans le rôle voulu, waiveSeqGap et importDeviceJournal répondent comme pour un terminal '
     'inconnu (renforcement)', '04/11/2026'],
    ['DATABASE_URL_MAINT (ADR-147, OP-N95)', 'Refusé au démarrage en production s’il vise le propriétaire, un '
     'superutilisateur ou un rôle hors cashless_maint (renforcement)', '04/11/2026'],
    ['Garde des noms secrets (ADR-150, OP-N97)', 'Exemption étroite pour pwd_pack_enc dans offline-snapshots.service.ts seul', '04/11/2026'],
    ['Fraîcheur d’un changement ordinaire (ADR-151, OP-N98)', 'DELTA_AFTER_MS gardé à 60 s ; écart de 60,9 à 62,2 s '
     'accepté ; les blocages tiennent 5 s', '04/11/2026'],
    ['Migrations de performance (ADR-152)', '0052, 0054 à 0057 (NFR-003 et NFR-005), sans changement de droit ; mémoire '
     'de référence limitée à un lot (complément du 05/11/2026)', '04 et 05/11/2026'],
    ['Documentation interactive (ADR-153)', 'Swagger UI 5.34.0 par CDN épinglé avec intégrité SRI, hors production '
     'seulement, contrat affiché tel quel', '05/11/2026'],
])

# --- 5. Exigences ------------------------------------------------------------------------------
para('h1', '5. Exigences')
fr = [[r[0], f'{r[1]} : {r[2]}'] for r in spec_rows('FR', [0, 1, 2])]
para('h2', f'5.1 Exigences fonctionnelles ({len(fr)})')
table(['ID', 'Exigence'], fr)
nfr = spec_rows('NFR', [0, 1, 2])
para('h2', f'5.2 Exigences non fonctionnelles ({len(nfr)})')
table(['ID', 'Sujet', 'Seuil mesurable'], nfr)
c = [[r[0], f'{r[1]} : {r[2]}'] for r in spec_rows('C', [0, 1, 2])]
para('h2', f'5.3 Contraintes ({len(c)})')
table(['ID', 'Contrainte'], c)

# --- 6. Architecture retenue -------------------------------------------------------------------
para('h1', '6. Architecture retenue')
para('h2', '6.1 Composants')
table(['Composant', 'Rôle'], [
    ['packages/ledger-sql', 'Migrations 0043 (politique hors ligne), 0044 (snapshots, brouillon, publication), 0045 '
     '(enveloppes, clés de signature), 0046 (lots, registre, trace RETRY, import), 0047 (anomalies), 0048 (accusés, '
     'terminal et vendeur datés), 0049 (lock_device), puis hors plan 0050 à 0057 ; droits et rôles dans post-roles.sql '
     '(droit par défaut global, cashless_snapcontent, cashless_snapsign, cashless_keyadmin, cashless_maint)'],
    ['apps/api : offline/', 'policy/ (politiques, risque), snapshots/ (service et accusé), batches/ (réception, '
     'traitement), rules/ (règles pures : conformité, période, temps, table de conflit), seq/ (levée de trou), '
     'journal/ (import du journal), anomalies/ (écrivain d’anomalies)'],
    ['Processus snapshot-content', 'Rôle cashless_snapcontent, ports Decrypt et DataKey : cadence, construction du '
     'contenu, chiffrement des mots de passe, enveloppes par terminal, brouillon non signé'],
    ['Processus snapshot-signer', 'Rôle cashless_snapsign, port Sign seul : recalcule l’empreinte du brouillon, signe, '
     'vérifie la signature, publie ; travailleur seq-gap-age (alertes de trous et de RETRY)'],
    ['Processus maintenance', 'Rôle cashless_maint, connexion DATABASE_URL_MAINT : purges retirées de l’API publique '
     '(OP-N75)'],
    ['apps/api : kms/', 'SignPort, capacité sign, faux déterministe refusé en production, rotation par key-admin'],
    ['packages/contracts', 'openapi.yaml complété (18 opérations dont 10 ajoutées), types TypeScript et Dart régénérés'],
    ['packages/tag-format', 'AAD de snapshot (CASHLESS/SNAPKEY/v1) et vecteurs fixes pour l’enveloppe de clé'],
])
para('h2', '6.2 Chaîne d’un snapshot')
for s in [
    'Détection des changements et cadence : une version au plus 60 s après un changement, 5 s après un blocage, version '
    'de maintien à valid_until/3 tant qu’un terminal est éligible.',
    'snapshot-content construit le contenu (FULL, ou DELTA de la version précédente), calcule content_sha256 '
    '(canonicalisation RFC 8785), chiffre les mots de passe sous la clé de contenu de la version, enveloppe cette clé '
    'pour chaque terminal ACTIVE, et dépose un brouillon non signé.',
    'snapshot-signer recalcule l’empreinte du brouillon, refuse un brouillon altéré, signe par le port Sign, vérifie '
    'la signature contre la clé publique, puis publie par publish_offline_snapshot : la version est calculée par la '
    'base (dernière + 1), l’application n’a aucun INSERT direct (OP-N57).',
    'Le terminal lit le snapshot par getOfflineSnapshot (chaîne de versions, ETag, 304, dernier FULL au-delà de 5 pas) '
    'et l’accuse par ackOfflineSnapshot. Un terminal suspendu reçoit 403, un terminal révoqué ne reçoit aucune clé.',
]:
    para('list', s)
para('h2', '6.3 Chaîne d’un lot')
for s in [
    'Contrôles d’entrée : série, grand livre, époque, signature DER du lot, continuité des numéros, empreintes et '
    'chaîne recalculées par le serveur, autorité du signataire. Une signature de lot invalide donne '
    '400 BATCH_SIGNATURE_INVALID, sans écriture comptable.',
    'Un lot à la fois par terminal (BATCH_IN_PROGRESS) ; verrou de session sur un pool dédié '
    '(OFFLINE_BATCH_POOL_SIZE), reprise après panne sans attendre l’abandon à 15 min.',
    'Traitement opération par opération dans l’ordre des numéros, une transaction par opération avec son résultat au '
    'registre ; conformité jugée sur la configuration et le snapshot cités et datés ; table de conflit ; part non '
    'couverte vers S-ATTENTE avec OFFLINE_SHORTFALL ; TOPUP_CASH rejeté.',
    'Résultat lisible par getOfflineBatchResult (200, 202 avec Retry-After, 404). Les trous se lèvent à deux '
    '(waiveSeqGap) ; le journal d’un terminal révoqué s’importe à deux, vérifié de nouveau à l’exécution.',
]:
    para('list', s)
para('h2', '6.4 Droits et secrets')
for s in [
    'Toute table nouvelle est cloisonnée (operator_id, RLS forcée) et fermée à cashless_app ; les écritures de '
    'snapshots, d’historique de politique et de colonnes de terminal passent par des fonctions de la base.',
    'Toutes les fonctions SECURITY DEFINER des migrations 0043 à 0057 portent SET search_path, assert_tenant en premier, '
    'et aucun GRANT à PUBLIC.',
    'L’API publique ne détient aucune clé : ni signature, ni déchiffrement. Aucun mot de passe de bracelet n’est en '
    'clair en base, en journal ou en réponse (balayage avec canari).',
    'Chaque faux de la mission (FakeKms, chiffreur d’entrées, FakeOperationProcessor) porte isFake et est refusé au '
    'démarrage en production (assertNoFakeInProduction, OfflineProcessorGuard).',
]:
    para('list', s)

# --- 7. Points d’attention ---------------------------------------------------------------------
para('h1', '7. Points d’attention et contradictions')
para('h2', '7.1 Écarts de sécurité ouverts')
para('para', 'Chaque écart accepté est consigné dans docs/POINTS_OUVERTS.md et docs/DECISIONS_ADR.md, avec son '
     'risque, la mission qui le lève et un test qui échoue si la limite s’élargit. La revue post-fusion a vérifié que '
     'chaque écart de sécurité repéré dans le code a son entrée, son ADR, son test de borne et son report dans '
     'PROMPTS-A-ENVOYER.md et PRD.md. Un seul écart bloque la production : OP-N89.')
table(['Point', 'Écart et test de borne', 'Levée'], [
    ['OP-N89 (ADR-138)', 'Faux KMS (SignPort, DataKeyPort) pour les snapshots ; démarrage refusé en production, aucun '
     'snapshot servi avant 12b. Tests : production-guard.spec, production-start.spec, offline-production.spec, '
     'crypto-production.spec', 'Mission 12b'],
    ['OP-N90 (ADR-139)', 'Trace RETRY : un numéro sans résultat final admis à la clôture d’un lot ; alerte à 24 h. '
     'Test : tests_offline_batches.sql', 'Écart permanent, revu en mission 13'],
    ['OP-N91 (ADR-140)', 'EXECUTE en plus pour cashless_snapsign et cashless_snapcontent ; cashless_app lit les '
     'identifiants des imports en cours de tous les prestataires. Tests : tests_execute_grants.sql, '
     'tests_offline_batches.sql', 'Écart permanent, revu en mission 13'],
    ['OP-N92 (ADR-142 et ADR-143)', 'Lectures de snapshot_signing_key par cashless_keyadmin ; rotation de la clé sans '
     'approbation à deux, acteur non vérifié. Tests : tests_offline_rights.sql, rotation.spec', 'Mission 13, avec OP-N56'],
    ['OP-N93 (ADR-144)', 'Limites du contenu et de la signature : clés publiques par prestataire, entrée sans mot de '
     'passe publiée en échec fermé, clé d’emballage sans référence, verrou et délai d’orphelin, référence de clé erronée. '
     'Tests : offline-bounds.spec, orphan-config.spec, crypto-encryptor.spec', 'Mission 13 ; clés par prestataire : 12b'],
    ['OP-N94 (ADR-145 et ADR-146)', 'Choix de lots et d’import, migration 0050, lock_device, acteurs d’un import non '
     'contrôlés par la base. Tests : offline-bounds.spec (1 à 3)', 'Mission 13'],
    ['OP-N95 (ADR-147)', '500 au lieu de 413 au-delà de 100 ko, corps d’import lu jusqu’à 21 037 056 octets, filtre '
     'd’identité non exigé au démarrage ; point 3 (DATABASE_URL_MAINT) levé le 04/11/2026. Tests : offline-bounds.spec, '
     'process-guard.spec', 'Mission 13 pour les points 1, 2 et 4'],
    ['OP-N96 (ADR-148)', 'Enveloppe event_device_sync_status_api (SECURITY DEFINER, lecture seule) ouverte à '
     'cashless_app. Tests : tests_offline_rights.sql, tests_execute_grants.sql', 'Mission 13'],
    ['OP-N97 (ADR-150)', 'Exemption de pwd_pack_enc dans la garde des noms secrets de l’API publique. Test : '
     'architecture.spec (liste figée)', 'Mission 13'],
    ['OP-N86 (ADR-141)', 'INSERT direct sur anomaly gardé pour cashless_app (sept appelants de la mission 6). Test : '
     'tests_cash_psp_rights.sql', 'Mission 13'],
])
para('para', 'Deux dettes consignées ne sont pas des écarts de sécurité : OP-N98 (un changement ordinaire est visible en '
     '60,9 à 62,2 s au lieu de 60 s ; ADR-151, tests cadence-bounds et snapshot-latency) et OP-N99 (FR-024 : le câblage '
     'de LEDGER_LOCKED et SYNC_DEADLINE_PASSED depuis le lecteur de conformité n’est prouvé qu’en unitaire ; la base '
     'refuse déjà un grand livre verrouillé, CL003). Toutes deux sont levées en mission 13. Les dettes OP-N57, OP-N58, '
     'OP-N68, OP-N69 et OP-N75 sont levées, avec des tests inversés (ADR-111, ADR-112, ADR-114, ADR-137).')
para('h2', '7.2 Contradictions de sources signalées')
for s in [
    'Politique hors ligne sans route : SPECIFICATION §9.3 la prévoit, openapi.yaml n’avait aucune route ; les routes '
    'sont ajoutées au contrat.',
    'Recharge espèces hors ligne : sync_protocol.md §5.4, §7.5, §8 et §11 (cas 22 et 39) la permettent, la décision du '
    'porteur du 30/10/2026 l’interdit ; le protocole et SPECIFICATION §9 sont à mettre en accord.',
    'Colonnes de terminal encore écrites par l’application : OP-N69 et PROMPTS ne donnaient pas la même liste ; les deux '
    'listes sont réunies, personal_phone et app_mode compris.',
    'Signature invalide : le protocole distingue la signature du lot (400 BATCH_SIGNATURE_INVALID, sans anomalie '
    'comptable) et la signature d’originalité du bracelet (SIGNATURE_MISMATCH, anomalie) ; les deux sont traitées.',
    'Signature des snapshots : SPECIFICATION §9.4 et le protocole exigent une clé dans le KMS ou le HSM, la décision du '
    '29/10/2026 la simule jusqu’à 12b.',
    'Fréquence des versions : 60 s (DEVRAIT) et 5 s après un blocage (DOIT) ; les deux sont tenues, avec l’écart '
    'd’OP-N98 pour le changement ordinaire.',
    'Algorithme de signature : ECDSA P-256 par défaut (protocole, OP-N13) contre Ed25519 dans PROMPTS ; Ed25519 est '
    'reporté avec le KMS réel.',
    'config_id inconnu : sync_protocol.md §7.2 est à mettre en accord avec le choix OFFLINE_NOT_ALLOWED avec '
    'POLICY_LIMIT_EXCEEDED en détail (ADR-145).',
    'vendor_session_id : exigé par le processeur, absent de OfflineOperation ; le porteur a décidé de l’ajouter au '
    'contrat (ADR-145).',
    'openapi.yaml déclare encore 403 à côté de 404 sur waiveSeqGap et importDeviceJournal (ADR-149), à rapprocher de la '
    'règle « jamais 403 » à la prochaine révision du contrat.',
    'ADR-137 annonçait le retrait de l’INSERT direct sur anomaly à cashless_app ; ADR-141 corrige : il est gardé.',
]:
    para('list', s)
para('h2', '7.3 Fichiers à faire relire par une personne (règle 4)')
para('para', 'L’agent qui a écrit le code ne vaut pas relecture indépendante. Les fichiers suivants touchent aux clés, '
     'aux droits de la base ou à la cryptographie et doivent être relus par une personne.')
for s in [
    'Base : migrations 0043 à 0049 (fonctions SECURITY DEFINER, droits, lock_device, plancher de numérotation) ; '
    'migrations 0050, 0051, 0052, 0054, 0055 et 0057 (SECURITY DEFINER, offline_snapshot_source_rows) ; migration 0056 '
    '(index) ; post-roles.sql (§8a droit par défaut, §8g rôle cashless_maint, rôles cashless_snapsign, '
    'cashless_snapcontent, cashless_keyadmin).',
    'Cryptographie et clés : apps/api/src/snapshots-content/ (chiffrement des entrées, enveloppes de clés de contenu, '
    'DekCache, snapshot-draft.repository.ts, snapshot-content.worker.ts) ; apps/api/src/snapshots-signer/ '
    '(snapshot-signer.worker.ts, concurrence) ; apps/api/src/kms/fake-kms.ts et kms.ports.ts ; rotation des clés de '
    'signature (snapshot-keys) ; vérification de la signature de lot et empreinte RFC 8785.',
    'Traitement des lots : batch-runner.ts (garde sous verrou), offline-operation.processor.ts, '
    'sql-config-resolver.ts (périmètre de la mémoire de lot), ledger-engine.service.ts, money/spend.ts, purchase.ts, '
    'offline-sale.writer.ts, shortfall-reduction.ts.',
    'Démarrage et accès : apps/api/src/db/advisory-session.ts, MaintenanceDbModule (garde de rôle au démarrage), '
    'garde des noms secrets (architecture.spec.ts), offline-snapshots.service.ts, body-gate.ts, '
    'authentication.guard.ts, device-identity/, seq-gap.service.ts, journal-import.service.ts.',
]:
    para('list', s)
para('h2', '7.4 Réserves de la revue post-fusion')
para('para', 'Verdict : releasable avec réserves, aucun constat bloquant. Réserves non bloquantes de la revue du '
     '05/11/2026 et suite donnée :')
table(['Réserve', 'Constat', 'Suite'], [
    ['FR-024', 'Preuve partielle du câblage de LEDGER_LOCKED et SYNC_DEADLINE_PASSED', 'Consignée sous OP-N99 (commit c1986f41)'],
    ['Mémoire de lot', 'La titulaire de PLT_REDEV mémorisée sans déclencheur d’immuabilité', 'Consignée dans ADR-152 (complément du 05/11/2026)'],
    ['PRD.md', 'Le numéro OP-N89 n’y figurait pas', 'Ajouté (commit c1986f41)'],
    ['Lignes de plus de 100 caractères', 'Reformatage Prettier prévu à la fusion', 'Fait (commit f578bcb1, 3 fichiers)'],
    ['Performance', 'Mesures NFR-003 à NFR-005 faites sur le poste de développement, marge faible sur le blocage (4,1 s pour 5 s)', 'À remesurer en recette'],
    ['Tests à état global', 'snapshot-keys/rotation, key-admin-worker, offline-isolation', 'À lancer en série en CI'],
    ['Mineurs de WP18', 'Perdus avec une session, non récupérables', 'Aucune'],
])

# --- 8. Plan de travail ------------------------------------------------------------------------
para('h1', '8. Plan de travail')
ST = subtasks_per_wp()
total = sum(ST.values())
para('para', f'21 lots de travail, {total} sous-tâches (T001 à T{total:03d}), 21 lanes (a à u). Phases : contrat et base de '
     'données (WP01 à WP08), ports et processus (WP09 à WP13), API (WP14 à WP20), preuves (WP21). Le premier jalon '
     'livrable seul est WP01 à WP08 : la base et les dettes de droits levées.')
LOTS = [
    ('WP01', 'Contrat d’API, types et codes', '—', 'Approuvé (cycle 2)'),
    ('WP02', 'Base : politique hors ligne', '—', 'Approuvé'),
    ('WP03', 'Base : snapshots, brouillon et publication', '—', 'Approuvé (cycle 3)'),
    ('WP04', 'Base : enveloppes, lecture du terminal, clés de signature', 'WP03', 'Approuvé'),
    ('WP05', 'Base : lots, registre, trace RETRY, import', '—', 'Approuvé'),
    ('WP06', 'Base : anomalies et historique du portefeuille', 'WP05', 'Approuvé'),
    ('WP07', 'Base : terminal, vendeur et configuration datés', 'WP03, WP05', 'Approuvé'),
    ('WP08', 'Droits de la base et dettes héritées', 'WP02 à WP07', 'Approuvé (cycle 2)'),
    ('WP09', 'Port de signature et faux', 'WP04', 'Approuvé'),
    ('WP10', 'Processus de maintenance', 'WP08', 'Approuvé'),
    ('WP11', 'Processus snapshot-content : cadence et brouillon', 'WP03, WP06, WP08, WP09', 'Approuvé (cycle 3)'),
    ('WP12', 'Processus snapshot-content : chiffrement et enveloppes', 'WP04, WP11', 'Approuvé'),
    ('WP13', 'Processus snapshot-signer et alertes', 'WP03, WP06, WP08, WP09', 'Approuvé'),
    ('WP14', 'API : politique hors ligne', 'WP01, WP02, WP08', 'Approuvé'),
    ('WP15', 'API : service des snapshots et configuration servie', 'WP01, WP04, WP07, WP08', 'Approuvé (cycle 2)'),
    ('WP16', 'Registre, empreintes, numéros, anomalies', 'WP06, WP08', 'Approuvé'),
    ('WP17', 'Règles pures (conformité, période, temps, conflit)', 'WP01', 'Approuvé'),
    ('WP18', 'Réception des lots', 'WP01, WP05, WP08, WP16', 'Approuvé'),
    ('WP19', 'Traitement des opérations', 'WP06, WP07, WP16, WP17, WP18', 'Approuvé (cycle 2)'),
    ('WP20', 'Trous et import du journal', 'WP05, WP19', 'Approuvé (cycle 2)'),
    ('WP21', 'Preuves de bout en bout, CI, consignation', 'Tous les autres', 'Approuvé (cycle 2)'),
]
table(['Lot', 'Objet', 'Sous-tâches', 'Dépend de', 'État'],
      [[w, o, str(ST.get(w, 0)), dep, st] for w, o, dep, st in LOTS])

# --- 9. Avancement -----------------------------------------------------------------------------
para('h1', '9. Avancement et prochaines étapes')
table(['Étape', 'État', 'Remarque'], [
    ['Spécification', 'Faite', '29/10/2026 : 44 FR, 15 NFR, 13 contraintes, 12 critères de succès ; 8 contradictions de sources signalées'],
    ['Plan', 'Fait', '30/10/2026 ; passe contradictoire : 33 constats (3 bloquants, 18 majeurs, 12 mineurs), tous suivis ; R-30 fait foi'],
    ['Lots et analyse', 'Faits', f'30/10/2026 : 21 lots, {total} sous-tâches, 21 lanes ; analyse : verdict ready, 0 critique, 0 élevé, 7 moyens, 5 faibles'],
    ['Implémentation et relecture', 'Faites', '30/10 au 04/11/2026 : 21 lots approuvés ; 10 cycles de rejet sur 8 lots (WP01, WP08, WP15, WP19, WP20, WP21 un chacun, WP03 et WP11 deux chacun)'],
    ['Addendum documentaire post-relecture', 'Fait', '05/11/2026 ; trois diagrammes /illustre régénérés'],
    ['Matrice d’acceptation', 'Faite', '44 exigences fonctionnelles passées sur 44, 5 invariants négatifs confirmés (76/76 rejoués)'],
    ['Accept et consolidation', 'Faits', '05/11/2026 : accept 2865183c, squash f3bef0c0 sur feat/hors-ligne-snapshots-lots, rétrospective df5c229b'],
    ['Revue post-fusion', 'Faite', '05/11/2026 : releasable avec réserves, aucun constat bloquant'],
    ['Correctifs après fusion', 'Faits', '05/11/2026 : batterie complète (a7bbd1f8), Prettier 100 caractères (f578bcb1), Swagger UI hors production (a3104551)'],
    ['PR vers main', 'À faire', 'Pas encore ouverte, avec l’accord du porteur'],
    ['Relecture humaine des fichiers du 7.3', 'À faire', 'Clés, droits de la base, cryptographie'],
    ['Remesure des performances hors poste de développement', 'À faire', 'NFR-003, NFR-004, NFR-005, en recette'],
])
para('para', 'Prochaines étapes : ouvrir la PR vers main quand le porteur le décide ; relecture humaine des fichiers '
     'listés en 7.3 ; en CI, lancer en série les suites à état global ; remesurer les seuils de performance en recette. '
     'Missions suivantes : mission 8 (passerelle locale), mission 9 (rapprochements, versements, clôture), mission 12b '
     '(adaptateurs AWS KMS réels, qui lèvent OP-N89), mission 13 (recette V1, qui revoit OP-N90 à OP-N99 et OP-N86). '
     'Suivi : docs/passation-7/suivi-lots.md et docs/passation-7/rapports/revue-post-fusion.md.')

d.save(OUT)
print('ok', OUT)
