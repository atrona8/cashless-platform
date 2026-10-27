"""Génère docs/Mission-05b-Encaissement-en-ligne.docx sur le gabarit du document de la 5a."""
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


# --- Page de garde ---------------------------------------------------------------------------
para('cover_title', 'Cashless Platform')
para('cover_main', 'Mission 5b : Encaissement en ligne')
para('cover_sub', 'Contenu détaillé de la mission : besoin, décisions, architecture, plan de travail, avancement')
table(['Élément', 'Valeur'], [
    ['Identifiant Spec Kitty', 'terminaux-paiement-en-ligne-01M52QB9'],
    ['Branche de travail', 'feat/terminaux-paiement-en-ligne (lanes kitty/mission-terminaux-paiement-en-ligne-01M52QB9-lane-*)'],
    ['Type de mission', 'software-dev'],
    ['Dépend de', 'Missions 1 (grand livre), 2 (identité, rôles), 3 (configuration), 4 (bracelets NFC), 5a (identité des terminaux)'],
    ['État au 27 octobre 2026', 'Acceptée et mergée le 26/10/2026 sur feat/terminaux-paiement-en-ligne (squash 870bd3f4) ; '
     'revue post-fusion faite (publiable avec réserves) ; PR vers main à venir'],
], widths_from=EX['cover_tbl'])
add(copy.deepcopy(EX['spacer']))
add(copy.deepcopy(EX['blank']))
para('toc_title', 'Sommaire')
toc()

# --- 1. Résumé ---------------------------------------------------------------------------------
para('h1', '1. Résumé')
para('para', 'La mission 5b livre l’encaissement en ligne sur les terminaux enrôlés par la 5a. Un vendeur ouvre une '
     'session sur un terminal avec son code PIN de 6 chiffres, vérifié par le serveur ; chaque vente lui est '
     'attribuée par le serveur. Le terminal encaisse par bracelet en un seul aller-retour (lecture, écriture de la '
     'vente et consommation du passage dans la même transaction), ou en deux temps, au catalogue du point de vente '
     'ou au montant saisi. Une vente s’annule par le vendeur qui l’a faite, depuis le terminal d’origine, dans la '
     'fenêtre de l’événement ; au-delà, par un superviseur. Le paiement par QR (commerçant et client) est toujours '
     'en ligne.')
para('para', 'Elle lève aussi OP-N74, hérité de la 5a : un code d’enrôlement et un enrôlement relisent désormais '
     'l’état de l’événement et du point de vente. L’identification au guichet, d’abord prévue ici, part à la '
     'mission 10 (décision du porteur au plan). Le hors ligne, l’application du festivalier, l’application du '
     'terminal et les écrans du back-office viennent dans d’autres missions.')
para('para', 'État au 27 octobre 2026 : les 14 lots sont approuvés, la mission est acceptée et mergée sur '
     'feat/terminaux-paiement-en-ligne (26/10/2026). Rejeu sur la branche : pgTAP 39 fichiers, 2931 tests verts ; '
     'Jest 139 suites vertes hors instabilités connues du poste. Latence mesurée du paiement par bracelet : '
     'p95 ≈ 68 ms, p99 ≈ 84 ms. La revue post-fusion conclut « publiable avec réserves » (mineurs de test et de '
     'consignation, aucun bloquant). Reste la PR vers main, dont la CI confirme NFR-010.')
para('h2', 'Ce que la mission doit prouver')
for s in [
    'Un parcours complet (vendeur, catalogue, session, paiement par bracelet en un et deux temps, QR commerçant et '
    'client, annulation) se déroule par l’API, sans intervention en base (SC-001).',
    'Toutes les ventes sont attribuées au bon vendeur, et les lignes d’une vente au catalogue font son montant (SC-002).',
    'Aucun PIN, empreinte de PIN ni jeton QR en clair dans la base, les journaux ou les réponses (SC-003).',
    'Un vendeur bloqué après 5 échecs ne rouvre de session sur aucun terminal avant déblocage (SC-004).',
    'Aucune lecture, aucun jeton QR ni aucune vente ne sert deux fois, même sous envois simultanés (SC-005).',
    'Paiement par bracelet accepté en 200 ms au plus pour 95 % des paiements, côté serveur (SC-006).',
    'Aucune fuite entre prestataires ou commerçants (SC-007) ; OP-N74 clos avec son test (SC-008).',
]:
    para('list', s)

