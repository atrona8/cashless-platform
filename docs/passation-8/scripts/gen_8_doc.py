"""Génère docs/Mission-08-Passerelle-locale.docx sur le gabarit du document de la 5a.

Appel, depuis la racine du dépôt :
  python3 docs/passation-8/scripts/gen_8_doc.py \
    docs/Mission-05a-Identite-enrolement-terminaux.docx \
    docs/Mission-08-Passerelle-locale.docx \
    kitty-specs/passerelle-locale-01M6NM1S/spec.md
Le gabarit n'est jamais modifié. Le troisième argument (spec.md) fournit les exigences et les critères de succès.
Tant que tasks.md n'existe pas, la section 8 présente les concerns IC-01 à IC-16 de plan.md.
"""
import copy
import re
import sys

import docx
from docx.oxml.ns import qn

SRC, OUT, SPECFILE = sys.argv[1], sys.argv[2], sys.argv[3]
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


def spec_rows(prefix, cols):
    rows = []
    for line in SPEC.splitlines():
        m = re.match(r'^\| (%s-\d{3}) \|' % prefix, line)
        if m:
            cells = [c.strip().replace('`', '') for c in line.strip().strip('|').split('|')]
            rows.append([cells[i] for i in cols])
    return rows




# --- Page de garde ---------------------------------------------------------------------------
para('cover_title', 'Cashless Platform')
para('cover_main', 'Mission 8 : Passerelle locale de site')
para('cover_sub', 'Contenu détaillé de la mission : besoin, décisions, architecture, plan de travail, avancement')
table(['Élément', 'Valeur'], [
    ['Identifiant Spec Kitty', 'passerelle-locale-01M6NM1S'],
    ['Branche de travail', 'feat/passerelle-locale (coordination kitty/mission-passerelle-locale-01M6NM1S)'],
    ['Type de mission', 'software-dev'],
    ['Dépend de', 'Missions 1 (grand livre), 2 (identité, rôles), 3 (configuration), 4 (bracelets NFC), '
     '5a (identité des terminaux), 5b (encaissement en ligne), 6 (recharges, caisses, PSP), 7 (hors ligne, snapshots, lots)'],
    ['État au 13 novembre 2026', 'Mission terminée : 25 lots sur 25 approuvés, acceptée (311af360), consolidée sur '
     'feat/passerelle-locale (9d5e4592), revue après fusion faite (publiable avec réserves), dans main par la PR #12 '
     '(6bb1c378) le 13/11/2026. Passerelle inutilisable en production avant la mission 12b'],
], widths_from=EX['cover_tbl'])
add(copy.deepcopy(EX['spacer']))
add(copy.deepcopy(EX['blank']))
para('toc_title', 'Sommaire')
toc()

# --- 1. Résumé ---------------------------------------------------------------------------------
para('h1', '1. Résumé')
para('para', 'Les festivals perdent souvent leur liaison Internet. Le hors ligne de la mission 7 borne le risque par des '
     'plafonds : le terminal décide seul, sur une copie de l’état des bracelets. La mission 8 apporte mieux. Une passerelle '
     'locale, installée sur le site, devient la seule autorité qui débite les portefeuilles de l’événement pendant la coupure. '
     'Les terminaux restent « en ligne » sur elle, sans plafond hors ligne, et les soldes restent exacts. Au retour du réseau, '
     'tout est reversé au central, sans perte et sans double écriture.')
para('para', 'Le grand livre sait déjà tenir cette exclusion (fonctions de bascule et registre de la passerelle, S12 et S13, '
     'jamais exposées). Il manque la passerelle elle-même (apps/gateway) et, au central, les routes debit-authority et /edge/*. '
     'L’admin demande la bascule avec le lien. Le central cesse alors de débiter, la passerelle rattrape tout jusqu’au '
     'filigrane, accuse réception et seulement après débite sur la nouvelle époque. Au rendu, la file numérotée et chaînée est '
     'rejouée au central en source EDGE_SYNC. Le contrat openapi.yaml, déjà partagé avec les équipes clientes, ne change pas : '
     'seuls des champs facultatifs sont ajoutés sous /edge/*.')
para('para', 'Les services matériels sont simulés (décision du porteur du 05/11/2026) : les clés de la passerelle passent par un '
     'port de stockage matériel dont le faux est refusé au démarrage en production. La passerelle n’est donc pas utilisable en '
     'production avant la mission 12b. Plafonds de rejeu des ventes décidées par la passerelle : 50 000 XOF par vente et '
     '500 000 XOF par terminal et par heure. Délai avant l’envoi des mots de passe après une inscription (EDGE_PACK_DELAY) : 30 minutes.')
