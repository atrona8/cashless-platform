"""Génère docs/Mission-01-Fondations-grand-livre.docx sur le gabarit du document de la 5a.

Appel : python3 gen_1_doc.py docs/Mission-05a-Identite-enrolement-terminaux.docx docs/Mission-01-Fondations-grand-livre.docx \
    kitty-specs/fondations-grand-livre-01M4AY8M/spec.md
"""
import copy
import sys

import docx
from docx.oxml.ns import qn

SRC, OUT = sys.argv[1], sys.argv[2]
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


def set_runs(p, text):
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





import re

SPEC = open(sys.argv[3], encoding='utf-8').read()


def spec_rows(prefix, cols):
    rows = []
    for line in SPEC.splitlines():
        m = re.match(r'^\| (%s-\d{3}) \|' % prefix, line)
        if m:
            cells = [c.strip().replace('`', '') for c in line.strip('|').split('|')]
            rows.append([cells[i] for i in cols])
    return rows


# --- Page de garde ---------------------------------------------------------------------------
para('cover_title', 'Cashless Platform')
para('cover_main', 'Mission 1 : Fondations du grand livre et de l’API')
para('cover_sub', 'Contenu détaillé de la mission : besoin, décisions, architecture, plan de travail, avancement')
table(['Élément', 'Valeur'], [
    ['Identifiant Spec Kitty', 'fondations-grand-livre-01M4AY8M'],
    ['Branche de travail', 'feat/fondations-grand-livre (coordination : kitty/mission-fondations-grand-livre-01M4AY8M)'],
    ['Type de mission', 'software-dev'],
    ['Dépend de', 'Aucune mission précédente'],
    ['Missions qui en dépendent', 'Les missions 2 à 6 (spécification, section Dépendances)'],
    ['État au 5 novembre 2026', 'Acceptée en local le 08/10/2026 (e29d38bb) et mergée par squash (ff0cf25d) ; revue post-merge du '
     '08/10/2026 : PASS WITH NOTES ; CI GitHub verte (run 37771506938) ; ff0cf25d est un ancêtre de main ; '
     'les 14 lots sont terminés'],
], widths_from=EX['cover_tbl'])
add(copy.deepcopy(EX['spacer']))
add(copy.deepcopy(EX['blank']))
para('toc_title', 'Sommaire')
toc()

# --- 1. Résumé ---------------------------------------------------------------------------------
para('h1', '1. Résumé')
para('para', 'La mission 1 pose le socle de toute la plateforme. Elle ne publie aucune route métier : l’API n’expose '
     'que la route de santé GET /v1/health. Elle livre la preuve qu’un grand livre en partie double est juste et que '
     'chaque future route héritera des mêmes garanties.')
para('para', 'Concrètement, la mission met en place le monorepo en npm workspaces (apps/api, packages/contracts, '
     'packages/ledger-sql), les migrations de la base à partir du schéma de référence, un outillage local qui fait '
     'tourner pgTAP sans Docker ni droits administrateur (cluster PostgreSQL 17 privé sur le port 5433), et la CI '
     'GitHub. Côté API, elle livre le squelette NestJS avec le cloisonnement par prestataire, les erreurs '
     'application/problem+json traduites depuis le SQLSTATE, le magasin d’idempotence applicatif (S21), '
     'X-Request-Id et Accept-Language. Elle livre enfin le moteur d’écritures : un constructeur pour chacun des 26 '
     'types de transaction, des calculs en bigint, les 19 cas normatifs, le refus des types non acceptés selon le '
     'statut de l’événement, et le rejeu des 48 transactions de scenario_reference.json jusqu’à CLOSED et LOCKED.')
para('para', 'État final : les 14 lots sont terminés (statut done), la matrice d’acceptation donne le verdict pass sur '
     '24 critères (FR-001 à FR-024) et aucun invariant négatif. Les chiffres de la revue post-merge : 505 assertions '
     'pgTAP vertes (400 + 64 + 41 pour la table d’idempotence), 505 tests Jest (15 suites) dont le rejeu du scénario, '
     'pipeline local de 152 s (seuil de 15 minutes). La revue ne relève aucun constat critique ni élevé.')
para('h2', 'Ce que la mission doit prouver')
for m in re.finditer(r'^- \*\*(SC-\d{3})\*\*: (.+)$', SPEC, re.M):
    para('list', f'{m.group(2).strip().replace("`", "")} ({m.group(1)}).')