# --- 2. Contexte et sources --------------------------------------------------------------------
para('h1', '2. Contexte et sources')
para('para', 'Depuis la mission 5a, un terminal est enrôlé, reconnu à chaque requête par trois preuves (certificat '
     'client, jeton d’appareil, signature de la requête) et reçoit sa configuration. Il n’encaisse encore rien.')
para('para', 'Sources normatives, par ordre de priorité en cas de contradiction (SPECIFICATION §0.3) :')
for s in [
    'les tests exécutables : suites pgTAP (dont la suite de référence générée) et tests de l’API ;',
    'le schéma SQL de référence (register_tap, consume_tap, post_transaction, payment_request), le contrat '
    'openapi.yaml (tags « Paiements », « App client ») et sync_protocol.md ;',
    'docs/SPECIFICATION.md (§3.2, §6.3, §7.6, §8.1 à §8.3, §9.8, §10.2, §14.2 S2, S18) et les ADR citées ;',
    'PRD.md.',
]:
    para('list', s)
para('para', 'Artefacts de la mission : kitty-specs/terminaux-paiement-en-ligne-01M52QB9/ (spec.md, plan.md, '
     'research.md, data-model.md, contracts/, tasks/WP01 à WP14, acceptance-matrix.json).')

# --- 3. Périmètre ------------------------------------------------------------------------------
para('h1', '3. Périmètre')
para('h2', 'Inclus')
for s in [
    'Vendeurs d’un commerçant, PIN de 6 chiffres (empreinte argon2id avec un secret hors base, VENDOR_PIN_SECRET), '
    'blocage au 5e échec tous terminaux confondus, déblocage par le commerçant.',
    'Session de vendeur liée au terminal (12 h au plus, une par terminal), fermée à la déconnexion, à l’expiration, '
    'à la suspension ou révocation du terminal et à la désactivation du vendeur.',
    'Catalogue versionné par point de vente (catégories, articles TTC, taux par article, libellés FR/EN), servi '
    'dans la configuration du terminal ; lignes de vente copiées dans la transaction.',
    'Paiement par bracelet en un aller-retour ou en deux temps (tap_id), montant saisi en mode KEYPAD_TPE, refus '
    'sans écriture (solde, bracelet ou portefeuille bloqué, événement en clôture).',
    'Annulation par contre-passation totale, unique (garantie par la base), par le vendeur dans la fenêtre ou par '
    'un superviseur (back-office à deux personnes, ou jeton d’approbation sur place).',
    'QR commerçant (demande de paiement, jeton 128 bits haché, 60 s) et QR client (12 caractères, 60 s).',
    'OP-N74 : enrôlement et création de code refusés pour un événement clos ou un point de vente supprimé, et dès '
    'CLOSING pour les caisses.',
    'Contrat d’API complété et types TypeScript et Dart régénérés.',
]:
    para('list', s)
para('h2', 'Hors périmètre (missions suivantes)')
table(['Sujet', 'Mission prévue'], [
    ['Identification au guichet (kyc_verification), révocation à deux, niveaux appliqués (FR-021 à FR-023)', 'Mission 10'],
    ['Hors ligne : snapshot, lots, ventes et vérification du PIN sans réseau', 'Mission 7'],
    ['Application du festivalier, confirmation par PIN ou biométrie', 'Mission 10'],
    ['Écrans du back-office', 'Mission 11'],
    ['Application du terminal', 'Mission 12'],
    ['Intentions de paiement des caisses tierces, mode PAIRED_TPE', 'V2 (ADR-43)'],
])

# --- 4. Décisions de cadrage -------------------------------------------------------------------
para('h1', '4. Décisions de cadrage')
para('para', 'Décisions prises avec le porteur du projet du 16 au 23 octobre 2026 (spécification, plan, '
     'implémentation).')