para('para', 'État au 13 novembre 2026 : la mission est livrée dans main (PR #12, 6bb1c378). Les 25 lots ont été '
     'implémentés et relus par des agents distincts (détail dans docs/passation-8/suivi-lots.md), la mission a été acceptée '
     'et consolidée le 12/11/2026, puis revue après fusion : publiable avec réserves (docs/passation-8/rapports/'
     'revue-mission-8.md). Le seul constat bloquant (pack_verified cru de la passerelle) est consigné en OP-N122 et ADR-188. '
     'La CI (jobs ledger et gateway-e2e, plancher NFR-001 de 100 débits/s, balayage Trivy) est verte. La section 8 présente '
     'encore les concerns du plan ; le découpage réel en 25 lots est dans kitty-specs/passerelle-locale-01M6NM1S/tasks.md.')
para('h2', 'Ce que la mission doit prouver')
for m in re.finditer(r'^- \*\*(SC-\d{3})\*\* : (.+)$', SPEC, re.M):
    txt = re.sub(r'\s+— \[(build|ratchet)\].*$', '', m.group(2)).strip().replace('`', '')
    para('list', f'{txt} ({m.group(1)}).')

# --- 2. Contexte et sources --------------------------------------------------------------------
para('h1', '2. Contexte et sources')
para('para', 'Jusqu’ici, un terminal coupé du central ne pouvait vendre qu’en hors ligne borné (mission 7). Le protocole '
     '(sync_protocol.md §9) prévoit une autorité de débit portée par le grand livre, CENTRAL ou EDGE, avec une époque qui sert de '
     'jeton d’exclusion. Les routes sont partagées avec les équipes clientes depuis le 05/11/2026 : la mission sert ce que le '
     'contrat déclare déjà, sans rien changer pour elles.')
para('para', 'Quatre exigences structurent la mission :')
for s in [
    'une seule autorité débite à tout instant : le central cesse de débiter à la bascule, la passerelle ne débite qu’avec '
    'l’époque détenue, et jamais après RELEASING ;',
    'aucune opération perdue ni écrite deux fois : la file de la passerelle est numérotée, chaînée, persistée avant toute '
    'réponse, puis rejouée dans l’ordre au central ;',
    'aucun faux en production : les clés de la passerelle passent par un port dont le faux fait refuser le démarrage ;',
    'contrat stable : seuls des champs facultatifs sous /edge/* sont ajoutés, vérifiés en CI contre le contrat du 05/11/2026.',
]:
    para('list', s)
para('para', 'Sources normatives, par ordre de priorité en cas de contradiction (SPECIFICATION §0.3) :')
for s in [
    'les tests exécutables : suites pgTAP (dont la suite de référence générée) et tests de l’API ;',
    'le schéma SQL de référence, le contrat openapi.yaml (tag Passerelle, marques x-edge-available) et sync_protocol.md (§9, §13-4, §13-5) ;',
    'docs/SPECIFICATION.md (§9.7, §12.1, §13.1, §14.1 S12 et S13) et l’ADR-52 ;',
    'PRD.md.',
]:
    para('list', s)
para('para', 'Artefacts de la mission : kitty-specs/passerelle-locale-01M6NM1S/ (spec.md, plan.md, research.md, '
     'research-adversarial.md, data-model.md, quickstart.md, contracts/, decisions/). Fiche de contexte : '
     'docs/passation-8/contexte-m8.md ; rapport de la passe contradictoire : docs/passation-8/rapports/plan-adversarial.md. '
     'Consignation : ADR-155 à ADR-165 (docs/DECISIONS_ADR.md) et OP-N100 à OP-N110 (docs/POINTS_OUVERTS.md).')

