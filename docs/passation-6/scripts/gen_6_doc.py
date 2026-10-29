"""Génère docs/Mission-06-Recharges-caisses-PSP.docx sur le gabarit du document de la 5a (comme la 5b)."""
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
REVIEW = sys.argv[4] if len(sys.argv) > 4 else 'en cours'


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
para('cover_main', 'Mission 6 : Recharges, caisses et PSP')
para('cover_sub', 'Contenu détaillé de la mission : besoin, décisions, architecture, plan de travail, avancement')
table(['Élément', 'Valeur'], [
    ['Identifiant Spec Kitty', 'recharges-caisses-psp-01M5YEBA'],
    ['Branche de travail', 'feat/recharges-caisses-psp (lanes kitty/mission-recharges-caisses-psp-01M5YEBA-lane-a à m)'],
    ['Type de mission', 'software-dev'],
    ['Dépend de', 'Missions 1 (grand livre), 2 (identité, rôles), 3 (configuration), 4 (bracelets NFC), '
     '5a (identité des terminaux), 5b (encaissement en ligne)'],
    ['État au 29 octobre 2026', 'Acceptée (d62258a2) et mergée sur feat/recharges-caisses-psp (squash a865462c) ; '
     'dans main par la PR #8 le 29/10/2026 (9502ce6d) ; revue post-fusion : ' + REVIEW],
], widths_from=EX['cover_tbl'])
add(copy.deepcopy(EX['spacer']))
add(copy.deepcopy(EX['blank']))
para('toc_title', 'Sommaire')
toc()

# --- 1. Résumé ---------------------------------------------------------------------------------
para('h1', '1. Résumé')
para('para', 'La mission 6 fait entrer l’argent réel dans la plateforme. Au guichet, un agent ouvre une session de '
     'caisse sur un terminal TOPUP_DESK, recharge les bracelets en espèces, compte sa caisse à l’aveugle ; une autre '
     'personne ferme la session, l’écart va au payeur du contrat et ouvre une anomalie CASH_DIFF. Les espèces '
     'partent en banque par un dépôt approuvé à deux. En ligne, le festivalier ou le guichet demande une recharge '
     'par mobile money ou par carte : rien n’est crédité avant une notification authentifiée du PSP, traitée une '
     'seule fois ; un processus psp-poller interroge les recharges en suspens, reprend les notifications et purge '
     'les corps bruts. Les contestations carte sont écrites, plafonnées, et bloquent le portefeuille au besoin.')
para('para', 'Les adaptateurs PSP réels (Wave, Orange Money, PayDunya, Stripe) et le coffre des secrets AWS sont '
     'reportés à la mission 6b (décision du porteur du 27/10/2026, OP-N81) : la mission livre l’interface commune, '
     'un faux par fournisseur et un faux coffre, refusés au démarrage en production. Les recharges en ligne restent '
     'donc bloquées en production jusqu’à la 6b. La mission lève OP-N49 (caution et espèces dues sans session) et '
     'OP-N84.')
para('para', 'État au 29 octobre 2026 : les 14 lots sont approuvés par des relecteurs distincts (WP14 en deux cycles), '
     'la mission est acceptée et mergée sur feat/recharges-caisses-psp. Batterie sur la tête testée, identique au '
     'code fusionné : Jest 2637 tests verts, 0 échec ; pgTAP 43 fichiers, 3826 tests verts. Latences mesurées : '
     'accusé de notification p95 82 ms (seuil 500 ms), recharge espèces p95 73 ms (seuil 200 ms). La PR #8 est '
     'fusionnée dans main le 29/10/2026, CI verte (NFR-010).')
para('h2', 'Ce que la mission doit prouver')
for m in re.finditer(r'^- \*\*(SC-\d{3})\*\* : (.+)$', SPEC, re.M):
    para('list', f'{m.group(2).strip().replace("`", "")} ({m.group(1)}).')