table(['Sujet', 'Décision', 'Date'], [
    ['Taille de la mission 5', 'Scindée en 5a (identité des terminaux) puis 5b (encaissement)', '16/10/2026'],
    ['Périmètre de la 5b', 'Tout le périmètre du PRD ; l’identification au guichet part ensuite à la mission 10', '22/10/2026'],
    ['Vérification du PIN', 'Par le serveur ; session de vendeur liée au terminal ; attribution par le serveur', '22/10/2026'],
    ['Qui annule dans la fenêtre', 'Seul le vendeur de la vente, depuis le terminal d’origine ; sinon un SUPERVISOR', '22/10/2026'],
    ['Prix des lignes', 'Prix de la version de catalogue servie au terminal ou prix actuel ; sinon refus', '22/10/2026'],
    ['OP-N74', 'Dès CLOSING pour CATALOG_POS et KEYPAD_TPE ; TOPUP_DESK jusqu’à CLOSED ; CLOSED refuse tout', '22/10/2026'],
    ['Règles du PIN', '6 chiffres ; 5 échecs par vendeur bloquent jusqu’au déblocage ; session de 12 h au plus', '22/10/2026'],
    ['Pile', 'Document 08 : Node 22, argon2 0.44.0 ; secret hors base pour le PIN', '22/10/2026'],
    ['Codes de refus (ADR-123)', 'Annulation refusée : 422 REVERSAL_NOT_ALLOWED ; fenêtre dépassée : 409 '
     'REVERSAL_WINDOW_EXPIRED, après les contrôles du vendeur ; QR client refusé : 422 QR_TOKEN_INVALID', '23/10/2026'],
    ['Dépendance @epic-web/invariant', 'Acceptée (transitive de cross-env, sans script, signature vérifiée ; R-01)', '23/10/2026'],
    ['Idempotence (ADR-124)', 'Les refus DEBIT_AUTHORITY_* relâchent la clé sur toutes les routes ; SPECIFICATION §10.2 mise à jour', '23/10/2026'],
    ['Secrets par processus (ADR-125)', 'Exposition actuelle acceptée ; lecture par processus à la mission 13 (OP-N77)', '23/10/2026'],
    ['Idempotence du PIN (ADR-126)', 'Le PIN n’entre dans l’empreinte que sous un dérivé argon2 ; secret distinct VENDOR_PIN_IDEMPOTENCY_SECRET', '26/10/2026'],
    ['Reports de WP07 (ADR-127)', 'Purge de vendor_pin_check à la mission 13 (OP-N78) ; vendor_id hors de la clé de session (OP-N79)', '26/10/2026'],
    ['Paiement en ligne (ADR-128)', 'Solde rendu, époque dans le refus, empreinte du contenu', '26/10/2026'],
    ['Annulation au back-office (ADR-129)', 'reversePayment d’une personne crée une demande SALE_REVERSAL (202), exécutée par une seconde personne', '26/10/2026'],
    ['Verrou d’essai de PIN (ADR-130)', 'Pool du verrou non dimensionné, accepté (OP-N80, mission 13)', '26/10/2026'],
    ['Identification au guichet', 'FR-021 à FR-023 retirés de la matrice, reportés à la mission 10 ; NFR-010 sur preuve locale', '26/10/2026'],
])