# --- 3. Périmètre ------------------------------------------------------------------------------
para('h1', '3. Périmètre')
para('h2', 'Inclus')
for s in [
    'Application apps/gateway : base PostgreSQL locale à schéma réduit, machine à états de l’autorité persistée, exclusion par l’époque.',
    'Au central : routes POST et GET /ledgers/{id}/debit-authority, reprise forcée à deux, routes /edge/* sur un processus dédié '
    '(rôle cashless_edge, certificat edgeMtls), réception EDGE_SYNC et rendu.',
    'Bascule demandée par un admin, accusé de la passerelle, échec de bascule, demande de rendu et rendu final avec continuité vérifiée.',
    'Réplication : flux continu avec champs facultatifs (sessions de caisse et de vendeur, terminaux, catalogue, réglages, '
    'mots de passe chiffrés pour la clé d’accord de la passerelle), journal des changements sans écriture comptable, blocages appliqués en moins de 5 s.',
    'Les 16 opérations marquées x-edge-available servies par la passerelle ; toute autre opération de prélèvement refusée.',
    'Guichet : recharges espèces sous une session de caisse ouverte au central et répliquée avant la bascule, activation sans frais '
    'sur solde, caution en espèces.',
    'Lots hors ligne de terminaux traités avec les règles de la mission 7 puis relayés ; snapshots locaux signés par une clé propre.',
    'Reprise forcée à deux personnes, anomalie EDGE_REPLAY_FAILED sur toute référence inconnue, journal des terminaux après reprise.',
    'Passerelle de secours STANDBY, promue par handover normal seulement.',
    'Port de stockage matériel et faux refusé en production ; jetons d’appareil et de personne propres à la passerelle ; purge des secrets du site.',
    'Outil d’administration d’inscription (tools/edge-admin) hors API publique, image de déploiement, procédure de site.',
    'Contrat : champs facultatifs sur ReplicationPage, paramètre after_change_seq, propriété staff_token_audit d’EdgeSyncBatch.',
    'Renforcements de la base : écriture directe de cashless_app sur edge_gateway retirée, record_edge_seq refuse une passerelle '
    'révoquée ou sans handover, begin_cash_close refusé tant que l’autorité est à la passerelle ou que la file n’est pas vide.',
]:
    para('list', s)
para('h2', 'Hors périmètre')
table(['Sujet', 'Mission ou statut'], [
    ['Écrans et application du terminal (C-013) : le terminal apprend l’autorité par les routes existantes', 'Application déléguée à une autre équipe (mission 12)'],
    ['Adaptateurs réels de stockage matériel et d’autorité des passerelles (OP-N100, OP-N101, OP-N105, OP-N106)', 'Mission 12b'],
    ['Ouverture, relève et fermeture de session de caisse sur la passerelle (C-005)', 'Non retenu : garde de caisse inchangée, aucune exemption'],
    ['Recharge espèces dans un lot de terminal hors ligne (C-006)', 'Reste rejetée, y compris par la passerelle'],
    ['Réplication synchrone et prise d’autorité automatique par la passerelle (C-004, C-008)', 'Exclues par le porteur'],
    ['Rotation du jeton de rafraîchissement sur la passerelle', 'Demande un champ de contrat de retour : décision du porteur à prendre'],
    ['Recette V1 et revue des limites acceptées', 'Mission 13'],
])

# --- 4. Décisions de cadrage -------------------------------------------------------------------
para('h1', '4. Décisions de cadrage')
para('para', 'Décisions du porteur du 5 novembre 2026, en deux temps : à la spécification et au plan (1 à 10), puis après la '
     'passe contradictoire (11 à 18). Elles sont consignées dans kitty-specs/…/decisions/, dans docs/passation-8/contexte-m8.md et dans les ADR.')
