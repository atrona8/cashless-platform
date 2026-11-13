"""Génère docs/Ressources-externes-a-fournir.docx sur le gabarit du document de la 5a.

Appel, depuis la racine du dépôt :
  python3 docs/passation-docs/scripts/gen_ressources_doc.py \
    docs/Mission-05a-Identite-enrolement-terminaux.docx \
    docs/Ressources-externes-a-fournir.docx
Le gabarit n'est jamais modifié. Contenu tiré de docs/SERVICES-EXTERNES.md (état au 06/11/2026) : à rejouer quand
une ressource est fournie ou qu'une décision change.
"""
import copy
import re
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


# --- Page de garde ---------------------------------------------------------------------------
para('cover_title', 'Cashless Platform')
para('cover_main', 'Ressources externes à fournir au développement')
para('cover_sub', 'Comptes, accès de test, informations et décisions que l’équipe de développement ne peut pas '
     'produire elle-même')
table(['Élément', 'Valeur'], [
    ['Destinataire', 'Porteur du projet (et, par lui, les fournisseurs et intervenants concernés)'],
    ['Source', 'docs/SERVICES-EXTERNES.md (liste technique des services externes) ; docs/POINTS_OUVERTS.md § 7 '
     '(actions du porteur)'],
    ['État au 6 novembre 2026', 'Aucune ressource externe fournie à ce jour ; tous les services sont simulés par des faux '
     'refusés au démarrage en production'],
    ['Mission qui les consomme', 'Mission 12b (intégrations réelles), plus 10a (codes à usage unique simulés), 12 (app '
     'terminal) et 13 (recette)'],
], widths_from=EX['cover_tbl'])
add(copy.deepcopy(EX['spacer']))
add(copy.deepcopy(EX['blank']))
para('toc_title', 'Sommaire')
toc()

# --- 1. Résumé ---------------------------------------------------------------------------------
para('h1', '1. Résumé')
para('para', 'Le développement avance avec des faux : un faux service de clés, de faux prestataires de paiement, un faux '
     'serveur d’identité, de faux envois de codes. Ces faux suffisent pour écrire et tester le code, mais la configuration de '
     'production refuse de démarrer tant qu’un seul faux est en place. Pour aller en production, l’équipe a besoin de '
     'ressources qu’elle ne peut pas créer elle-même : des comptes ouverts au nom de la bonne entité, des accès de test, des '
     'informations sur le matériel, et quelques décisions.')
para('para', 'Ce document dit, pour chaque ressource, ce qu’il faut fournir exactement, sous quelle forme, à quelle échéance, '
     'et ce que cela débloque. Les délais les plus longs sont côté paiements : le compte marchand Orange Money demande '
     'plusieurs semaines de validation, et le nom d’expéditeur des SMS de 5 à 10 jours. Ce sont les deux démarches à lancer '
     'tout de suite.')
para('para', 'Aucun secret (mot de passe, clé, jeton d’accès) ne doit être envoyé à l’équipe par messagerie, courriel ou '
     'document : la section 2 décrit comment les remettre.')

# --- 2. Remise des accès -------------------------------------------------------------------------
para('h1', '2. Comment remettre les accès')
para('list', 'Les identifiants de production ne passent jamais par l’équipe : le porteur (ou le détenteur des fonds pour '
     'les comptes de paiement) les dépose lui-même dans AWS Secrets Manager, une fois le compte AWS ouvert. L’équipe ne '
     'reçoit que le nom du secret.')
para('list', 'Les accès de test (bacs à sable des fournisseurs) peuvent être partagés avec l’équipe par un gestionnaire de '
     'mots de passe partagé, jamais en clair dans un message, un ticket, un fichier du dépôt ou une conversation avec un agent.')
para('list', 'Les comptes de paiement sont ouverts au nom du détenteur des fonds de l’événement, pas de la plateforme : '
     'leurs identifiants restent rattachés à lui et ne sont jamais partagés entre détenteurs.')
para('list', 'Chaque accès fourni est d’abord essayé contre le bac à sable du fournisseur ; la garde de production n’est '
     'levée que pour un adaptateur essayé, un service à la fois.')

# --- 3. Ressources par domaine ---------------------------------------------------------------------
para('h1', '3. Ressources à fournir, par domaine')
H = ['À fournir', 'Forme attendue', 'Débloque']