# --- 2. Contexte et sources --------------------------------------------------------------------
para('h1', '2. Contexte et sources')
para('para', 'Toutes les missions suivantes (identité, configuration, bracelets, terminaux, recharges) écrivent dans un '
     'grand livre en partie double. Le point de départ est la base de référence et ses suites pgTAP (400 + 64 assertions), qu’il faut faire '
     'tourner partout, y compris sur le poste de développement de référence (Windows 10, PostgreSQL 17 sans pgTAP, '
     'pas de Docker).')
para('para', 'Sources normatives, par ordre de priorité en cas de contradiction (SPECIFICATION §0.3) :')
for s in [
    'les tests exécutables : suites pgTAP de packages/ledger-sql ;',
    'le schéma SQL de référence, packages/contracts/openapi.yaml et sync_protocol.md ;',
    'docs/SPECIFICATION.md (§2, §5, §10.1 et §10.2, §12.1, §13.1, §14.2 S21, §16 critères 1 à 3) ;',
    'PRD.md.',
]:
    para('list', s)
para('para', 'Artefacts de la mission : kitty-specs/fondations-grand-livre-01M4AY8M/ (spec.md, plan.md, research.md '
     'dont R-13 consigne les contradictions, data-model.md, contracts/, quickstart.md, tasks.md et tasks/WP01 à WP14, '
     'analysis-report.md, acceptance-matrix.json, mission-review-report.md, retrospective.yaml, decisions/).')

# --- 3. Périmètre ------------------------------------------------------------------------------
para('h1', '3. Périmètre')
para('h2', 'Inclus')
for s in [
    'Monorepo npm workspaces, TypeScript strict, ESLint (règle anti-décimaux dans le moteur), Jest avec SWC, '
    'dépendances aux versions exactes installées par npm ci --ignore-scripts.',
    'Outillage local tools/dev-db : cluster PostgreSQL 17 privé sur le port 5433, pgTAP construit sans make (version '
    'épinglée, somme SHA-256 contrôlée), pg_prove par CPAN local::lib.',
    'Migrations 0001 (schéma de référence, puis roles.sql rejoué) et 0002 (table api_idempotency, RLS forcée, garde '
    'd’immuabilité), exécuteur de migrations, reset-db.sh, test:pgtap, contrôle des fichiers générés.',
    'Types TypeScript générés depuis openapi.yaml par openapi-typescript (export ProblemCode), avec contrôle « à jour ».',
    'Moteur d’écritures : calculs entiers, 26 constructeurs (5 délégués aux fonctions de la base), matrice des '
    'statuts, ports ConfigResolver et résolution des comptes, LedgerEngineService.',
    'Squelette NestJS : accès base par TenantTx.run (set_config à portée de transaction), fournisseur de contexte '
    'remplaçable, X-Request-Id, Accept-Language fr/en, filtre problem+json, route de santé.',
    'Idempotence applicative S21 : Idempotency-Key, Idempotency-Replayed, IDEMPOTENCY_KEY_REUSED, '
    'IDEMPOTENCY_KEY_IN_PROGRESS, empreinte JCS, décorateur @Idempotent().',
    'Rejeu du scénario de référence (48 transactions) et second rejeu sans effet.',
    'CI .github/workflows/ledger-tests.yml (job unique ledger, PostgreSQL 17).',
]:
    para('list', s)
para('h2', 'Hors périmètre (missions suivantes)')
table(['Sujet', 'Mission prévue'], [
    ['Authentification réelle (jusque-là, un fournisseur de contexte remplaçable alimente le prestataire)', 'Mission 2'],
    ['Création réelle des parties, événements, grands livres et comptes par l’API (la fixture du rejeu les pose par un rôle de préparation)', 'Mission 3'],
    ['Gestion réelle des bracelets et types Dart générés', 'Mission 4'],
    ['Flux de double validation qui fournit le valideur des écritures de back-office', 'Missions suivantes (FR-019)'],
    ['Mesure du p95 « serveur seul » de 200 ms', 'Missions qui publient POST /payments et les recharges'],
    ['Surveillance des transactions de plus de 60 s (§13.7) et purge des entrées S21 expirées', 'Tâches d’exploitation ultérieures (R-12)'],
    ['Tout élément V2 (packages/nfc-sdk, routes x-release: V2)', 'Hors V1 (C-008)'],
])