table(['Sujet', 'Décision', 'Date'], [
    ['Bascule', 'Demandée par un admin, avec le lien ; aucune prise d’autorité par la passerelle (C-004)', '05/11/2026'],
    ['Recharges espèces', 'Servies sur la passerelle, sous une session de caisse ouverte au central et répliquée avant la bascule', '05/11/2026'],
    ['Stockage des clés', 'Port de stockage matériel, faux refusé en production, adaptateur réel en 12b (ADR-155, OP-N100)', '05/11/2026'],
    ['Passerelle de secours', 'STANDBY promue par handover normal seulement', '05/11/2026'],
    ['Contrat', 'Stable ; ajouts facultatifs sous /edge/* seulement ; inscription par outil d’administration hors API publique', '05/11/2026'],
    ['1. Base de la passerelle (ADR-164, OP-N109)', 'PostgreSQL local à schéma réduit, règles partagées en TypeScript, mêmes scénarios de référence ; '
     '« même moteur » devient « mêmes modules »', '05/11/2026'],
    ['2. Jetons d’appareil (ADR-156, OP-N101)', 'Clé propre à la passerelle, jetons valables sur elle seule, refusés au central', '05/11/2026'],
    ['3. Jeton de personne expiré (ADR-158, OP-N103)', 'Toléré sur la passerelle seule, 12 h au plus après la bascule, aux conditions toutes exigées, chaque usage audité', '05/11/2026'],
    ['4. Passerelle perdue (ADR-162, OP-N107)', 'Pas de changement de contrat, pas de rejeu automatique ; EDGE_REPLAY_FAILED, résolution à deux', '05/11/2026'],
    ['5 et 6. Droits de la base', 'Rôle cashless_edge et enveloppe EDGE_SYNC ; post_transaction en EDGE_SYNC refusée à cashless_app ; renforcements consignés ; migrations à partir de 0058', '05/11/2026'],
    ['10. Preuves', 'Deux processus, deux bases, relais TCP coupable, points d’arrêt actifs hors production seulement, étape CI dédiée', '05/11/2026'],
    ['11. Renouvellement du jeton d’appareil (ADR-157, OP-N102)', 'Sans rotation sur la passerelle : empreinte répliquée et certificat, jeton court valable sur elle seule, rotation forcée au retour', '05/11/2026'],
    ['12. Flux de réplication', 'Paramètre facultatif after_change_seq accepté sur /edge/replication-feed', '05/11/2026'],
    ['13. Ventes EDGE_ONLINE (ADR-159, OP-N104)', 'Au rejeu : preuve du bracelet, plafond par vente et par terminal et par heure, alerte. Plafonds fixés : 50 000 XOF par vente, '
     '500 000 XOF par terminal et par heure, réglables côté plateforme', '05/11/2026'],
    ['14. Recharge espèces au rejeu (ADR-163, OP-N108)', 'Jamais rejetée pour un plafond : deux parts, anomalie CASH_TOPUP_OVER_LIMIT résolue à deux ; à signaler au juriste', '05/11/2026'],
    ['15. STALE (ADR-165, OP-N110)', 'Persisté seulement si l’époque est confirmée par le central ou plausible (au plus époque détenue + 2) ; levée locale à deux personnes', '05/11/2026'],
    ['16. Inscription d’une passerelle (ADR-160, OP-N105)', 'Par UNE personne (choix du porteur contre la recommandation de deux) ; alerte immédiate ; EDGE_PACK_DELAY de 30 minutes avant les mots de passe', '05/11/2026'],
    ['17. Purge des secrets (ADR-161, OP-N106)', 'Automatique à la clôture de l’événement, manuelle à deux personnes ; limite : mini-PC volé avant la purge', '05/11/2026'],
    ['18. Audit de la tolérance', 'Versé au central par un champ facultatif sous /edge/* (staff_token_audit)', '05/11/2026'],
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
    ['apps/gateway', 'Passerelle de site (image Docker, mini-PC Linux) : authority (machine à états), replication (tirage du flux), '
     'queue (edge_seq, chaîne, vidage), operations (16 opérations servies), device-proofs, staff, key-store, snapshots ; '
     'base locale PostgreSQL, migrations edge-NNNN'],
    ['apps/api : edge/ et processus dédié', 'Routes /edge/*, garde edgeMtls, réplication, réception EDGE_SYNC, rendu ; rôle cashless_edge ; '
     'certificat de passerelle par une autorité distincte de celle des terminaux'],
    ['apps/api : debit-authority/', 'POST et GET /ledgers/{id}/debit-authority, reprise forcée à deux ; refus des débits centraux en EDGE'],
    ['packages/ledger-sql', 'Migrations 0058 et suivantes : rôle, enveloppes, journal de changements, bornes de rejeu en SQL ; les .sql générés ne sont jamais modifiés'],
    ['packages/shared-rules', 'Règles pures partagées entre central et passerelle (aucun import de Nest, pg, système de fichiers, réseau)'],
    ['packages/contracts', 'openapi.yaml : ajouts facultatifs sous /edge/* seulement ; types TypeScript et Dart régénérés'],
    ['tools/edge-admin', 'Inscription, changement de rôle et révocation d’une passerelle, hors API publique, audités'],
    ['docs/procedure-site-passerelle.md', 'Procédure de site : disque chiffré, onduleur, Wi-Fi dédié, révocation, purge'],
])
para('h2', '6.2 Bascule et exclusion')
for s in [
    'L’admin demande la bascule : le central appelle grant_edge_authority, répond 202, augmente l’époque ; tout débit central répond '
    '409 DEBIT_AUTHORITY_EDGE avec l’adresse de la passerelle et l’époque. L’application n’appelle jamais set_debit_authority.',
    'La passerelle apprend l’accord par le canal de contrôle (attente longue de 25 s au plus, qui vaut battement de cœur), '
    'rattrape les écritures jusqu’au filigrane, puis accuse réception. L’accusé est refusé sans le filigrane ni le curseur de '
    'référence. Elle ne débite qu’après la réponse 200.',
    'Une requête portant l’époque détenue est servie. Une époque supérieure confirmée ou plausible arrête les débits de façon persistante '
    '(STALE) ; une époque implausible est refusée sans arrêt, avec alerte.',
    'Au rendu, la passerelle persiste RELEASING avant toute autre action, refuse les nouveaux débits (409 DEBIT_AUTHORITY_MOVING), '
    'vide sa file, puis demande le rendu avec final_edge_seq, last_chain_hash et operations_count (calculé par cycle).',
]:
    para('list', s)