# --- 5. Exigences ------------------------------------------------------------------------------
para('h1', '5. Exigences')
para('h2', '5.1 Exigences fonctionnelles (27)')
table(['ID', 'Exigence'], [
    ['FR-001', 'Vendeurs d’un commerçant : créer, lister, consulter, désactiver, réactiver'],
    ['FR-002', 'Code PIN de 6 chiffres, empreinte argon2id seulement, changement par le commerçant'],
    ['FR-003', 'Session de vendeur ouverte par PIN, liée au terminal, 12 h au plus'],
    ['FR-004', 'Blocage après 5 PIN faux, tous terminaux, jusqu’au déblocage'],
    ['FR-005', 'Fin de session : déconnexion, 12 h, terminal suspendu ou révoqué, vendeur désactivé'],
    ['FR-006', 'Vente et annulation attribuées par le serveur, jamais par un champ du terminal'],
    ['FR-007', 'Catalogue d’un point de vente (catégories, articles TTC, taux, libellés FR/EN)'],
    ['FR-008', 'Catalogue servi au terminal CATALOG_POS ; nouvelle configuration à chaque modification'],
    ['FR-009', 'Paiement par bracelet en un aller-retour, tout ou rien'],
    ['FR-010', 'Paiement en deux temps par tap_id ; passage consommé ou trop ancien : 409 TAP_UNUSABLE'],
    ['FR-011', 'Lignes de vente copiées dans la transaction de la vente'],
    ['FR-012', 'Prix vérifiés (article, version servie ou actuelle, somme = montant)'],
    ['FR-013', 'Montant saisi en mode KEYPAD_TPE'],
    ['FR-014', 'Refus d’un paiement sans écriture ni passage enregistré'],
    ['FR-015', 'Moyens selon le terminal (iOS et modes sans NFC : pas de bracelet)'],
    ['FR-016', 'Annulation par le vendeur, terminal d’origine, dans la fenêtre ; une seule fois'],
    ['FR-017', 'Annulation par un SUPERVISOR hors fenêtre ou pour un autre vendeur'],
    ['FR-018', 'QR commerçant : demande de paiement à usage unique, 60 s, annulable'],
    ['FR-019', 'QR client présenté au paiement'],
    ['FR-020', 'Jetons QR hachés, à usage unique, refus sans dire pourquoi, en ligne seulement'],
    ['FR-021 à FR-023', 'Identification au guichet : reportées à la mission 10'],
    ['FR-024', 'OP-N74 : enrôlement et état de l’événement'],
    ['FR-025', 'Consultation d’un paiement de son périmètre'],
    ['FR-026', 'Audit de chaque action sur vendeurs, sessions, catalogue, annulations'],
    ['FR-027', 'Contrat et types (fait : WP01)'],
])
para('h2', '5.2 Exigences non fonctionnelles (10)')
table(['ID', 'Sujet', 'Seuil mesurable'], [
    ['NFR-001', 'Latence du paiement', 'p95 ≤ 200 ms, p99 ≤ 500 ms sur 200 paiements en série'],
    ['NFR-002', 'Aucun PIN en clair', '0 PIN ni empreinte dans réponses, journaux, audit, erreurs, configuration'],
    ['NFR-003', 'Blocage du PIN', '20 essais simultanés : au plus 5 comptés, aucun ne passe'],
    ['NFR-004', 'Pas d’énumération des vendeurs', 'Même statut et même corps pour PIN faux, vendeur inconnu ou d’ailleurs'],
    ['NFR-005', 'Un passage, une vente', '20 envois simultanés : exactement 1 vente ou 1 annulation'],
    ['NFR-006', 'Tout ou rien', '0 vente sans lignes, 0 passage consommé par un refus'],
    ['NFR-007', 'Isolation', '0 objet d’un autre prestataire ou commerçant lisible ou modifiable'],
    ['NFR-008', 'Aucun jeton QR en clair', 'Seules les empreintes sont gardées'],
    ['NFR-009', 'Pas de faux en production', 'Démarrage refusé, un test par faux ou secret'],
    ['NFR-010', 'Tests existants verts', 'Suites des missions 1 à 5a et scénario de référence verts en CI'],
])
para('h2', '5.3 Contraintes (11)')
table(['ID', 'Contrainte'], [
    ['C-001', 'Les fonctions de la base font les règles ; l’API les appelle sans les réécrire'],
    ['C-002', 'Fichiers .sql générés du kit intouchables ; migrations et générateurs seulement'],
    ['C-003', 'Trois preuves sur toute route de terminal'],
    ['C-004', 'Contrat d’abord ; types générés'],
    ['C-005', 'Pas de hors ligne (mission 7)'],
    ['C-006', 'Pas d’application ni d’écran'],
    ['C-007', 'Pas d’intention de paiement (V2)'],
    ['C-008', 'Pas d’identification au guichet ; écritures directes retirées à l’API'],
    ['C-009', 'Écart de sécurité soumis au porteur avant d’être codé'],
    ['C-010', 'Dette de sécurité nommée (point ouvert, ADR, test, report)'],
    ['C-011', 'Révocation d’une identification à deux (contrat prime sur §6.3) ; transmis à la mission 10'],
])

# --- 6. Architecture retenue -------------------------------------------------------------------
para('h1', '6. Architecture retenue')
para('h2', '6.1 Composants')
table(['Composant', 'Rôle'], [
    ['packages/ledger-sql', 'Migrations 0031 (vendeurs, sessions, set_device_status), 0032 (catalogue versionné, '
     'lignes de vente), 0033 (paiement, annulation, approbation sur place), 0034 (demandes QR), 0035 (OP-N74) ; '
     'droits de la base (WP07, post-roles.sql)'],
    ['apps/api : socle (WP08)', 'argon2id et VENDOR_PIN_SECRET, contexte du terminal, idempotence <serial>:<seq>, '
     'garde exclusive terminal ou personne, traduction des erreurs de la base'],
    ['apps/api : routes', 'Vendeurs et sessions (WP09), catalogue et configuration servie (WP10), paiement par '
     'bracelet (WP11), annulation (WP12), QR (WP13)'],
    ['packages/contracts', 'openapi.yaml complété, types TypeScript et Dart régénérés (WP01)'],
])
para('h2', '6.2 Chaîne d’un paiement par bracelet')
for s in [
    'Le terminal envoie la lecture du bracelet, le montant et, au catalogue, les lignes, avec ses trois preuves et '
    'la clé <serial>:<seq>.',
    'Une seule transaction SQL : statut du terminal relu, session de vendeur vérifiée, lecture enregistrée '
    '(register_tap), vente écrite par le moteur (PURCHASE, source ONLINE), lignes enregistrées et contrôlées, '
    'passage consommé (consume_tap).',
    'Tout ou rien : un refus n’écrit rien et ne consomme pas le passage ; un passage ne sert qu’une fois.',
    'La vente est attribuée au vendeur de la session ouverte sur ce terminal, jamais d’après un champ envoyé.',
]:
    para('list', s)
