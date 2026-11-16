# Diagrammes de la mission 9b (rendu du skill /illustre, police sans-serif).
# Usage : python3 generate.py <dossier de sortie> <render_excalidraw.py>
import json, sys, os, importlib.util
OUT = sys.argv[1]; RENDER = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
C = dict(primary=('#0061FF','#0047CC','#FFFFFF'), data=('#CCE0FF','#0052D6','#0F172A'), neutral=('#F1F5F9','#334155','#374151'),
         ok=('#A7F3D0','#047857','#0F172A'), warn=('#FEE2E2','#DC2626','#0F172A'), accent=('#FF8A00','#CC6E00','#0F172A'),
         second=('#06B6D4','#0E7490','#0F172A'), decision=('#FEF3C7','#B45309','#0F172A'))
class D:
    def __init__(s): s.e=[]; s.n=0
    def _b(s,t,x,y,w,h,**k):
        s.n+=1
        el=dict(id=f'{t}-{s.n}',type=t,x=x,y=y,width=w,height=h,angle=0,strokeColor='#334155',backgroundColor='transparent',fillStyle='solid',
                strokeWidth=2,strokeStyle='solid',roughness=0,opacity=100,groupIds=[],frameId=None,roundness=None,seed=1000+s.n,version=1,
                versionNonce=s.n,isDeleted=False,boundElements=[],updated=1,link=None,locked=False)
        el.update(k); s.e.append(el); return el
    def text(s,x,y,w,h,t,size=22,color='#334155',align='center'):
        s._b('text',x,y,w,h,text=t,fontSize=size,fontFamily=2,textAlign=align,verticalAlign='middle',strokeColor=color,containerId=None,originalText=t,lineHeight=1.25,baseline=size)
    def box(s,x,y,w,h,t,style='neutral',shape='rectangle',size=22,dashed=False):
        f,st,tc=C[style]
        s._b(shape,x,y,w,h,backgroundColor=f,strokeColor=st,roundness={'type':3} if shape=='rectangle' else None,strokeStyle='dashed' if dashed else 'solid')
        s.text(x,y,w,h,t,size,tc)
    def arrow(s,x1,y1,x2,y2,color='#334155',dashed=False,kind='arrow',width=2):
        s._b(kind,x1,y1,x2-x1,y2-y1,points=[[0,0],[x2-x1,y2-y1]],strokeColor=color,strokeStyle='dashed' if dashed else 'solid',strokeWidth=width,
             startArrowhead=None,endArrowhead='arrow' if kind=='arrow' else None,lastCommittedPoint=None,startBinding=None,endBinding=None)
    def save(s,name):
        p=os.path.join(OUT,name+'.excalidraw')
        json.dump(dict(type='excalidraw',version=2,source='https://excalidraw.com',elements=s.e,appState=dict(viewBackgroundColor='#FFFFFF',gridSize=None),files={}),open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=1)
        return p
def usecase(name,title,sub,actors,ucs,links,includes=(),note=None,H=820):
    d=D(); d.text(60,30,1800,50,title,34,'#0F172A','left'); d.text(60,84,1800,34,sub,22,'#64748B','left')
    ah,uh=96,84; top=170
    ay={a:top+i*(H/len(actors))+(H/len(actors)-ah)/2 for i,a in enumerate(actors)}
    uy={u:top+i*(H/len(ucs))+(H/len(ucs)-uh)/2 for i,(u,_) in enumerate(ucs)}
    ax,aw,ux,uw=110,330,1010,430
    d.text(ax,top-44,aw,30,'Acteurs',20,'#0061FF'); d.text(ux,top-44,uw,30,"Cas d'usage",20,'#0061FF')
    for a in actors: d.box(ax,ay[a],aw,ah,a,'data','ellipse')
    for u,st in ucs: d.box(ux,uy[u],uw,uh,u,st)
    for a,u in links: d.arrow(ax+aw+8,ay[a]+ah/2,ux-10,uy[u]+uh/2,'#0052D6')
    for i,(u,v,lab) in enumerate(includes):
        xr=ux+uw+70+i*95
        y1,y2=uy[u]+uh/2,uy[v]+uh/2
        d.arrow(ux+uw+6,y1,xr,y1,'#64748B',True,'line'); d.arrow(xr,y1,xr,y2,'#64748B',True,'line'); d.arrow(xr,y2,ux+uw+10,y2,'#64748B',True)
    if includes: d.text(ux+uw+40,top-44,330,30,includes[0][2],18,'#64748B')
    for i,l in enumerate((note or '').split('\n')): d.text(60,top+H+20+i*32,1800,34,l,20,'#64748B','left')
    return d.save(name)