para('h2', '6.3 File, rejeu et reprise forcée')
for s in [
    'Chaque décision reçoit un edge_seq continu et chaîné, avec la clé d’origine du terminal (son Idempotency-Key), écrit avec '
    'l’effet sur le solde dans la même transaction, avant la réponse au terminal.',
    'Le vidage envoie des lots de 500 opérations et 1 Mio au plus, un lot en vol à la fois. Le central rejoue chaque opération '
    'dans sa propre transaction, en source EDGE_SYNC, sous verrou de compte. Les bornes sont en SQL : types, comptes, preuve '
    'du bracelet, plafonds, annulations, recharge espèces en deux parts.',
    'Un rejeu impossible d’activation ou de caution devient REJECTED EDGE_REPLAY_FAILED, avec anomalie et espèces au compte d’attente.',
    'La reprise forcée est demandée par un OPERATOR_ADMIN après constat physique, approuvée par une seconde personne '
    '(FORCE_CENTRAL_AUTHORITY). Le certificat est révoqué, l’autorité revient au central, le journal des terminaux est traité sans double écriture.',
]:
    para('list', s)
para('h2', '6.4 Droits et secrets')
for s in [
    'La passerelle ne détient aucune clé maître. Clé de signature et clé d’accord passent par le port de stockage matériel '
    '(sign, agree, publicKey, jamais d’export) ; le faux est refusé au démarrage en production.',
    'Les mots de passe de bracelets sont chiffrés sous une clé de contenu par passerelle, scellée pour sa clé d’accord ; ils ne '
    'partent ni vers une STANDBY non promue ni avant EDGE_PACK_DELAY. Aucune empreinte de PIN n’est répliquée.',
    'Chaque route /edge/* est cloisonnée par passerelle, événement et prestataire ; un certificat de terminal ne passe jamais '
    'sur /edge/*, ni l’inverse. Les nonces et les listes @authority sont séparés entre central et passerelle.',
    'Les secrets du site sont détruits à la clôture de l’événement et sur ordre de deux personnes.',
]:
    para('list', s)

# --- 7. Points d’attention ---------------------------------------------------------------------
para('h1', '7. Points d’attention et contradictions')
para('h2', '7.1 Écarts de sécurité acceptés')
para('para', 'Chaque écart est soumis au porteur avant d’être codé, puis consigné dans docs/POINTS_OUVERTS.md et '
     'docs/DECISIONS_ADR.md, avec son risque, la mission qui le lève et un test de borne. Aucun de ces écarts n’est encore codé. '
     'Tous bloquent la production sauf OP-N107, OP-N109 et OP-N110, qui sont des limites de disponibilité ou de procédure. '
     'Le choix de l’inscription par une seule personne (OP-N105) est celui du porteur, contre la recommandation de la passe '
     'contradictoire, qui préconisait deux personnes.')