# --- 2. Contexte et sources --------------------------------------------------------------------
para('h1', '2. Contexte et sources')
para('para', 'Depuis la mission 5b, un terminal encaisse en ligne par bracelet et par QR, mais aucun argent n’entre '
     'encore : pas de caisse, pas de recharge espèces rattachée à une session, pas de PSP. La caution et le rendu '
     'des espèces dues se faisaient sans session de caisse (OP-N49).')
para('para', 'Sources normatives, par ordre de priorité en cas de contradiction (SPECIFICATION §0.3) :')
for s in [
    'les tests exécutables : suites pgTAP (dont la suite de référence générée) et tests de l’API ;',
    'le schéma SQL de référence, le contrat openapi.yaml et sync_protocol.md ;',
    'docs/SPECIFICATION.md (§5.3, §8.5, §11.1, §11.2, §14.2 S14, S20, S26, S26b) et les ADR citées (ADR-63, '
    'ADR-70, ADR-72, ADR-77) ;',
    'PRD.md.',
]:
    para('list', s)
para('para', 'Artefacts de la mission : kitty-specs/recharges-caisses-psp-01M5YEBA/ (spec.md, plan.md, research.md '
     'dont R-20 fait foi, data-model.md, contracts/, tasks/WP01 à WP14, acceptance-matrix.json).')

# --- 3. Périmètre ------------------------------------------------------------------------------
para('h1', '3. Périmètre')
para('h2', 'Inclus')
for s in [
    'Sessions de caisse : ouverture au terminal, comptage à l’aveugle, fermeture par une autre personne (CASH_CLOSE, '
    'écart au payeur du contrat, CASH_DIFF), dépôt en banque à deux (CASH_DEPOSIT) ; garde en base : aucune espèce '
    'sans session ouverte.',
    'Recharge en espèces en ligne (TOPUP_CASH) rattachée à la session ; refus au-delà du plafond ; découpage vers '
    'L-ESP-A-RENDRE réservé au hors ligne ; caution due prise ensuite, sur le solde.',
    'Configurations PSP par organisateur et par moyen, activation à deux, au plus une par défaut ; choix par '
    'événement ; frais PSP par configuration ; secrets lus dans un coffre rattaché au détenteur des fonds.',
    'Recharge PSP : demande en trois temps (appel au PSP hors transaction), consultation, annulation confirmée ; '
    'notifications signées (temps constant, ±300 s, 64 Kio), conservées brutes puis traitées une fois ; anomalies '
    'PSP_MISMATCH, PSP_TOPUP_NOT_CREDITED, PSP_TOPUP_OVER_LIMIT.',
    'Processus psp-poller : interrogation et expiration, reprise des événements, purge des corps bruts.',
    'Carte : 3-D Secure obligatoire, plafond par carte et par jour, vélocité (CARD_VELOCITY), contestations '
    '(CHARGEBACK plafonné, blocage, contestation tardive et déblocage à deux).',
    'Contrat d’API : 23 opérations servies, dont 12 ajoutées ; types TypeScript et Dart régénérés.',
]:
    para('list', s)
para('h2', 'Hors périmètre (missions suivantes)')
table(['Sujet', 'Mission prévue'], [
    ['Adaptateurs PSP réels et coffre des secrets AWS (OP-N81)', 'Mission 6b'],
    ['Session d’une recharge espèces hors ligne ; content_sha256 et tap_id', 'Mission 7'],
    ['Rapprochement des relevés, PSP_SETTLEMENT, versements ; contrôle « aucune session ouverte » avant RECONCILING', 'Mission 9'],
    ['Identification au guichet', 'Mission 10'],
    ['Purge et dimensionnement, secrets par processus', 'Mission 13'],
    ['Caution payée par mobile money ou carte', 'Hors V1'],
])