def sequence(name,title,sub,parts,msgs,note=None):
    # Styles de message : call, ret (pointillé), bad, self (action interne), note (Note over, a..b),
    # et cadres : ('#open', libellé) / ('#else', libellé) / ('#close',) (loop, alt).
    d=D(); d.text(60,30,1800,50,title,34,'#0F172A','left'); d.text(60,84,1800,34,sub,22,'#64748B','left')
    n=len(parts); pw=250; gap=(1800-pw)/(n-1) if n>1 else 0; top=160
    rows=sum(1 for m in msgs if m[0]!='#close'); step=max(min((1000-top-110)/max(rows,1),104),76)
    cx={k:60+pw/2+i*gap for i,(k,_,_) in enumerate(parts)}
    bottom=top+90+rows*step+10+40*sum(1 for m in msgs if m[0]=='#close')
    for k,lab,st in parts:
        d.box(cx[k]-pw/2,top,pw,76,lab,st,'ellipse' if st=='data' else 'rectangle',20)
        d.arrow(cx[k],top+76,cx[k],bottom,'#94A3B8',True,'line')
    L=64; R=60+pw/2+(n-1)*gap+pw/2+60
    r=0; k=0; fstack=[]
    for m in msgs:
        if m[0]=='#close':
            y0,lab=fstack.pop(); y1=top+76+step*r+12; r+=0.45
            d._b('rectangle',L,y0,R-L,y1-y0,strokeColor='#94A3B8',strokeStyle='dashed',strokeWidth=2)
            continue
        y=top+76+step*(r+0.72); r+=1
        if m[0] in ('#open','#else'):
            if m[0]=='#open': fstack.append((y-32,m[1]))
            else: d.arrow(L,y-32,R,y-32,'#94A3B8',True,'line')
            kind='loop' if m[0]=='#open' and m[1].startswith('loop') else ('alt' if m[1].startswith('alt') else '')
            d._b('rectangle',L+6,y-26,len(m[1])*10+14,28,backgroundColor='#FFFFFF',strokeColor='#FFFFFF',strokeWidth=1); d.text(L+10,y-26,len(m[1])*10+20,28,m[1],18,'#64748B','left')
            continue
        a,b,lab=m[0],m[1],m[2]; style=m[3] if len(m)>3 else 'call'
        col={'call':'#0047CC','ret':'#047857','bad':'#DC2626'}.get(style,'#0047CC')
        if style=='note':
            x1,x2=min(cx[a],cx[b]),max(cx[a],cx[b]); w=max(x2-x1+120,len(lab)*10+40)
            d.box((x1+x2)/2-w/2,y-30,w,56,lab,'decision','rectangle',19)
        elif a==b:
            sw=max(300,len(lab)*10+40); d.box(max(cx[a]-sw/2,70),y-30,sw,56,lab,'warn' if style=='bad' else ('neutral' if style=='self' else 'decision'),'rectangle',19)
            k+=1; d.text(14,y-16,40,30,str(k),18,'#94A3B8')
        else:
            x1,x2=cx[a],cx[b]; s=1 if x2>x1 else -1
            d.arrow(x1+s*6,y,x2-s*8,y,col,style=='ret',width=2)
            tw=len(lab)*10.4+20; mx=(x1+x2)/2
            d._b('rectangle',mx-tw/2,y-37,tw,28,backgroundColor='#FFFFFF',strokeColor='#FFFFFF',strokeWidth=1)
            d.text(min(x1,x2)+10,y-38,abs(x2-x1)-20,30,lab,19,'#0F172A')
            k+=1; d.text(14,y-16,40,30,str(k),18,'#94A3B8')
    if note: d.text(60,max(bottom+24,1000),1800,34,note,20,'#64748B','left')
    return d.save(name)