table(['Point', 'Écart et test de borne', 'Levée'], [
    ['OP-N100 (ADR-155)', 'Clés de la passerelle simulées (HARDWARE_KEYSTORE, EDGE_CA) ; passerelle inutilisable en production avant la 12b. '
     'Test : démarrage réel (NestFactory) refusé pour chaque faux', 'Mission 12b'],
    ['OP-N101 (ADR-156)', 'Secret de signature des jetons d’appareil sur un mini-PC, hors du KMS central. Test : jeton de la passerelle refusé '
     'par le vérificateur central (kid, puis audience)', 'Mission 12b'],
    ['OP-N102 (ADR-157)', 'Jeton d’appareil renouvelé sans rotation : un jeton de rafraîchissement volé n’est pas détecté pendant EDGE ; empreintes '
     'stockées sur le site. Test : empreinte différente refusée, aucun nouveau jeton de rafraîchissement rendu', 'À fixer par le porteur (contrat)'],
    ['OP-N103 (ADR-158)', 'Jeton de personne expiré toléré au guichet, 12 h après la bascule : un compte révoqué pendant la coupure agit jusqu’à 12 h. '
     'Test : refus à 12 h + 1 s, une condition par test', 'À fixer par le porteur'],
    ['OP-N104 (ADR-159)', 'Ventes EDGE_ONLINE sans signature du terminal. Perte maximale par cycle : min(somme des soldes ; terminaux × heures × 500 000 XOF ; '
     'passages réels × 50 000 XOF). Test : passerelle hostile (2 000 ventes fictives) sous la formule', 'Mission 13, ou relais de la signature'],
    ['OP-N105 (ADR-160)', 'Inscription d’une passerelle par UNE personne : elle obtient les mots de passe de l’événement après 30 minutes si l’alerte n’est '
     'pas traitée. Test : alerte levée, aucun colis avant le délai, aucun colis à une STANDBY', 'Mission 12b ou 13 (approbation à deux)'],
    ['OP-N106 (ADR-161)', 'Mini-PC volé avant la purge : secrets lisibles, la révocation ne joint pas une machine débranchée. '
     'Test : canari absent sous toute représentation après purge', 'Mission d’exploitation (12b)'],
    ['OP-N107 (ADR-162)', 'Passerelle perdue : activations et cautions non rejouées, anomalie EDGE_REPLAY_FAILED, rétablissement manuel à deux', 'Mission 13'],
    ['OP-N108 (ADR-163)', 'Recharge espèces au rejeu : dépassement temporaire d’un plafond réglementaire. À SIGNALER AU JURISTE. '
     'Test : jamais REJECTED, deux parts, anomalie CASH_TOPUP_OVER_LIMIT', 'Mission 13, après avis écrit du juriste'],
    ['OP-N109 (ADR-164)', '« Même moteur » devient « mêmes modules » (écart de texte de SPECIFICATION §9). Test d’architecture de shared-rules', 'Mission 13'],
    ['OP-N110 (ADR-165)', 'STALE sur une époque forgée à époque + 1 ou + 2 : arrêt des débits (disponibilité, pas argent) jusqu’à la levée locale à deux', 'Mission 13'],
])
para('para', 'Renforcements décidés puis à consigner dans la mission (ils ne sont pas des écarts) : écriture directe de cashless_app sur '
     'edge_gateway retirée ; record_edge_seq qui refuse une passerelle révoquée, de secours ou sans handover ; EDGE_SYNC refusée à '
     'cashless_app ; begin_cash_close refusé en EDGE ou avec une file non vide ; bornes de décision en SQL sous verrou ; condition '
     'exp >= activated_at de la tolérance ; plafond d’heure persisté. Risques inhérents au protocole, non nouveaux : passerelle '
     'compromise ou zombie après reprise forcée, personne ou terminal révoqué pendant une coupure, mots de passe déchiffrables en '
     'mémoire de la passerelle.')
para('h2', '7.2 Contradictions de sources signalées')
for s in [
    'Recharges espèces : le PRD appliquait à la passerelle l’interdiction du 30/10/2026. Tranché par le porteur le 05/11/2026 : servies sous session de caisse ; PRD mis à jour.',
    'Flux de réplication : ReplicationPage ne porte que portefeuilles et bracelets, alors que SPECIFICATION §9.7 exige aussi sessions, terminaux et catalogue. '
    'Tranché : champs facultatifs limités à /edge/*.',
    'Inscription : le schéma porte edge_gateway mais le contrat n’a aucune route d’inscription. Tranché : outil d’administration hors API publique.',
    '« Même moteur d’écritures » (SPECIFICATION §9) contre un flux qui ne porte que des soldes : tranché en « mêmes modules » (ADR-164).',
    'TOPUP_CASH « toujours rejeté » (OfflineOperationType) contre la recharge espèces servie par la passerelle : l’interdiction vaut pour un lot de terminal, pas pour une décision de la passerelle.',
    'RELEASING posé avant toute vérification (protocole) contre complete_edge_release, dont l’exception annule la transaction : begin_edge_release en transaction propre, '
    'et refus du passage direct RELEASE_REQUESTED vers COMPLETED.',
    'edgeMtls rattaché à public_key dans le contrat, alors que le schéma porte cert_sha256 : mTLS par empreinte, public_key sert à la signature des lots.',
    'post_transaction refuse les débits hors EDGE_SYNC sous EDGE, alors que la passerelle débite sous EDGE : la décision de la passerelle est rejouée en EDGE_SYNC.',
    'La fiche de contexte annonce FR-001 à FR-034 et NFR-001 à NFR-012 ; la spécification en compte 39 et 13 (ajouts FR-035 à FR-039 et NFR-013 après la passe contradictoire). La spécification fait foi.',
]:
    para('list', s)
