"""Génère docs/Mission-02-Identite-roles-double-validation.docx sur le gabarit du document de la 5a.

Appel : python3 gen_2_doc.py [gabarit.docx] [sortie.docx] [spec.md]
"""
import copy
import sys

import docx
from docx.oxml.ns import qn

ROOT = 'docs/'
SRC = sys.argv[1] if len(sys.argv) > 1 else ROOT + 'Mission-05a-Identite-enrolement-terminaux.docx'
OUT = sys.argv[2] if len(sys.argv) > 2 else ROOT + 'Mission-02-Identite-roles-double-validation.docx'
SPECPATH = sys.argv[3] if len(sys.argv) > 3 else 'kitty-specs/identite-roles-double-validation-01M4DNDN/spec.md'
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

SPEC = open(SPECPATH, encoding='utf-8').read()


def spec_rows(prefix, cols):
    rows = []
    for line in SPEC.splitlines():
        m = re.match(r'^\| (%s-\d{3}) \|' % prefix, line)
        if m:
            cells = [c.strip().replace('`', '').replace(' — ', ' : ') for c in line.strip('|').split('|')]
            rows.append([cells[i] for i in cols])
    return sorted(rows, key=lambda r: r[0])


# --- Page de garde ---------------------------------------------------------------------------
para('cover_title', 'Cashless Platform')
para('cover_main', 'Mission 2 : Identité, rôles et double validation')
para('cover_sub', 'Contenu détaillé de la mission : besoin, décisions, architecture, plan de travail, avancement')
table(['Élément', 'Valeur'], [
    ['Identifiant Spec Kitty', 'identite-roles-double-validation-01M4DNDN'],
    ['Branche de travail', 'feat/identite-roles (coordination kitty/mission-identite-roles-double-validation-01M4DNDN, '
     'lanes -lane-a à -lane-j)'],
    ['Type de mission', 'software-dev'],
    ['Dépend de', 'Mission 1 (fondations-grand-livre-01M4AY8M)'],
    ['État au 5 novembre 2026', 'Acceptée (211b7f8b, 09/10/2026) et mergée par squash (c2f3934b) sur feat/identite-roles ; '
     'dans main par la PR #1 le 09/10/2026 (89c877b0) ; revue post-fusion : PASS WITH NOTES (306a3739)'],
], widths_from=EX['cover_tbl'])
add(copy.deepcopy(EX['spacer']))
add(copy.deepcopy(EX['blank']))
para('toc_title', 'Sommaire')
toc()

# --- 1. Résumé ---------------------------------------------------------------------------------
para('h1', '1. Résumé')
para('para', 'La mission 2 donne une identité aux personnes. Depuis la mission 1, l’API refusait toute requête faute '
     'de savoir qui appelle. Désormais une personne présente un jeton d’accès court émis par un serveur d’identité '
     'OIDC ; l’API le vérifie avec la bibliothèque jose, retrouve la personne, son prestataire et ses rôles en base '
     '(fonction identify_person), et n’expose que les données de ce prestataire. Les rôles sont attribués par portée '
     '(plateforme, prestataire, organisateur, événement, commerçant). Toute action d’administration et toute étape '
     'd’une action à deux laissent une ligne dans un journal d’audit en ajout seul, chaîné par empreintes et scellable.')
para('para', 'La mission livre aussi les deux formes de double validation d’ADR-74. Au back-office, l’appel d’une '
     'action sensible crée une demande d’approbation (réponse 202, état PENDING) qu’une seconde personne approuve ou '
     'refuse par les quatre routes /approval-requests ; l’action est alors exécutée une seule fois. Sur place, une '
     'garde réutilisable exige l’en-tête X-Approval-Token : jeton à usage unique, lié à la requête précise, dont le '
     'sujet est le valideur. Le valideur ne vient jamais du corps de la requête. Les actions métier qui utiliseront '
     'ce mécanisme appartiennent aux missions suivantes ; la mission le prouve avec une action de démonstration '
     'présente uniquement dans les tests. Une dernière garde (RISK-2 de la revue de la mission 1) fait échouer un '
     'test si une route idempotente écrit hors de la transaction idempotente.')