# --- 4. Décisions de cadrage -------------------------------------------------------------------
para('h1', '4. Décisions de cadrage')
para('para', 'Décisions prises avec le porteur du projet du 27 au 29 octobre 2026 (spécification, plan, tâches, '
     'implémentation, fusion).')
table(['Sujet', 'Décision', 'Date'], [
    ['Adaptateurs PSP réels et coffre AWS', 'Reportés à la mission 6b ; faux refusés en production (OP-N81, ADR-131)', '27/10/2026'],
    ['Remboursement d’un paiement non crédité', 'Fait hors plateforme, depuis le tableau de bord du PSP (OP-N82)', '27/10/2026'],
    ['Contrôle des caisses (ADR-132)', 'Comptage à l’aveugle, fermeur distinct du compteur, garde de caisse en base', '27/10/2026'],
    ['Frais et anomalies (ADR-133)', 'Frais PSP par configuration ; PSP_TOPUP_NOT_CREDITED ; actions WALLET_UNBLOCK et '
     'CASH_DEPOSIT ; comptes A-PSP-* négatifs admis', '27/10/2026'],
    ['Comptes A-PSP-*', 'Créés par open_psp_accounts (SECURITY DEFINER, comptes PSP seulement) ; open_event_ledger inchangée', '27/10/2026'],
    ['Garde RISK-2', 'Routes initiate et cancel revues sous IdempotentTx ; garde intact, sans exception', '29/10/2026'],
    ['Blocage d’un portefeuille (ADR-134)', 'Le déblocage par contestation ne lève jamais un blocage d’une autre cause '
     '(0039, 0042 ; OP-N83)', '29/10/2026'],
    ['Contestation tardive', 'Demandée par ORGANIZER_ADMIN ou OPERATOR_ADMIN, approuvée par une autre personne', '29/10/2026'],
    ['Interblocage fermeture et recharges', 'Corrigé avant la fusion (0040, ordre terminal, session, solde)', '29/10/2026'],
    ['Caution sur le solde (ADR-135)', 'take_deposit_from_balance et refund_deposit_from_balance ; anciennes fonctions '
     'retirées à cashless_app (OP-N84 levé)', '29/10/2026'],
    ['Succès notifié après annulation', 'Crédité s’il est recevable, mêmes contrôles qu’un succès ordinaire (R-20)', '29/10/2026'],
    ['Fusion', 'Attestation d’approbation pour WP01 à WP11 ; nouvelle relecture de WP14 pour un commit de texte', '29/10/2026'],
])

# --- 5. Exigences ------------------------------------------------------------------------------
para('h1', '5. Exigences')
fr = spec_rows('FR', [0, 1])
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
    ['packages/ledger-sql', 'Migrations 0036 (sessions de caisse, garde de caisse), 0037 (configurations PSP, '
     'open_psp_accounts), 0038 (recharges PSP, notifications, contestations), 0039 et 0042 (causes de blocage), '
     '0040 (ordre des verrous de fermeture), 0041 (caution sur le solde) ; droits (post-roles.sql)'],
    ['apps/api : caisses', 'cash-sessions/ (ouverture, comptage, fermeture, dépôt), topups/cash/ (recharge espèces, '
     'caution due), guichet des bracelets'],
    ['apps/api : PSP', 'psp/ (ports, faux, signature, coffre), psp-configurations/, topups/psp/ (demande, traitement), '
     'webhooks/ (réception), chargebacks/ (contestations, déblocage)'],
    ['Processus psp-poller', 'Trois travailleurs : interrogation et expiration, reprise des événements, purge'],
    ['packages/contracts', 'openapi.yaml complété, types TypeScript et Dart régénérés (WP01)'],
])
para('h2', '6.2 Chaîne d’une recharge PSP')
for s in [
    'Demande : clé réservée et recharge PENDING (transaction 1), appel au PSP hors transaction, référence du PSP '
    'enregistrée (transaction 3) ; la réponse est rejouable sous IdempotentTx.',
    'Notification : taille, configuration ACTIVE, signature à temps constant, horodatage ; corps brut conservé, '
    '200 renvoyé ; un refus n’écrit rien au grand livre ni au registre brut.',
    'Traitement sous verrou : montant, devise et configuration comparés ; contrôles de plafond, 3-D Secure, carte ; '
    'une seule écriture TOPUP par paiement, frais au payeur configuré ; caution due prise ensuite, à part.',
    'Une notification perdue est rattrapée par l’interrogation du psp-poller (même clé d’écriture).',
]:
    para('list', s)