para('para', 'Restes à soumettre ou à confirmer, rien n’est abandonné en silence : rotation du jeton de rafraîchissement sur la passerelle '
     '(demande un champ de contrat de retour) ; jeton de coupure signé par le central pour lever la tolérance des jetons de personne ; '
     'hypothèse, à confirmer avec l’équipe terminal, qu’un 401 sur un jeton du central déclenche un rafraîchissement ; limites '
     'de la procédure de site (coupure de courant sans onduleur, horloge reculée pendant un arrêt).')
para('h2', '7.3 Fichiers à faire relire par une personne (règle 4)')
para('para', 'L’agent qui écrira le code ne vaut pas relecture indépendante. Les fichiers suivants, prévus au plan, touchent aux clés, '
     'aux droits de la base ou à la cryptographie et devront être relus par une personne. Le code n’existe pas encore : la liste '
     'sera confirmée à la fin des lots.')
for s in [
    'Base : migrations 0058 et suivantes (rôle cashless_edge, droits, enveloppes edge_post_transaction, edge_activate_media, edge_take_deposit, '
    'persistance de STALE, lecture du handover courant, gestion d’horloge, post_transaction, begin_cash_close) ; post-roles.sql et roles.sql.',
    'Accès et identité : main.edge.ts et la garde edgeMtls ; tools/edge-admin ; vérificateur de jetons de la passerelle et règle de tolérance des jetons '
    'de personne (R-20) ; vérificateur de preuves du terminal s’il est adapté.',
    'Clés et cryptographie : tout adaptateur de clé (HARDWARE_KEYSTORE, EDGE_CA) ; canonicalisation de edge_content (R-12) ; mots de passe chiffrés '
    'du flux de réplication ; purge des secrets.',
]:
    para('list', s)

# --- 8. Plan de travail ------------------------------------------------------------------------
para('h1', '8. Plan de travail')
para('para', 'Les lots de travail (WP) n’existent pas encore : /spec-kitty.tasks n’a pas été lancée et aucun fichier tasks.md n’existe. '
     'Cette section présente donc les seize concerns de mise en œuvre IC-01 à IC-16 de plan.md. Un concern n’est pas un lot : '
     '/spec-kitty.tasks les traduira en lots, sous-tâches et lanes, et ce tableau sera alors remplacé par la liste des lots avec leur état.')
IC = [
    ('IC-01', 'Droits, rôle et fonctions de la base (cashless_edge, enveloppes, renforcements) ; premier lot de la CI SQL : les suites générées passent sans modification', 'FR-003, 006, 007, 021, 022, 024, 031 ; C-003, C-010, C-012'),
    ('IC-02', 'Autorité de débit au central : debit-authority, reprise forcée, refus sur tous les chemins de débit', 'FR-003, 004, 007, 013, 028'),
    ('IC-03', 'Canal de la passerelle au central : edgeMtls, attente longue avec réveil immédiat, accusé, rendu', 'FR-005, 006, 021, 022, 031, 034 ; NFR-007, 011'),
    ('IC-04', 'Réplication : un seul schéma de flux, journal des changements, horizon des écritures, mots de passe chiffrés', 'FR-008, 009, 027 ; NFR-008, 010, 012 ; C-002'),
    ('IC-05', 'Réception au central (EDGE_SYNC) : bornes en SQL, une transaction par opération, idempotence par lot', 'FR-017 à 020, 025, 036, 038 ; NFR-003'),
    ('IC-06', 'Passerelle : socle et machine à états, état persisté avant toute réponse, STALE, STANDBY, horloge', 'FR-001, 006, 012, 021, 023, 030 ; NFR-004'),
    ('IC-07', 'Passerelle : file et chaîne (edge_seq, contenu haché fixé par vecteurs, vidage)', 'FR-014, 017, 026 ; NFR-002, 004, 006'),
    ('IC-08', 'Passerelle : preuves du terminal et des personnes, jetons propres, tolérance bornée et auditée', 'FR-010, 039 ; NFR-011'),
    ('IC-09', 'Passerelle : opérations de vente, annulations, lectures, refus ; règles pures partagées', 'FR-010, 011, 012 ; NFR-005'),
    ('IC-10', 'Passerelle : guichet (recharges, activations, cautions), garde de caisse inchangée', 'FR-015, 016, 020 ; C-005, C-006'),
    ('IC-11', 'Passerelle : lots hors ligne relayés et snapshots locaux signés par une clé propre', 'FR-025, 026, 027'),
    ('IC-12', 'Reprise forcée et passerelle perdue : EDGE_REPLAY_FAILED, journal des terminaux', 'FR-028, 029 ; NFR-003'),
    ('IC-13', 'Port de stockage matériel et faux refusés en production (démarrage réel prouvé)', 'FR-032, 035 ; NFR-009, 010, 013 ; C-007, C-009'),
    ('IC-14', 'Inscription (outil d’administration), image, procédure de site, purge', 'FR-002, 033, 034, 037'),
    ('IC-15', 'Contrat : ajouts facultatifs sous /edge/*, contrôle de stabilité en CI contre d2a7c538', 'FR-009 ; NFR-012 ; SC-006 ; C-002'),
    ('IC-16', 'Preuves de bout en bout, CI dédiée, consignation des OP et des ADR, reports en 12b et 13', 'SC-001 à 007 ; NFR-001 à 006'),
]
table(['Concern', 'Objet', 'Exigences liées'], [list(x) for x in IC])
para('para', 'Ordre probable : base et droits d’abord (IC-01, IC-02, IC-15), puis canal et réplication (IC-03, IC-04, IC-05), puis '
     'la passerelle (IC-06 à IC-13), puis l’installation (IC-14) et les preuves (IC-16). Cet ordre est une indication du plan, pas un découpage en lots.')