para('para', 'État au 5 novembre 2026 : les 10 lots sont terminés, chacun relu en un seul cycle, la mission est '
     'acceptée (matrice : 19 critères sur 19 conformes) et mergée. Batterie de la revue post-fusion : pgTAP 676 '
     'assertions vertes, Jest 29 suites et 670 tests verts, CI complète rejouée en 194 s, GitHub Actions vert '
     '(run 37929190686). Verdict de la revue : PASS WITH NOTES, avec deux écarts MEDIUM (DRIFT-1, DRIFT-2) et sept '
     'points ouverts non bloquants, dont l’état actuel est donné en 7.1.')
para('h2', 'Ce que la mission doit prouver')
for m in re.finditer(r'^- \*\*(SC-\d{3})\*\*: (.+)$', SPEC, re.M):
    para('list', f'{m.group(2).strip().replace("`", "")} ({m.group(1)}).')

# --- 2. Contexte et sources --------------------------------------------------------------------
para('h1', '2. Contexte et sources')
para('para', 'La mission 1 a posé le socle : transaction cloisonnée par prestataire, idempotence applicative, erreurs '
     'normalisées, moteur d’écritures, et un port de contexte de prestataire en refus systématique. Le prestataire '
     'de chaque transaction ne peut venir que d’une personne ou d’un terminal authentifié, et aucun n’existait. '
     'La mission 2 remplace ce refus par une identité réelle des personnes (back-office et guichet). Les terminaux, '
     'les vendeurs et les festivaliers viennent avec d’autres missions.')
para('para', 'Sources normatives, par ordre de priorité en cas de contradiction (SPECIFICATION §0.3) :')
for s in [
    'les tests exécutables : suites pgTAP et tests de l’API ;',
    'le schéma SQL de référence (approval_request, decide_approval_request, CL023), le contrat openapi.yaml '
    '(humanBearer, /approval-requests, ApprovalAction, ApprovalRequest, ProblemCode) et sync_protocol.md ;',
    'docs/SPECIFICATION.md (§3.1, §3.2, §10.1 à §10.3, §13.1, §13.3, §14.2 S1 et S3) et ADR-74 ;',
    'PRD.md.',
]:
    para('list', s)
para('para', 'Artefacts de la mission : kitty-specs/identite-roles-double-validation-01M4DNDN/ (spec.md, plan.md, '
     'research.md décisions R-01 à R-12 et contradictions C-01 à C-15, data-model.md, contracts/ avec identity.md, '
     'approvals.md, audit-chain.md et openapi-additions.md, tasks/WP01 à WP10, acceptance-matrix.json, '
     'analysis-report.md, mission-review-report.md). Le plan a été arrêté le 08/10/2026.')

# --- 3. Périmètre ------------------------------------------------------------------------------
para('h1', '3. Périmètre')
para('h2', 'Inclus')
for s in [
    'Personnes (app_user) et attributions de rôle (role_assignment) sous RLS forcée, avec les gardes en base : '
    'portée dans le même prestataire, pas d’auto-attribution, dernier PLATFORM_ADMIN protégé, attribution retirée '
    'non rétablissable ; fonction identify_person (SECURITY DEFINER).',
    'Journal d’audit en ajout seul (audit_log), chaîné par prestataire et par la plateforme (numéro d’ordre sans trou, '
    'empreintes), scellements (audit_seal, seal_audit) et vérification (verify_audit_chain), inaccessibles à la '
    'connexion de l’application.',
    'Authentification par jeton d’accès OIDC (jose 6.2.12, clés publiques en cache, émetteur, audience, tolérance '
    'd’horloge de 10 s), garde globale, Principal, contexte de prestataire de production à la place du refus '
    'systématique ; faux serveur d’identité de test.',
    'Rôles par portée (@Roles, RolesGuard, ScopeResolver) et service d’audit écrit dans la transaction de l’action.',
    'Gestion des personnes et des rôles : 7 routes ajoutées au contrat (listUsers, createUser, getUser, disableUser, '
    'grantRole, revokeRole, createPlatformAdmin), commande d’amorçage bootstrap-admin du premier PLATFORM_ADMIN.',
    'Demandes d’approbation génériques : registre d’actions, création en 202, approbation avec exécution unique '
    '(point de sauvegarde), refus avec note, expiration à 24 h ; routes listApprovalRequests, getApprovalRequest, '
    'approveApprovalRequest, rejectApprovalRequest.',
    'Jeton d’approbation sur place : garde @RequiresOnsiteApproval, act_hash de la requête canonique, usage unique '
    'du jti (table approval_token_use).',
    'Garde RISK-2 : @Idempotent({ writes: true }) et test d’architecture ; problème « validé » enregistré dans la '
    'transaction (CommittedProblem).',
    'Fichier post-roles.sql rejoué après roles.sql par migrate.ts, pour retirer au rôle applicatif ce que roles.sql '
    'lui rend trop largement.',
]:
    para('list', s)