# --- 4. Décisions de cadrage -------------------------------------------------------------------
para('h1', '4. Décisions de cadrage')
para('para', 'Cinq décisions de cadrage ont été prises à la spécification et au plan (dossier decisions/ de la mission), '
     'puis des décisions de suite consignées dans docs/DECISIONS_ADR.md.')
table(['Sujet', 'Décision', 'Date'], [
    ['pgTAP en local (spécification)', 'Script du dépôt sans make ni droits administrateur, pg_prove via Perl de Git Bash',
     '07/10/2026'],
    ['Étendue du moteur', 'Les 26 types de la liste fermée, chacun testé ; les types BACKOFFICE reçoivent '
     'created_by et approved_by en paramètres, endpoints et flux d’approbation dans les missions suivantes', '07/10/2026'],
    ['Gestionnaire de paquets', 'npm workspaces (et non pnpm)', '07/10/2026'],
    ['Routes de l’API', 'Aucune route métier : santé seulement ; garanties testées par une route de test non publiée, '
     'absente d’openapi.yaml', '07/10/2026'],
    ['pgTAP en local (plan)', 'Cluster PostgreSQL 17 privé : binaires copiés dans le profil utilisateur, pgTAP ajouté, '
     'port 5433 ; affine la décision de la spécification', '07/10/2026'],
    ['Durée des clés d’idempotence (ADR-79)', 'La mission codait 24 h par défaut ; le porteur a retenu 30 jours '
     '(IDEMPOTENCY_TTL_HOURS = 720)', '09/10/2026'],
    ['Idempotence : chemin concret et appelant (ADR-116)', 'La règle 3 de contracts/idempotency.md est révisée : '
     'l’empreinte porte sur le chemin concret et la clé est liée à l’appelant (OP-N71 levé)', '21/10/2026'],
])

# --- 5. Exigences ------------------------------------------------------------------------------
para('h1', '5. Exigences')
fr = spec_rows('FR', [0, 1, 3])
para('h2', f'5.1 Exigences fonctionnelles ({len(fr)})')
table(['ID', 'Exigence', 'Priorité'], fr)
nfr = spec_rows('NFR', [0, 1, 2])
para('h2', f'5.2 Exigences non fonctionnelles ({len(nfr)})')
table(['ID', 'Sujet', 'Seuil mesurable'], nfr)
c = spec_rows('C', [0, 1, 2])
para('h2', f'5.3 Contraintes ({len(c)})')
table(['ID', 'Sujet', 'Contrainte'], c)

# --- 6. Architecture retenue -------------------------------------------------------------------
para('h1', '6. Architecture retenue')
para('h2', '6.1 Composants')
table(['Composant', 'Rôle'], [
    ['packages/ledger-sql', 'Migrations 0001 (schéma de référence) et 0002 (api_idempotency), exécuteur, reset-db.sh, '
     'test:pgtap, check:generated ; suites générées jamais modifiées à la main (C-002)'],
    ['packages/contracts', 'generated/openapi.ts produit par openapi-typescript ; export ProblemCode ; script check'],
    ['tools/dev-db', 'setup.sh, start.sh, stop.sh, build_pgtap.py, env.sh : cluster privé 5433 avec pgTAP et pg_prove'],
    ['apps/api : db', 'Pool pg, int8 lu en BigInt, TenantTx.run avec set_config(app.operator_id, …, true) ; seul module '
     'qui touche pg (test d’architecture)'],
    ['apps/api : http et errors', 'X-Request-Id, journal structuré, Accept-Language et catalogue fr/en, filtre '
     'problem+json et table SQLSTATE vers ProblemCode'],
    ['apps/api : idempotency', 'Dépôt S21 (réserver, compléter, relâcher), empreinte JCS (RFC 8785), intercepteur, '
     'décorateur @Idempotent(), IdempotentTx'],
    ['apps/api : ledger', 'Calculs bigint, 26 constructeurs et registre, matrice des statuts, ports ConfigResolver et '
     'résolution des comptes, LedgerEngineService (seul appelant de post_transaction)'],
    ['apps/api : health', 'GET /v1/health, seule route publiée, hors openapi.yaml'],
    ['.github/workflows/ledger-tests.yml', 'Job unique ledger sur ubuntu-24.04 avec le service postgres:17, 10 étapes '
     '(voir .github/CI.md)'],
])
para('h2', '6.2 Garanties transverses')
for s in [
    'Isolation : l’API se connecte avec le seul rôle cashless_app ; chaque transaction pose le prestataire par '
    'set_config(…, true), jamais par un SET de session. Sans set_config, une requête ne voit aucune ligne.',
    'Erreurs : application/problem+json (RFC 9457), code pris dans ProblemCode, traduction par SQLSTATE, aucun '
    'fragment de message SQL renvoyé ; un SQLSTATE inconnu donne INTERNAL_ERROR.',
    'Idempotence : toute requête qui écrit exige Idempotency-Key ; rejeu identique renvoie la réponse d’origine avec '
    'Idempotency-Replayed: true ; contenu différent donne 409 IDEMPOTENCY_KEY_REUSED ; requête en cours donne '
    '409 IDEMPOTENCY_KEY_IN_PROGRESS. Une clé COMPLETED expirée n’est jamais réutilisée (R-13, C-7).',
    'Durées du rôle applicatif : transaction_timeout 60 s, statement_timeout 30 s, '
    'idle_in_transaction_session_timeout 10 s, vérifiées sur la connexion de l’API (NFR-008).',
]:
    para('list', s)