para('h2', '3.1 Hébergement (AWS)')
table(H, [
    ['Compte AWS de production', 'Compte ouvert au nom de l’entité exploitante ; accès administrateur remis à une personne '
     'désignée, avec authentification à deux facteurs', 'Base, clés, secrets, journaux : toute la mise en ligne'],
    ['Région d’hébergement confirmée', 'Décision écrite : Paris (eu-west-3) retenue à titre provisoire (OP-N11, ADR-65), à '
     'confirmer après la mesure de latence depuis Dakar et l’avis du juriste', 'Création des clés et de la base dans la bonne région'],
    ['Second compte AWS, distinct', 'Compte réservé au stockage en écriture unique (S3 Object Lock) du scellement du journal',
     'Scellement hors base (SPECIFICATION § 13.7)'],
    ['Disponibilité de PostgreSQL 17 sur RDS', 'Vérification dans la région retenue (l’équipe peut la faire une fois le '
     'compte ouvert)', 'Base de production'],
])

para('h2', '3.2 Paiements')
table(H, [
    ['Compte Wave Business', 'Compte ouvert, accès de test (bac à sable), documentation de l’API, secret de signature des '
     'webhooks de test', 'Recharges Wave'],
    ['Compte marchand Orange Money', 'Idem ; validation de plusieurs semaines : à lancer maintenant', 'Recharges Orange Money'],
    ['Accès de test PayDunya', 'Clés de test, documentation, URL de webhook à déclarer', 'Recharges par carte via agrégateur local'],
    ['Accès de test Stripe', 'Clés de test ; confirmation écrite que Stripe ouvre un compte et verse en XOF à un marchand '
     'établi au Sénégal', 'Recharges par carte internationale'],
    ['Grille tarifaire de chaque PSP', 'Taux et frais fixes contractuels, par moyen de paiement', 'Règles de frais (fee_rule)'],
    ['Agrément BCEAO des acteurs locaux', 'Justificatif pour chaque PSP local activé', 'Activation d’un PSP pour un organisateur'],
])

para('h2', '3.3 Codes à usage unique (connexion des festivaliers)')
table(H, [
    ['Fournisseur de SMS principal local', 'Devis retenu, compte de test, documentation ; couverture Orange, Free et Expresso',
     'Envoi des codes par SMS'],
    ['Nom d’expéditeur SMS validé', 'Dossier déposé avec le RCCM (5 à 10 jours de validation)', 'SMS affichés au nom du service'],
    ['Fournisseur de SMS de repli international', 'Devis retenu, compte de test', 'Repli si le SMS principal échoue (après 20 s)'],
    ['Fournisseur WhatsApp agréé Meta', 'Devis retenu, compte de test, modèle de message validé par Meta',
     'Premier canal d’envoi des codes (repli vers SMS après 10 s)'],
])
para('para', 'En attendant, la mission 10a livre ces routes avec de faux fournisseurs, et le serveur simulé décrit dans '
     'ACCES-API.md répond déjà avec les exemples du contrat.')

para('h2', '3.4 Identité des personnes (back-office, approbations)')
table(H, [
    ['Choix du serveur d’identité OIDC', 'Décision : service géré ou hébergé ; il doit offrir l’authentification renforcée '
     '(seconde personne des approbations)', 'Connexion au back-office, approbations réelles (OP-N56)'],
    ['Accès à ce serveur', 'Émetteur (issuer), adresse des clés publiques (JWKS), audiences ; compte d’administration pour '
     'créer les applications et les rôles', 'Configuration OIDC_ISSUER, OIDC_JWKS_URI, OIDC_AUDIENCE, OIDC_APPROVAL_AUDIENCE'],
])

para('h2', '3.5 Bracelets et terminaux')
table(H, [
    ['Bracelets NFC réels', 'Un lot d’échantillons de la référence commandée, pour une demi-journée de validation de la puce',
     'Code de lecture NFC (action 1)'],
    ['Clé publique NXP et signatures réelles', 'Clé publique d’originalité de la puce et quelques signatures lues sur les '
     'échantillons', 'Vérification des puces authentiques (OP-N46)'],
    ['Surcoût d’un QR différent par bracelet', 'Réponse écrite du fournisseur de bracelets', 'Choix du QR (ADR-36)'],
    ['Téléphones de test', 'Les modèles disponibles chez le porteur et ses premiers clients, pour la campagne de mesure',
     'Liste des téléphones recommandés et tolérés (action 2)'],
    ['Compte développeur Apple', 'Compte ouvert ; identifiant d’équipe (Team ID) et identifiant d’app (Bundle ID)',
     'Enrôlement des terminaux iOS (App Attest)'],
    ['Compte développeur Google Play (si diffusion par le Play Store)', 'Compte ouvert ; l’empreinte du certificat de '
     'signature de l’app est ensuite donnée par l’équipe', 'Diffusion de l’app terminal Android'],
])