para('h2', 'Hors périmètre (missions suivantes)')
table(['Sujet', 'Mission prévue'], [
    ['Terminaux et vendeurs, codes PIN (S2, S5)', 'Missions 5a et suivantes'],
    ['Festivaliers et code à usage unique (S17, /customer-auth)', 'App festivalier (mission dédiée)'],
    ['Actions métier à deux (versements, écritures manuelles, levée d’un trou de séquence, réclamations tardives)', 'Missions suivantes, qui branchent leur action sur le registre'],
    ['Tâche planifiée de scellement et copie des scellements hors de la base (stockage en écriture unique)', 'Mission 9 (Remboursements, versements et clôture)'],
    ['Choix du produit de serveur d’identité en production', 'Plus tard (interface OIDC standard)'],
])

# --- 4. Décisions de cadrage -------------------------------------------------------------------
para('h1', '4. Décisions de cadrage')
para('para', 'Décisions prises par l’agent sur délégation du porteur du projet le 08/10/2026 (13 Decision Moments '
     'consignés dans decisions/), puis deux décisions du porteur le 09/10/2026.')
table(['Sujet', 'Décision', 'Date'], [
    ['Serveur d’identité', 'OIDC standard derrière une interface, faux fournisseur en test, produit choisi plus tard', '08/10/2026'],
    ['Source des rôles et du prestataire', 'La plateforme (personne et attributions) ; le jeton ne prouve que l’identité', '08/10/2026'],
    ['Gestion des personnes et des rôles', 'Routes minimales ajoutées au contrat, journalisées, plus une commande d’amorçage', '08/10/2026'],
    ['Actions d’approbation', 'Aucune action métier ; mécanisme générique, 4 routes /approval-requests, action de démonstration en test', '08/10/2026'],
    ['Jeton d’approbation sur place', 'Vérification complète côté API par une garde réutilisable ; émission par le serveur d’identité', '08/10/2026'],
    ['Intégrité du journal d’audit (choix du porteur)', 'Chaîne d’empreintes et scellements en base dès cette mission ; tâche planifiée et copie externe avec la mission 9', '08/10/2026'],
    ['Pile logicielle (ADR-78)', 'L’existant prime sur le document du porteur, dont jose 6.2.12 (OP-N39)', '09/10/2026'],
    ['Conservation des clés d’idempotence (ADR-79)', '30 jours (IDEMPOTENCY_TTL_HOURS = 720) au lieu de 24 h (OP-N40)', '09/10/2026'],
])