para('h2', '6.3 Chaîne du moteur d’écritures')
for s in [
    'Le service reçoit une commande (type, clé, occurred_at, source, grand livre, montant, devise), refuse '
    'VALIDATION_FAILED tout type absent de la colonne « Types acceptés » du statut, puis fige la configuration en '
    'vigueur et lit les soldes seulement si la répartition l’exige.',
    'Le constructeur du type calcule en entiers (arrondi au plus proche, moitié s’éloignant de zéro ; taxe extraite '
    'une fois par bénéficiaire) et le service appelle post_transaction, qui rend la transaction nouvelle ou existante.',
    'Cinq types sont délégués aux fonctions de la base sans construire de lignes : DEPOSIT_TAKEN (take_deposit), '
    'DEPOSIT_REFUNDED (refund_deposit), DEPOSIT_FORFEITED (forfeit_deposit), WALLET_REFUND des espèces dues '
    '(refund_cash_due) et PROMO_CREDIT de préchargement (preload_media).',
    'Écart d’ordre consigné (R-13, C-9 ; DRIFT-3 de la revue) : le verrou et la lecture de la clé passent avant le '
    'contexte, la matrice et les soldes, comme dans post_transaction ; un rejeu n’est donc pas soumis à la matrice.',
]:
    para('list', s)

# --- 7. Points d’attention ---------------------------------------------------------------------
para('h1', '7. Points d’attention et contradictions')
para('h2', '7.1 Constats de la revue post-merge et état actuel')
para('para', 'La revue du 08/10/2026 conclut PASS WITH NOTES : 22 exigences fonctionnelles sur 24 couvertes de façon '
     'adéquate, 2 partiellement (FR-014, FR-018). Elle ne signale aucun écart de sécurité accepté et aucun faux à '
     'interdire en production : les faux de cette mission (fournisseur de contexte par en-tête) vivent sous test/ '
     'et aucun import de test/ n’est fait depuis src/. Aucune ligne de la mission n’est donc portée dans '
     'docs/POINTS_OUVERTS.md au titre d’un écart de sécurité. État de chaque constat d’après les sources consultées :')