para('h2', '3.6 Passerelle locale de site (mission 8)')
table(H, [
    ['Choix du matériel de clés', 'Décision : puce TPM du mini-PC ou clé matérielle dédiée ; modèle exact et un exemplaire '
     'pour les essais', 'Passerelle en production (aujourd’hui refusée faute d’adaptateur)'],
    ['Mini-PC de référence', 'Modèle retenu et un exemplaire', 'Essais de bout en bout sur site'],
    ['Mission de l’adaptateur matériel', 'Décision : proposée en mission 12b', 'Planification'],
])

para('h2', '3.7 Outils de développement')
table(H, [
    ['Jeton ngrok', 'Déjà en place sur le poste du porteur ; jamais dans le dépôt', 'Partage de l’API de test avec une équipe cliente'],
    ['Accès au dépôt GitHub', 'Invitation des personnes de l’équipe', 'Développement et intégration continue'],
])

# --- 4. Intervenants ----------------------------------------------------------------------------------
para('h1', '4. Intervenants externes à mandater')
table(H, [
    ['Auditeur de sécurité', 'Choix maintenant ; revue de conception sur les documents du kit, puis test d’intrusion avant '
     'le premier pilote', 'Mise en production (ADR-44)'],
    ['Juriste, droit bancaire UEMOA', 'Choix maintenant ; réponse écrite avant le premier événement réel : régime, plafonds, '
     'pièces KYC, conservation, localisation des données, dépassement temporaire d’un plafond au rejeu (OP-N108)',
     'Région, plafonds, durées de conservation (OP-N12)'],
    ['Expert-comptable SYSCOHADA', 'Réponse avant la production, avec le classeur et le scénario de référence',
     'Casse, taxes, caution acquise (OP-N3)'],
])

# --- 5. Calendrier -------------------------------------------------------------------------------------
para('h1', '5. Ordre conseillé')
table(['#', 'Quand', 'Ressource', 'Délai connu', 'Pourquoi maintenant'], [
    ['1', 'Maintenant', 'Comptes Orange Money et Wave Business', 'Plusieurs semaines', 'Délai le plus long'],
    ['2', 'Maintenant', 'Devis OTP et nom d’expéditeur SMS, modèle WhatsApp', '5 à 10 jours', 'Validations administratives'],
    ['3', 'Maintenant', 'Auditeur, juriste, expert-comptable', 'Variable', 'Leurs réponses conditionnent la production'],
    ['4', 'Pendant la campagne NFC', 'Bracelets, téléphones, clé NXP, mesure de latence', 'Une demi-journée par essai',
     'Avant le code de l’app terminal'],
    ['5', 'Ensuite', 'Compte AWS et second compte, région, serveur d’identité', 'Quelques jours',
     'Préalable à la mission 12b'],
    ['6', 'Ensuite', 'Compte Apple, matériel de la passerelle, accès PayDunya et Stripe', 'Variable', 'Mission 12b et 12'],
])

# --- 6. En attendant ----------------------------------------------------------------------------------
para('h1', '6. Ce qui se passe en attendant')
para('para', 'Le développement ne s’arrête pas : chaque service manquant est remplacé par un faux derrière une interface '
     'stable, et l’adaptateur réel s’écrira sans toucher au reste. Mais deux limites restent tant que les ressources '
     'manquent : aucune recharge en ligne ni envoi de code réel n’est possible, et la plateforme ne peut pas démarrer en '
     'configuration de production. Chaque ressource fournie débloque un adaptateur, essayé contre le bac à sable puis activé '
     'seul. Le détail technique de chaque service (variables de configuration, ports, missions) est dans '
     'docs/SERVICES-EXTERNES.md.')

d.save(OUT)
print('ok', OUT)