# --- 5. Exigences ------------------------------------------------------------------------------
para('h1', '5. Exigences')
fr = spec_rows('FR', [0, 1, 2])
para('h2', f'5.1 Exigences fonctionnelles ({len(fr)})')
table(['ID', 'Titre', 'Exigence'], fr)
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
    ['packages/ledger-sql', 'Migrations 0003 (app_user, role_assignment, gardes, identify_person), 0004 (audit_log '
     'chaîné, audit_seal, seal_audit, verify_audit_chain), 0005 (approval_request.result, approval_token_use), 0006 '
     '(create_platform_admin, ajoutée en cours de mission) ; post-roles.sql ; src/bootstrap-admin.ts ; suites pgTAP '
     'tests_identity.sql, tests_audit_log.sql, tests_approvals.sql'],
    ['apps/api/src/identity', 'oidc-verifier.ts (port IdentityVerifier et implémentation jose), authentication.guard.ts, '
     'principal.ts, identity-tenant-context.ts, roles.decorator.ts, roles.guard.ts, scope-resolver.ts, users/ (7 routes)'],
    ['apps/api/src/approval', 'action-registry.ts, approval.service.ts, approval.controller.ts, onsite/ (act-hash.ts, '
     'onsite-approval.ts) pour le jeton sur place'],
    ['apps/api/src/audit', 'audit.service.ts (écrit avec le client de la transaction de l’action), audit-context.ts (origine, identifiant de requête)'],
    ['apps/api/src/idempotency', 'Extensions : CommittedProblem, @Idempotent({ writes }), test idempotency-guard.spec.ts'],
    ['apps/api/test/support', 'fake-idp.ts : faux serveur d’identité (clés ES256 en mémoire, jetons valides et défectueux)'],
    ['packages/contracts', 'openapi.yaml complété de 7 routes, types régénérés'],
])
para('h2', '6.2 Authentification et contexte de prestataire')
for s in [
    'Le jeton est vérifié (signature, émetteur, audience, expiration) avec les clés publiques mises en cache '
    '(délai d’appel 2 s, pause de 30 s) ; serveur d’identité injoignable : 503, jamais d’acceptation sans vérification.',
    'Le sujet doit désigner une personne active (identify_person, une requête SQL par requête HTTP). Prestataire et '
    'rôles viennent de la base. Le claim roles est ignoré ; le claim operator_id est seulement comparé, et un écart donne 401.',
    'Seule la route de santé est publique. Un rôle retiré ou une personne désactivée sont refusés dès la requête suivante.',
]:
    para('list', s)
para('h2', '6.3 Double validation')
for s in [
    'Back-office : création en 202 avec paramètres figés ; approbation par une personne distincte ayant le rôle '
    'exigé sur la même portée ; decide_approval_request reçoit le sujet de SA session (CL023 donne 409 '
    'APPROVAL_INVALID) ; exécution une fois sous point de sauvegarde ; la demande passe EXECUTED ou FAILED, réponse 200 dans les deux cas.',
    'Une demande expirée est enregistrée comme telle puis répond 409 (problème « validé »).',
    'Sur place : X-Approval-Token absent donne 403 APPROVAL_REQUIRED ; signature, expiration, act, act_hash (SHA-256 '
    'de méthode, chemin et corps JCS sans le jeton), sub différent de l’appelant, rôle du sujet et usage unique du '
    'jti sont contrôlés, tout défaut donnant 403 APPROVAL_INVALID. Le jti est consommé dans la transaction de l’opération.',
    'Tout champ approved_by reçu dans un corps est ignoré.',
]:
    para('list', s)
para('h2', '6.4 Journal d’audit')
for s in [
    'Chaque ligne porte son numéro d’ordre et les empreintes précédente et propre dans sa chaîne (une par '
    'prestataire, une pour la plateforme), sous verrou consultatif ; UPDATE et DELETE sont refusés.',
    'seal_audit scelle la tête de chaque chaîne ; verify_audit_chain détecte les lignes modifiées, supprimées ou '
    'insérées et les scellements falsifiés (4 altérations simulées en pgTAP). Ces deux fonctions ne sont pas exécutables par le rôle applicatif.',
]:
    para('list', s)

# --- 7. Points d’attention ---------------------------------------------------------------------
para('h1', '7. Points d’attention et contradictions')
para('h2', '7.1 Écarts et dettes laissés par la mission, et leur état au 5 novembre 2026')
para('para', 'La mission est antérieure à la règle du porteur du 13/10/2026 sur les écarts de sécurité : ses constats '
     'figurent dans mission-review-report.md et research.md, pas dans docs/POINTS_OUVERTS.md sous un numéro OP propre. '
     'L’état actuel ci-dessous vient de la lecture du code et des documents au 5 novembre 2026.')