table(['Constat', 'Sujet', 'État actuel'], [
    ['DRIFT-1 (moyen)', 'Règle wallet_scope = ORGANIZER non traitée ni testée ; une commande sans événement sur un '
     'grand livre ORGANIZER est refusée', 'Aucune source consultée ne consigne une levée ; sans effet tant qu’aucun '
     'grand livre ORGANIZER n’existe'],
    ['DRIFT-2 (bas)', 'Routage délégué refund_cash_due et preload_media sans test d’intégration via le moteur',
     'Aucune levée consignée dans les sources consultées'],
    ['DRIFT-3 (bas)', 'Ordre du moteur différent de §5.4', 'Accepté, documenté (R-13, C-9) et nécessaire à FR-021'],
    ['RISK-1 (moyen)', 'Revue par lot sans indépendance (même acteur pour implémenter et approuver les 14 lots)',
     'La relecture humaine de idempotency/ et ledger/ est recommandée par la revue ; aucune source consultée '
     'ne la consigne comme faite'],
    ['RISK-2 (moyen)', 'Rien n’oblige une route @Idempotent à écrire par IdempotentTx', 'Levé : test '
     'apps/api/test/unit/idempotency-guard.spec.ts (cité dans la revue de la mission 2)'],
    ['RISK-3 (bas)', 'Rejeu moteur d’une transaction écrite sans empreinte : seul le type est comparé',
     'Aucune levée consignée dans les sources consultées'],
    ['RISK-4 (bas)', 'Isolation en écriture prouvée par pgTAP seulement, pas au niveau de l’API',
     'Aucune levée consignée dans les sources consultées'],
    ['RISK-5 (bas)', 'Moteur et idempotence sans appelant de production (attendu)', 'Câblage par les missions 2 et 3, '
     'conformément au périmètre'],
    ['RISK-6 (bas)', 'JSON.stringify échoue sur un bigint dans le corps d’une réponse idempotente',
     'Aucune levée consignée dans les sources consultées'],
])
para('h2', '7.2 Contradictions de sources signalées (research.md R-07 et R-13)')
para('para', 'Règle appliquée partout : SPECIFICATION §0.3. Aucune n’a été tranchée en silence.')
for s in [
    'C-1 : LATERE_CLAIM_INVALID figure dans ProblemCode sans description ni statut HTTP ; statut 409 retenu.'.replace('LATERE', 'LATE'),
    'C-2 : la fiche WP07 demandait une contre-passation dans le même ordre, le scénario (normatif) inverse l’ordre ; '
    'ordre du scénario retenu.',
    'C-3 : le CHECK dicté pour api_idempotency_completed laissait passer un response_status NULL ; IS NOT NULL ajouté.',
    'C-5 : cellules ambiguës de la matrice §12.1 (CHARGEBACK, PAYOUT_CONFIRMED, PAYOUT_FAILED, REVERSAL, '
    'BREAKAGE_REVERSAL) ; lecture retenue documentée dans status-matrix.ts.',
    'C-6 : le SQLSTATE 42501 ne distingue pas DEVICE_REVOKED d’un refus de politique RLS ; correspondance gardée.',
    'C-7 : le contrat traitait une clé expirée comme neuve, la garde de api_idempotency l’interdit ; une clé COMPLETED '
    'n’est jamais réutilisée.',
    'C-10 et R-07 : les clés, dates et mémos des cautions de scenario_reference.json (deposit:W04:1) diffèrent de ceux '
    'des fonctions de la base (deposit:<uuid>:<n>, now()) ; le schéma prime, le rejeu délègue et compare les seuls '
    '(compte, montant). Proposition au propriétaire des sources : aligner le JSON par gen_golden.py.',
    'C-11 et C-15 : deux correctifs hors carte du moteur, trouvés par le rejeu (caution rejouée après confiscation) et '
    'par la répétition CI (lectures de soldes chevauchantes sur un même client pg).',
    'C-14 : la contrainte C-010 (pas de dépôt distant) est caduque, un dépôt distant existe.',
    'Décision de cadrage contre l’existant : ADR-79 remplace la durée de 24 h codée par la mission par 30 jours.',
]:
    para('list', s)
para('h2', '7.3 Relecture et fichiers à faire relire par une personne')
para('para', 'La revue post-merge recommande une relecture humaine des modules apps/api/src/idempotency/ et '
     'apps/api/src/ledger/. À ces deux modules, d’après ses notes de sécurité et les règles C-001 à C-003, s’ajoutent '
     'à relire : migrations 0001 et 0002 et post-roles.sql ou roles.sql (droits de la base, RLS), '
     'apps/api/src/db/tenant-tx.ts, apps/api/src/errors/problem.filter.ts, tools/dev-db/ (téléchargement de pgTAP '
     'et de pg_prove, somme SHA-256). Le mot de passe cashless_app_ci du workflow est un secret de test d’une base '
     'éphémère, à ne jamais réutiliser hors CI. L’agent qui a écrit le code ne vaut pas relecture indépendante.')

# --- 8. Plan de travail ------------------------------------------------------------------------
para('h1', '8. Plan de travail')
para('para', '14 lots de travail, 75 sous-tâches (T001 à T075). Les 14 sont au statut done. La revue relève que les '
     '14 approbations ont le même acteur que l’implémentation et qu’aucun cycle de rejet n’a eu lieu.')