files=[]
P=lambda k,l,s='neutral':(k,l,s)
spec=importlib.util.spec_from_file_location('r',RENDER); r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
r._FONT_FAMILY="Helvetica Neue, Helvetica, Arial, sans-serif"; r._font_face_css=lambda: ""
PREVU="Prévu (plan du 17/11/2026), non servi."
BO='Back-office'
files.append(usecase('usecase-cloture','Clôture et réclamations tardives','Qui lance les étapes, qui passe le statut, qui valide une réclamation',
 [BO,'Second administrateur','Superviseur (lecture)'],
 [('Voir les conditions de passage','neutral'),('Aperçu d’une étape de clôture','primary'),('Exécuter une étape (une seule fois)','primary'),('Passer l’événement en CLOSED','primary'),('Voir les soldes restants (CSV)','neutral'),('Proposer une réclamation tardive','primary'),('Valider la réclamation (à deux)','accent')],
 [(BO,'Voir les conditions de passage'),(BO,'Aperçu d’une étape de clôture'),(BO,'Exécuter une étape (une seule fois)'),
  (BO,'Passer l’événement en CLOSED'),(BO,'Voir les soldes restants (CSV)'),(BO,'Proposer une réclamation tardive'),
  ('Second administrateur','Valider la réclamation (à deux)'),('Superviseur (lecture)','Voir les conditions de passage')],
 note=PREVU+" Sept étapes dans l’ordre de référence ; un rejeu n’écrit rien. Passage à RECONCILING refusé si une caisse est ouverte.\nRéclamation : annulation de casse puis remboursement, ou apport d’un bénéficiaire ; bornée par la base, validée par une autre personne que l’auteur.",H=900))
PA='Partie concernée'
files.append(usecase('usecase-versements','Versements, rapprochements et relevés','Qui prépare, valide, confirme, importe, rapproche et obtient un relevé',
 ['Administrateur (auteur du lot)','Administrateur (valideur)','Back-office',PA,'Exploitant'],
 [('Voir les droits nets','neutral'),('Préparer un lot de versements','primary'),('Valider le lot (à deux)','accent'),('Exporter le lot en CSV','primary'),('Confirmer ou déclarer en échec','primary'),('Importer un relevé CSV','primary'),('Rapprocher une ligne à la main','primary'),('Créer une demande de remboursement','primary'),('Obtenir mon relevé (API, CSV)','neutral'),('Configurer et exporter la comptabilité','neutral')],
 [('Administrateur (auteur du lot)','Voir les droits nets'),('Administrateur (auteur du lot)','Préparer un lot de versements'),('Administrateur (valideur)','Valider le lot (à deux)'),('Administrateur (auteur du lot)','Exporter le lot en CSV'),
  ('Administrateur (auteur du lot)','Confirmer ou déclarer en échec'),('Back-office','Importer un relevé CSV'),('Back-office','Rapprocher une ligne à la main'),('Back-office','Créer une demande de remboursement'),
  (PA,'Obtenir mon relevé (API, CSV)'),('Exploitant','Configurer et exporter la comptabilité')],
 note=PREVU+" Rôle du lot selon le bénéficiaire : organisateur pour les commerçants et l’organisateur, exploitant de la plateforme pour le prestataire et la plateforme.\nPartie : commerçant, festivalier, organisateur, prestataire ou plateforme. Aucun paiement n’est envoyé par l’API : paiement hors système, puis confirmation de chaque ligne. Aucun PDF.",H=1000))
files.append(sequence('sequence-cloture','Clôture par étapes : de SETTLING à CLOSED','Une étape ne s’écrit qu’une fois, dans l’ordre ; le statut exige toutes les conditions',
 [P('b','Back-office','data'),P('a','API','primary'),P('d','Base')],
 [('b','a','Aperçu de l’étape (GET preview)'),('a','d','Calcul sans écriture','self'),('a','b','200 : montants par bénéficiaire','ret'),
  ('b','a','Exécuter l’étape (POST, clé)'),('a','d','Verrou (événement, étape) ; état relu'),
  ('#open','alt étape précédente non faite'),('a','b','409 : condition manquante nommée','bad'),
  ('#else','sinon : étape déjà faite'),('a','b','200 : même réponse, rien écrit','ret'),
  ('#else','sinon : première exécution'),('a','d','Écritures par le moteur + record_closing_step'),('a','b','200 : transactions écrites','ret'),('#close',),
  ('b','a','Passer en CLOSED (status-transitions)'),('a','d','set_event_status : conditions'),
  ('#open','alt toutes les positions soldées'),('d','a','Grands livres LOCKED, scellement final','ret'),
  ('#else','sinon : soldes restants tolérés'),('d','a','Grand livre CLOSING, soldes restants relevés','ret'),('#close',)],
 note=PREVU+" Conditions nouvelles : aucune caisse ouverte, échéance de remboursement atteinte, étapes faites, comptes PSP rapprochés."))