table(['Point', 'Constat de la revue', 'État actuel'], [
    ['DRIFT-1 (MEDIUM)', 'Les routes de la mission contrôlent les rôles par code (staffAdminRole, canGrant, registre), '
     'pas par @Roles', 'Toujours vrai pour identity/users et approval ; @Roles est utilisé par trois contrôleurs de missions ultérieures (operators, jurisdiction, platform-config). Aucun OP ni ADR dédié trouvé'],
    ['DRIFT-2 (MEDIUM)', 'Aucune route pour retirer ou désactiver un PLATFORM_ADMIN ; la règle du dernier administrateur est garantie en base', 'Toujours ouvert : openapi.yaml ne contient que createPlatformAdmin ; ADR-80 laisse create_platform_admin en SECURITY DEFINER'],
    ['RISK-3 (MEDIUM)', 'Origine de l’audit = req.ip, adresse du répartiteur sans réglage trust proxy', 'Traité par ADR-95 (15/10/2026) : TRUST_PROXY_HOPS, 0 à 5, obligatoire en production (OP-N53 levé)'],
    ['RISK-4 (LOW)', 'Liste des demandes d’approbation parcourue par lots, coût non borné, à borner avant la mission 7 ou 9', 'Aucune borne trouvée : approval.service.ts lit toujours par lots (canSee)'],
    ['RISK-5 (LOW)', 'Auto-désactivation et dernier OPERATOR_ADMIN d’un prestataire permis', 'users.service.ts inchangé depuis la fusion, hors reformatage Prettier'],
    ['NFR-005', 'Vérification d’un jeton au plus 5 ms au p95 : conception conforme, non mesurée', 'Aucune mesure trouvée dans les sources consultées'],
    ['RISK-6 (LOW)', 'Chaque lot implémenté, relu et approuvé par le même agent (par délégation du porteur)', 'Relecture humaine des zones de sécurité recommandée avant le pilote (7.3)'],
    ['FR-019, tâche de scellement', 'Scellement et vérification livrés sans appelant de production', 'Reporté à la mission 9, dont les lots ne sont pas cochés dans PROMPTS-A-ENVOYER.md'],
    ['OP-N56 (liée)', 'decide_approval_request croit l’identifiant de valideur transmis : la base ne sait pas authentifier une personne (limite d’ADR-94)', 'Ouverte, consignée le 15/10/2026 ; levée prévue par la mission 11 (back-office) avec le serveur d’identité réel'],
])
para('h2', '7.2 Contradictions de sources signalées (FR-017)')
para('para', 'Quinze contradictions sont consignées dans research.md (C-01 à C-15), avec la règle de priorité appliquée. Les principales :')
for s in [
    'C-01 : openapi.yaml renvoie result dans ApprovalRequest, le schéma n’a pas la colonne ; colonne result jsonb ajoutée par la migration 0005.',
    'C-02 : requested_by est décrit comme le sub de la session alors que la colonne est un UUID ; app_user.id est écrit partout.',
    'C-03 : « le prestataire n’est jamais passé en paramètre » contre les routes /operators/{operator_id}/… ; exception écrite dans le contrat.',
    'C-04 : rôles et prestataire « dans le claim » du jeton ; ils sont lus en base à chaque requête, la section Sécurité du contrat est corrigée.',
    'C-05 : « toute création exige Idempotency-Key » contre POST /platform-admins (api_idempotency exige operator_id) ; createPlatformAdmin sans clé.',
    'C-06 : conservation des clés d’idempotence, 30 jours au contrat contre 24 h codées (ADR-79).',
    'C-07 : document de pile du porteur contre l’existant (ADR-78).',
    'C-10 : aucune route ne retire un PLATFORM_ADMIN (devenu DRIFT-2).',
    'C-15 : routes « Personnes » insérées sous webhooks: par erreur en WP06, révélé par le balayage d’isolation de WP10 (RISK-2 de la revue), corrigé.',
]:
    para('list', s)
para('para', 'Écarts du plan relevés par l’analyse et la revue : la migration 0006 et POST /platform-admins ne figuraient '
     'pas au plan (3 migrations prévues, 4 livrées) ; les enregistrements d’actions passent par un module dynamique '
     'registerApprovalActions, Nest n’ayant pas de multi-fournisseur (C-08) ; deux exceptions à « aucune requête hors '
     'TenantTx.run » (identify et withoutTenant, C-09). Défaut corrigé avant la revue (RISK-1) : deux migrations nommaient '
     'le rôle cashless_app, créé seulement après elles ; la CI sur cluster neuf a échoué (run 37928683650), correctif '
     '16803915, grants déplacés dans post-roles.sql.')
para('h2', '7.3 Relecture')
para('para', 'Les 10 lots ont été relus en un seul cycle chacun, par le même agent que l’implémenteur (RISK-6). La revue '
     'post-fusion et la CI GitHub servent de second regard. Fichiers à faire relire par une personne (règle 4) : '
     'migrations 0003 à 0006 et post-roles.sql (droits de la base, RLS), packages/ledger-sql/src/bootstrap-admin.ts, '
     'apps/api/src/identity/oidc-verifier.ts, authentication.guard.ts et identity-tenant-context.ts '
     '(authentification), apps/api/src/approval/onsite/ (jeton sur place, act-hash.ts), approval.service.ts '
     '(exécution unique de l’action approuvée) et audit.service.ts.')