para('h2', '6.3 Annulation')
for s in [
    'Le vendeur de la vente, depuis le terminal d’origine, dans la fenêtre reversal_window_minutes de l’événement, '
    'événement en LIVE ou CLOSING.',
    'Au-delà : un SUPERVISOR, par le back-office (demande SALE_REVERSAL approuvée par deux personnes distinctes) ou '
    'sur place par un jeton d’approbation lié à la vente (preuve en base, jeton consommé une fois).',
    'Contre-passation totale liée à la vente ; une seule annulation par vente, garantie par un index unique.',
]:
    para('list', s)

# --- 7. Points d’attention ---------------------------------------------------------------------
para('h1', '7. Points d’attention et contradictions')
para('h2', '7.1 Dettes de sécurité acceptées')
para('para', 'Chaque écart accepté est consigné dans docs/POINTS_OUVERTS.md et docs/DECISIONS_ADR.md, avec son '
     'risque, la mission qui le lève et un test qui échoue si la limite s’élargit.')
table(['Point', 'Dette', 'Levée'], [
    ['OP-N76 (ADR-121)', 'PIN : l’API lit les empreintes et la base ouvre la session sur la foi de l’API', 'Mission 11, avec OP-N56'],
    ['OP-N77 (ADR-125)', 'Secrets de l’API exigés et reçus par tous les processus, y compris ceux qui ne s’en servent pas', 'Mission 13'],
    ['OP-N43 (complété)', 'Côté festivalier du QR derrière un port d’identité : faux en test, refusé en production', 'Mission 10'],
    ['OP-N78 (ADR-127)', 'Registre des essais de PIN sans purge', 'Mission 13'],
    ['OP-N79 (ADR-127)', 'vendor_id hors de la clé composite de vendor_session', 'Mission 11'],
    ['OP-N80 (ADR-130)', 'Verrou d’essai de PIN : pool non dimensionné (500 au lieu de 429 au-delà), sans test de borne', 'Mission 13'],
])
para('h2', '7.2 Contradictions de sources signalées')
for s in [
    'Codes de refus de l’annulation et du QR client : le contrat existant est gardé (ADR-123).',
    'assert_reversible : le prompt donnait 4 paramètres, l’arbitrage exigeait une preuve en base ; deux paramètres '
    'optionnels ajoutés (p_jti, p_approval_request), non contournables par NULL (relecture WP04).',
    'SPECIFICATION §10.2 : refus DEBIT_AUTHORITY_* désormais non enregistrés ; spécification mise à jour (ADR-124).',
]:
    para('list', s)
para('h2', '7.3 Constats reportés aux lots suivants')
table(['Lot', 'Report', 'Origine'], [
    ['WP07', 'Retirer INSERT et UPDATE sur sale_attribution à cashless_app ; vendor_id dans la clé composite ; '
     'tests : session expirée, valideur non SUPERVISOR', 'Relecture WP04'],
    ['WP11', 'Borner <seq> à 2^63−1 (sinon 500 au lieu de 422)', 'Relecture WP08'],
    ['WP12', 'Ne pas renseigner used_at ; target_id = vente annulée ; jeton consommé avant assert_reversible', 'Relecture WP04'],
    ['WP14', 'Test du verrou npm qui échoue sur une entrée nouvelle ; vérifier ADR-124, ADR-125', 'Relecture WP08'],
])
para('h2', '7.4 Relecture')
para('para', 'Chaque lot est relu par un agent distinct de celui qui l’a écrit, dans une session séparée. Les tests '
     'sont rejoués en série par l’agent principal sur la base partagée. Fichiers à faire relire par une personne '
     '(règle 4) : migrations 0031, 0033 (assert_reversible, clé de sale_attribution), 0034 (jetons QR) et 0035, '
     'post-roles.sql (droits de cashless_app), apps/api/src/vendor-pin/, pin-attempt-lock.ts et session-lock.ts, '
     'config.ts, device-or-caller.guard.ts, idempotency.interceptor.ts, qr-token.ts et qr-token-hash.ts, '
     'sale-reversal-action.ts (liste complétée par la revue post-fusion du 27/10/2026).')