files.append(sequence('sequence-lot-versements','Lot de versements préparé et validé à deux','Le droit net borne chaque ligne ; le paiement est fait hors système puis confirmé',
 [P('p','Administrateur auteur','data'),P('a','API','primary'),P('v','Administrateur valideur','data'),P('d','Base')],
 [('p','a','Droits nets (GET entitlements)'),('p','a','Préparer le lot (lignes ≤ droit net)'),('a','d','Approbation PAYOUT en attente','self'),('a','p','202 : en attente','ret'),
  ('p','a','Valider soi-même le lot : refus','bad'),
  ('v','a','Approuver (autre personne, rôle selon bénéficiaire)'),('a','d','create_payout_batch : droit net relu sous verrou'),
  ('#open','alt un montant dépasse le droit net'),('d','a','CL055 : 409 PAYOUT_EXCEEDS_ENTITLEMENT','bad'),
  ('#else','sinon'),('d','a','PAYOUT_INITIATED, lignes INITIATED','ret'),('#close',),
  ('p','a','Exporter le lot (CSV)'),('a','p','CSV : bénéficiaire, moyen, numéro ou IBAN, montant','ret'),
  ('p','p','Paiement fait hors système','self'),
  ('p','a','Confirmer la ligne (référence) ou échec (motif)'),('a','d','settle_payout : CONFIRMED ou FAILED'),('a','p','200 : FAILED recrédite le droit','ret')],
 note=PREVU+" Une ligne change d’état une seule fois. Une ligne INITIATED depuis plus de 48 h lève une alerte à l’exploitation."))
files.append(sequence('sequence-import-rapprochement','Import d’un relevé et rapprochement','Rapprochement automatique par référence externe, puis à la main pour le reste',
 [P('b','Back-office','data'),P('a','API','primary'),P('d','Base')],
 [('b','a','Importer le relevé CSV d’un compte (A-*)'),('a','d','import_statement_lines'),
  ('#open','alt devise ou compte étranger'),('d','a','Refus : 422','bad'),
  ('#else','sinon'),('d','a','Lignes créées, doublons ignorés','ret'),('d','a','Rapprochement auto par référence externe','ret'),('#close',),
  ('a','b','201 : créées, rapprochées, déjà présentes','ret'),
  ('b','a','Lister les lignes non rapprochées'),('b','a','Rapprocher une ligne (transaction ou anomalie)'),
  ('a','d','match_statement_line : même prestataire, grand livre et compte'),('a','b','200 : ligne rapprochée','ret'),
  ('b','a','État de rapprochement des comptes'),('a','b','Compte rapproché : lignes toutes rapprochées et soldes concordants','note')],
 note=PREVU+" Les anomalies PSP ouvertes sont représentées dans l’écart, non comptées comme inexpliquées. Une condition « comptes PSP rapprochés » gate le passage à SETTLING."))
files.append(sequence('sequence-scellement-alertes','Scellement, copie externe, contrôles et alertes','Le processus maintenance scelle toutes les 5 min, vérifie chaque jour et lève une alerte à chaque échec',
 [P('m','Maintenance','primary'),P('d','Base (ops_*)'),P('c','Copie externe simulée','neutral'),P('x','Exploitation','data')],
 [('m','d','ops_seal_ledger, ops_seal_audit'),('m','c','Copier le scellement hors de la base'),
  ('#open','alt production : copie simulée'),('c','m','Démarrage refusé (règle 2)','bad'),('#close',),
  ('m','d','Vérification quotidienne : chaînes de scellement et d’audit'),
  ('m','d','Contrôles permanents (§12.2)'),
  ('#open','alt un contrôle échoue'),('m','d','ops_raise_alert : audit, journal, alerte'),('m','x','Code d’alarme du processus (7 à 11)','bad'),
  ('#else','sinon'),('d','m','Rien à signaler','ret'),('#close',)],
 note=PREVU+" Scellement toutes les 5 min, y compris LOCKED. Contrôles : sommes nulles, droits = argent, caches, versements > 48 h, transactions > 60 s.\nDette consignée : la copie externe reste simulée et l’alerte n’atteint aucune personne avant la mission 12b."))
for f in files: print(r.render(f))