table(['Lot', 'Objet', 'Sous-tâches', 'Dépend de', 'État'], [
    ['WP01', 'Monorepo et outillage TypeScript', 'T001 à T005', 'Aucun', 'Terminé'],
    ['WP02', 'Base locale : cluster PostgreSQL 17 privé avec pgTAP', 'T006 à T010', 'Aucun', 'Terminé'],
    ['WP03', 'Migrations et suites pgTAP de référence', 'T011 à T015', 'WP01, WP02', 'Terminé'],
    ['WP04', 'Table d’idempotence S21 (0002)', 'T016 à T019', 'WP03', 'Terminé'],
    ['WP05', 'Types générés depuis le contrat', 'T020 à T022', 'WP01', 'Terminé'],
    ['WP06', 'Calculs monétaires et 19 cas normatifs', 'T023 à T028', 'WP01', 'Terminé'],
    ['WP07', 'Constructeurs « festival »', 'T029 à T035', 'WP06', 'Terminé'],
    ['WP08', 'Constructeurs « clôture et back-office » et registre des 26 types', 'T036 à T042', 'WP07', 'Terminé'],
    ['WP09', 'Matrice des statuts et ports du moteur', 'T043 à T046', 'WP07', 'Terminé'],
    ['WP10', 'Squelette NestJS et garanties transverses', 'T047 à T053', 'WP03, WP05', 'Terminé'],
    ['WP11', 'Idempotence applicative et preuves transverses', 'T054 à T059', 'WP04, WP10', 'Terminé'],
    ['WP12', 'Service du moteur d’écritures', 'T060 à T064', 'WP08, WP09, WP10', 'Terminé'],
    ['WP13', 'Rejeu du scénario de référence', 'T065 à T071', 'WP12', 'Terminé'],
    ['WP14', 'Intégration continue', 'T072 à T075', 'WP04, WP05, WP11, WP13', 'Terminé'],
])

# --- 9. Avancement -----------------------------------------------------------------------------
para('h1', '9. Avancement et prochaines étapes')
table(['Étape', 'État', 'Remarque'], [
    ['Spécification', 'Faite', '07/10/2026 : 24 FR, 8 NFR, 10 contraintes, 6 critères de réussite ; 4 décisions de cadrage'],
    ['Plan', 'Fait', '07/10/2026 ; 5e décision de cadrage (cluster privé) ; passe adversariale sur la chaîne d’approvisionnement (R-11)'],
    ['Lots et analyse', 'Faits', '14 lots, 75 sous-tâches ; analyse : 0 constat critique, couverture de 100 % des FR et 97 % des NFR (NFR-006 partiel)'],
    ['Implémentation et relecture', 'Faites', '14 lots approuvés, aucun cycle de rejet'],
    ['Addendum documentaire post-review', 'Fait', '08/10/2026 (docs/06-docs-status.md : B-plan le 07/10, B-review et vérification pré-conclusion le 08/10)'],
    ['Matrice d’acceptation', 'Faite', 'Verdict pass, 24 critères, 0 invariant négatif'],
    ['Accept et fusion', 'Faits', 'Accept local le 08/10/2026 (e29d38bb), squash ff0cf25d '],
    ['CI GitHub', 'Verte', 'Run 37771506938 (commit ea20434), toutes les étapes vertes'],
    ['Revue post-merge', 'Faite', '08/10/2026 : PASS WITH NOTES, aucun constat critique ni élevé'],
    ['Entrée dans main', 'Faite', 'ff0cf25d est un ancêtre de main ; premier merge de PR visible : PR #1 du 09/10/2026 (89c877b0)'],
])
para('para', 'Prochaines étapes : relecture humaine des fichiers listés en 7.3 ; traitement de DRIFT-1 avant la mission '
     'qui introduit les portefeuilles durables ; tests d’intégration de refund_cash_due et preload_media par le moteur '
     '(DRIFT-2) ; sérialiseur bigint aux frontières HTTP (RISK-6). Les modifications ultérieures de l’idempotence '
     '(ADR-79, ADR-99 pour OP-N54, ADR-116 pour OP-N71) sont consignées dans ces ADR (ADR-79 : décision du porteur du 09/10/2026 ; ADR-99 et ADR-116 : mission 5a).')

d.save(OUT)
print('ok', OUT)