para('h2', '6.3 Caisse')
for s in [
    'Aucune écriture d’espèces sans session ouverte sur le terminal (garde en base).',
    'Comptage à l’aveugle ; la personne qui ferme n’a pas compté ; le théorique n’est jamais montré à l’agent.',
    'Fermeture : verrous dans l’ordre terminal, session, solde ; CASH_CLOSE égal au théorique, écart au payeur du '
    'contrat et anomalie CASH_DIFF.',
]:
    para('list', s)

# --- 7. Points d’attention ---------------------------------------------------------------------
para('h1', '7. Points d’attention et contradictions')
para('h2', '7.1 Dettes de sécurité acceptées')
para('para', 'Chaque écart accepté est consigné dans docs/POINTS_OUVERTS.md et docs/DECISIONS_ADR.md, avec son '
     'risque, la mission qui le lève et un test qui échoue si la limite s’élargit.')
table(['Point', 'Dette', 'Levée'], [
    ['OP-N81 (ADR-131)', 'PSP et coffre des secrets en faux ; démarrage refusé en production, recharges en ligne bloquées', 'Mission 6b'],
    ['OP-N82 (ADR-133)', 'Paiement non crédité remboursé au payeur hors plateforme', 'Mission 6b ou suivante'],
    ['OP-N83 (ADR-134)', 'Corrigé par 0042 ; limite : la base ne peut empêcher cashless_app d’écrire ACTIVE', 'Mission 13'],
    ['OP-N84 (ADR-135)', 'Levé le 29/10/2026 (0041)', '—'],
    ['OP-N85', 'Caution due non prise si le processus s’arrête entre le COMMIT et sa prise ; reprise au crédit suivant', 'Mission 13'],
    ['OP-N86 (ADR-136)', 'cashless_app appelle psp_poll_candidates et psp_events_to_retry (tous prestataires) ; psp-poller '
     'sans rôle dédié ; INSERT direct sur anomaly', 'Mission 13'],
    ['OP-N87 (ADR-136)', 'Garde de caisse sûre seulement si le propriétaire de posting_cash_desk_guard contourne la RLS', 'Mission 13'],
])
para('h2', '7.2 Contradictions de sources signalées')
for s in [
    'CL039 sort en 422, contracts/psp.md voulait 409 (ADR-135).',
    'WALLET_BLOCKED reste 422, écart avec contracts/psp.md.',
    'Succès après annulation : contracts/psp.md et openapi.yaml disaient « non crédité » ; R-20 et la décision du '
    'porteur font foi (textes alignés le 29/10/2026).',
    '12 opérations ajoutées au contrat au lieu de 8 (demandes à deux de dépôt, déblocage, contestation tardive, '
    'changement de configuration PSP).',
]:
    para('list', s)
para('h2', '7.3 Relecture')
para('para', 'Chaque lot est relu par un agent distinct de celui qui l’a écrit, dans une session séparée ; les tests '
     'sont rejoués en série par l’agent principal sur la base partagée. Fichiers à faire relire par une personne '
     '(règle 4) : migrations 0036 à 0042, post-roles.sql, apps/api/src/webhooks/, psp/hmac-signature.ts et '
     'psp/secret.ts, db/psp-poller-db.module.ts, topups/psp/ (psp-payment-processor.ts, card-checks.ts, '
     'psp-topup-caller.guard.ts, psp-topup-lookup.ts, psp-refusals.ts), topups/cash/cash-topup.service.ts, '
     'media/lifecycle/counter-access.ts, chargebacks/, ledger/ledger-engine.service.ts et ledger/db/ledger-queries.ts.')