# --- 8. Plan de travail ------------------------------------------------------------------------
para('h1', '8. Plan de travail')
para('para', '10 lots de travail, 47 sous-tâches (T001 à T047), 10 lanes (une par lot). Chaque lot a connu un seul cycle de '
     'relecture. WP06, WP08 et WP09 sont chaînés volontairement : chacun ajoute son module au module racine.')
table(['Lot', 'Objet', 'Sous-tâches', 'Dépend de', 'État'], [
    ['WP01', 'Schéma d’identité (0003)', '4', 'Aucun', 'Approuvé'],
    ['WP02', 'Journal d’audit chaîné et scellé (0004)', '5', 'WP01', 'Approuvé'],
    ['WP03', 'Approbations en base, post-roles.sql, amorçage (0005)', '4', 'WP02', 'Approuvé'],
    ['WP04', 'Authentification OIDC et contexte de prestataire', '6', 'WP01', 'Approuvé'],
    ['WP05', 'Rôles, portées et service d’audit', '5', 'WP02, WP04', 'Approuvé'],
    ['WP06', 'Gestion des personnes et des rôles (7 routes)', '5', 'WP03, WP05', 'Approuvé'],
    ['WP07', 'Extensions de l’idempotence (problème validé, garde RISK-2)', '4', 'Aucun', 'Approuvé'],
    ['WP08', 'Demandes d’approbation au back-office', '6', 'WP06, WP07', 'Approuvé'],
    ['WP09', 'Jeton d’approbation sur place', '4', 'WP08', 'Approuvé'],
    ['WP10', 'Preuves de bout en bout et non-régression', '4', 'WP09', 'Approuvé'],
])

# --- 9. Avancement -----------------------------------------------------------------------------
para('h1', '9. Avancement et prochaines étapes')
table(['Étape', 'État', 'Remarque'], [
    ['Spécification', 'Faite', '08/10/2026 : 19 FR, 7 NFR, 8 contraintes, 5 critères de succès ; décisions du porteur (intégrité du journal d’audit)'],
    ['Plan', 'Fait', '08/10/2026 ; addendum documentaire post-plan consigné dans docs/06-docs-status.md'],
    ['Lots et analyse', 'Faits', '10 lots, 47 sous-tâches ; analyse : verdict ready, 7 constats (4 MEDIUM, 3 LOW)'],
    ['Implémentation et relecture', 'Faites', '10 lots approuvés, un cycle chacun, le 09/10/2026'],
    ['Addendum documentaire post-relecture', 'Fait', '09/10/2026 ; écarts plan et implémentation signalés'],
    ['Matrice d’acceptation', 'Faite', '19 critères (FR-001 à FR-019) conformes ; aucun critère NFR ni SC dans la matrice'],
    ['Accept et fusion', 'Faits', '09/10/2026 (211b7f8b ; squash c2f3934b sur feat/identite-roles)'],
    ['PR vers main', 'Fusionnée', 'PR #1 le 09/10/2026 (89c877b0), CI verte après le correctif 16803915'],
    ['Revue post-fusion', 'Faite', '09/10/2026 : PASS WITH NOTES (306a3739) ; 7 points ouverts non bloquants'],
    ['Rétrospective', 'Capturée', 'fa0a8b65 ; 10 lots sans rejet'],
])
para('para', 'Prochaines étapes : relecture humaine des fichiers listés en 7.3 avant le pilote ; décisions restantes '
     'sur DRIFT-1 (@Roles sur les routes Personnes ou test d’architecture), DRIFT-2 (routes de gestion des '
     'administrateurs de la plateforme), RISK-4 (borner la liste des demandes avant de brancher des actions métier) et '
     'RISK-5 (auto-désactivation) ; mesure de NFR-005 avec le test de charge ; scellement planifié et copie externe '
     'avec la mission 9 ; levée d’OP-N56 avec la mission 11.')

d.save(OUT)
print('ok', OUT)