# --- 9. Avancement -----------------------------------------------------------------------------
para('h1', '9. Avancement et prochaines étapes')
table(['Étape', 'État', 'Remarque'], [
    ['Spécification', 'Faite', '05/11/2026 : 39 FR, 13 NFR, 13 contraintes, 7 critères de succès ; 5 contradictions de sources signalées et tranchées ; décisions et checklist reportées dans PRD et PROMPTS'],
    ['Plan', 'Fait', '05/11/2026 : plan.md, research.md, data-model.md, quickstart.md, contrats ; 16 concerns IC-01 à IC-16'],
    ['Passe contradictoire du plan', 'Faite', '29 constats (4 bloquants, 11 élevés, 11 moyens, 3 faibles) : 23 corrigés, 6 réglés par une décision du porteur ; plafonds (50 000 et 500 000 XOF) et délai (30 minutes) tranchés'],
    ['Consignation des écarts', 'Faite', 'OP-N100 à OP-N110 et ADR-155 à ADR-165 (commit e74f7f06)'],
    ['Tâches et lots', 'Faites', '25 lots (tasks.md) ; la section 8 garde les concerns du plan'],
    ['Implémentation et relecture', 'Faites', '25 lots sur 25 approuvés le 12/11/2026, implémenteur et relecteur distincts par lot'],
    ['Matrice d’acceptation, accept, consolidation', 'Faites', 'Acceptée (311af360), consolidée sur feat (9d5e4592) le 12/11/2026'],
    ['Revue post-fusion', 'Faite', 'Publiable avec réserves ; C1 consigné (OP-N122, ADR-188) ; onze écarts bloquent la production jusqu’à 12b'],
    ['Fusion dans main', 'Faite', 'PR #12 (6bb1c378) le 13/11/2026, après fusion de main (PR #11) et CI verte'],
    ['Relecture humaine des fichiers du 7.3', 'Déclarée faite', 'Par le porteur, avant la fusion du 13/11/2026'],
    ['Avis du juriste (OP-N108)', 'À demander', 'Dépassement temporaire d’un plafond réglementaire au rejeu d’une recharge espèces'],
    ['Confirmation avec l’équipe terminal', 'À demander', 'Un 401 sur un jeton du central déclenche un rafraîchissement ; code 409 CONFLICT_STATE pour ARMED et STANDBY'],
])
para('para', 'Prochaines étapes : lever les écarts de production avec la mission 12b, puis la recette V1. Restes notés '
     'dans docs/passation-8/REPRISE.md (ADR-161/OP-N106, typage des tests, tests fragiles). Missions liées : mission 12b (adaptateurs réels de clés, qui '
     'lèvent OP-N100, OP-N101, OP-N105 et OP-N106) et mission 13 (recette V1, qui revoit OP-N104, OP-N107 à OP-N110). '
     'Suivi : docs/passation-8/contexte-m8.md et docs/passation-8/rapports/plan-adversarial.md.')

d.save(OUT)
print('ok', OUT)