# --- 8. Plan de travail ------------------------------------------------------------------------
para('h1', '8. Plan de travail')
para('para', '14 lots de travail, 74 sous-tâches (T001 à T074), 13 lanes.')
table(['Lot', 'Objet', 'Sous-tâches', 'Dépend de', 'État'], [
    ['WP01', 'Contrat d’API et types', '4', '—', 'Approuvé (cycle 2)'],
    ['WP02', 'Base : sessions de caisse et gardes (0036)', '6', '—', 'Approuvé'],
    ['WP03', 'Base : configurations PSP (0037)', '6', '—', 'Approuvé'],
    ['WP04', 'Base : recharges PSP, notifications, contestations (0038)', '6', 'WP03', 'Approuvé (cycle 2)'],
    ['WP05', 'Droits de la base', '4', 'WP02 à WP04', 'Approuvé'],
    ['WP06', 'Moteur : découpage hors ligne, fermeture à théorique nul', '4', 'WP02', 'Approuvé'],
    ['WP07', 'Ports PSP, faux et garde de production', '6', 'WP01', 'Approuvé'],
    ['WP08', 'Sessions de caisse (API) et dépôt en banque', '6', 'WP01, WP05 à WP07', 'Approuvé'],
    ['WP09', 'Recharge espèces et guichet des bracelets', '6', 'WP08', 'Approuvé'],
    ['WP10', 'Configurations PSP (API)', '5', 'WP01, WP05, WP07', 'Approuvé'],
    ['WP11', 'Recharges PSP : demande et traitement', '6', 'WP07, WP09, WP10', 'Approuvé'],
    ['WP12', 'Notifications et travailleur psp-poller', '5', 'WP11', 'Approuvé'],
    ['WP13', 'Contestations et déblocage', '4', 'WP12', 'Approuvé'],
    ['WP14', 'Preuves de bout en bout, CI, consignation', '6', 'WP08 à WP13', 'Approuvé (cycle 2, puis relu pour 8250e55)'],
])

# --- 9. Avancement -----------------------------------------------------------------------------
para('h1', '9. Avancement et prochaines étapes')
table(['Étape', 'État', 'Remarque'], [
    ['Spécification', 'Faite', '27/10/2026 : 31 FR, 10 NFR, 10 C ; décisions du porteur (report de la 6b)'],
    ['Plan', 'Fait', '27/10/2026 ; passe contradictoire (34 constats dont 4 bloquants, 31 corrigés, 3 reportés)'],
    ['Lots et analyse', 'Faits', '14 lots, 74 sous-tâches, 13 lanes'],
    ['Implémentation et relecture', 'Faites', '14 lots approuvés du 27 au 29/10/2026 (cycles 2 pour WP01, WP04, WP14)'],
    ['Addendum documentaire post-relecture', 'Fait', '29/10/2026 ; diagrammes recalés'],
    ['Matrice d’acceptation', 'Faite', '49 critères (FR, NFR, SC), 5 invariants négatifs'],
    ['Accept et fusion', 'Faits', '29/10/2026 (d62258a2, squash a865462c sur feat)'],
    ['PR vers main', 'Fusionnée', 'PR #8 le 29/10/2026 (9502ce6d), CI verte (NFR-010)'],
    ['Revue post-fusion', 'Faite' if REVIEW != 'en cours' else 'En cours', REVIEW],
])
para('para', 'Prochaines étapes : relecture humaine des fichiers listés en 7.3 ; '
     'mission 6b pour les adaptateurs réels et le coffre ; reports aux missions 7, 9 et 13 (OP-N85 à OP-N88). '
     'Reprise : docs/passation-6/REPRISE.md.')

d.save(OUT)
print('ok', OUT)