# --- 8. Plan de travail ------------------------------------------------------------------------
para('h1', '8. Plan de travail')
para('para', '14 lots de travail. Chaque lot a ses propres fichiers et une lane dédiée.')
table(['Lot', 'Objet', 'Sous-tâches', 'Dépend de', 'État'], [
    ['WP01', 'Contrat d’API et types', '5', '—', 'Approuvé'],
    ['WP02', 'Vendeurs, sessions et set_device_status (0031)', '5', '—', 'Approuvé (cycle 2)'],
    ['WP03', 'Catalogue versionné et lignes de vente (0032)', '5', '—', 'Approuvé (cycle 2)'],
    ['WP04', 'Paiement, annulation, approbation sur place (0033)', '5', 'WP02, WP03', 'Approuvé'],
    ['WP05', 'Demandes de paiement QR (0034)', '4', 'WP04', 'Approuvé (cycle 2)'],
    ['WP06', 'OP-N74 : enrôlement et état de l’événement (0035)', '3', '—', 'Approuvé'],
    ['WP07', 'Droits de la base', '4', 'WP02 à WP06', 'Approuvé'],
    ['WP08', 'Socle : argon2, secret, contexte, idempotence, garde, erreurs', '7', 'WP01', 'Approuvé'],
    ['WP09', 'Vendeurs : back-office et sessions', '5', 'WP07, WP08', 'Approuvé (cycle 3)'],
    ['WP10', 'Catalogue : back-office et configuration servie', '4', 'WP07, WP08', 'Approuvé'],
    ['WP11', 'Paiement par bracelet', '7', 'WP09, WP10', 'Approuvé (cycle 2)'],
    ['WP12', 'Annulation', '6', 'WP11', 'Approuvé'],
    ['WP13', 'Paiement par QR', '5', 'WP11', 'Approuvé'],
    ['WP14', 'Preuves de bout en bout, CI, consignation', '7', 'WP09 à WP13', 'Approuvé'],
])
para('h2', 'Ordre et parallélisme')
for s in [
    'Fait : les 14 lots, dans l’ordre prévu (WP05 puis WP07 ; WP09 et WP10 en parallèle ; WP11 ; WP12 et WP13 en '
    'parallèle ; WP14 ferme la mission).',
]:
    para('list', s)

# --- 9. Avancement -----------------------------------------------------------------------------
para('h1', '9. Avancement et prochaines étapes')
table(['Étape', 'État', 'Remarque'], [
    ['Spécification', 'Faite', '22/10/2026, 7 décisions du porteur'],
    ['Plan', 'Fait', '22/10/2026, 9 décisions, passe contradictoire (27 constats traités), documentation à jour'],
    ['Lots et analyse', 'Faits', '14 lots, matrice d’acceptation (27 FR, 10 NFR, 8 SC) tenue au fil des lots'],
    ['Implémentation et relecture', 'Faites', '14 lots approuvés au 26/10/2026 (cycles 2 et 3 pour WP02, WP03, WP05, WP09, WP11)'],
    ['Addendum documentaire post-relecture', 'Fait', '26/10/2026, réponses confirmées par le porteur'],
    ['Accept et merge', 'Faits', '26/10/2026 (4922ef83, squash 870bd3f4 sur feat)'],
    ['Revue post-fusion', 'Faite', '27/10/2026 : publiable avec réserves (docs/passation-5b/rapports/mission-review-5b.md)'],
    ['PR vers main', 'À faire', 'Avec l’accord du porteur ; la CI confirme NFR-010'],
])
para('para', 'Prochaines étapes : ouvrir la PR vers main (CI = preuve de NFR-010, surveiller les mesures de latence '
     'de config.spec et heartbeat.spec) ; faire relire par une personne les fichiers listés en 7.4 ; traiter à la '
     'mission 7 les mineurs de test de WP14 (canari de payment-secrets, notes et refus admis des tests '
     'd’isolation, commentaire du test de written.replayed). Reprise : docs/passation-5b/REPRISE.md.')

d.save(OUT)
print('ok', OUT)
