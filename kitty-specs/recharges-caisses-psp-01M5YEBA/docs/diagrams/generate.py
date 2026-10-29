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
            sw=max(300,len(lab)*10+40); d.box(cx[a]-sw/2,y-30,sw,56,lab,'warn' if style=='bad' else ('neutral' if style=='self' else 'decision'),'rectangle',19)
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
files.append(usecase('usecase-caisse','Caisse et recharge en espèces','Qui ouvre, qui compte, qui ferme, qui dépose',
 ['Caissier (terminal)','Superviseur','Admin back-office'],
 [('Ouvrir une session','primary'),('Compter sa caisse','primary'),('Recharger en espèces','primary'),('Prendre la caution due','neutral'),('Caution et espèces dues','neutral'),('Fermer la session','accent'),('Déposer en banque (à deux)','accent')],
 [('Caissier (terminal)','Ouvrir une session'),('Caissier (terminal)','Compter sa caisse'),('Caissier (terminal)','Recharger en espèces'),('Caissier (terminal)','Caution et espèces dues'),
  ('Superviseur','Ouvrir une session'),('Superviseur','Fermer la session'),('Admin back-office','Déposer en banque (à deux)')],
 includes=[('Recharger en espèces','Prendre la caution due','inclut')],
 note="Aucune espèce sans session ouverte (garde en base). Compté à l'aveugle ; le fermeur n'a pas compté. Écart au payeur du contrat (CASH_DIFF).\nDépôt : demande CASH_DEPOSIT, approuvée par une autre personne.",H=820))
files.append(usecase('usecase-psp','Recharge en ligne par PSP','Qui configure, qui choisit, qui demande, qui est notifié, qui décide à deux',
 ['Admin prestataire','Admin organisateur','Caissier ou festivalier','PSP (faux)'],
 [('Configurer un PSP (à deux)','neutral'),('Choisir le PSP de l’événement','neutral'),('Demander une recharge','primary'),('Suivre ou annuler sa recharge','primary'),('Notifier un paiement','accent'),('Notifier une contestation','accent'),('Contestation tardive (à deux)','warn'),('Débloquer un portefeuille (à deux)','neutral')],
 [('Admin prestataire','Configurer un PSP (à deux)'),('Admin prestataire','Contestation tardive (à deux)'),('Admin organisateur','Choisir le PSP de l’événement'),('Admin organisateur','Contestation tardive (à deux)'),('Admin organisateur','Débloquer un portefeuille (à deux)'),
  ('Caissier ou festivalier','Demander une recharge'),('Caissier ou festivalier','Suivre ou annuler sa recharge'),('PSP (faux)','Notifier un paiement'),('PSP (faux)','Notifier une contestation')],
 note="Jamais de crédit sans notification authentifiée. Contestation tardive : OPERATOR_ADMIN ou ORGANIZER_ADMIN demande, une autre personne approuve.\nDéblocage : ORGANIZER_ADMIN, refusé si une autre cause bloque. Faux PSP refusé en production (OP-N81).",H=980))
files.append(sequence('sequence-session-caisse','Session de caisse et fermeture','Ouverture au terminal, comptage à l’aveugle, fermeture par une autre personne',
 [P('t','Terminal (caissier)','data'),P('s','Superviseur','data'),P('a','API publique','primary'),P('b','Base centrale')],
 [('t','a','Ouvrir (3 preuves + agent)'),('a','b','Caisse du terminal, session'),('a','t','Session ouverte, rien écrit','ret'),('t','a','Compter (montant)'),('a','t','Reçu, sans théorique','ret'),('s','a','Fermer la session'),('a','b','Verrous : terminal, session, solde'),('a','b','Théorique, CASH_CLOSE'),('b','b','Écart non nul : CASH_DIFF'),('a','s','Session fermée','ret'),('a','s','Fermeur ayant compté : 403','bad')],
 note="Ordre des verrous fixé par la migration 0040 : plus d'interblocage avec une recharge en espèces. Sans comptage : 409. Seconde session sur la caisse ou le terminal : 409. Vue CASHIER : écart masqué."))
files.append(sequence('sequence-recharge-especes','Recharge en espèces et caution due','Écriture rattachée à la session ; caution prise ensuite, à part',
 [P('t','Terminal (caissier)','data'),P('a','API publique','primary'),P('e','Moteur d’écritures','accent'),P('b','Base centrale')],
 [('t','a','Recharger 5 000 (session)'),('a','b','Session ouverte du terminal ?'),('a','e','TOPUP_CASH (en ligne)'),('e','b','Caisse → portefeuille payé'),('a','b','Rattacher à la session'),('a','b','Caution due ? (autre transaction)'),('a','t','201 : recharge, caution','ret'),('a','t','Sans session : 409, rien écrit','bad'),('a','t','Plafond : 422, rien écrit','bad'),('b','b','Caution en échec : reste DUE')],
 note="Au-delà du plafond en ligne, refus (le découpage vers L-ESP-A-RENDRE est réservé au hors ligne). Caution prise seulement en mode prélevé sur le solde."))
files.append(sequence('sequence-recharge-psp','Recharge PSP : demande, notification, traitement','Rien n’est crédité avant la notification authentifiée ; l’appel au PSP se fait hors transaction',
 [P('d','Demandeur','data'),P('a','API publique','primary'),P('p','PSP (faux)','second'),P('b','Base centrale')],
 [('d','a','Demander (moyen, montant)'),('a','b','Temps 1 : clé réservée, PENDING'),('a','p','Temps 2 : initier, hors transaction'),('p','a','Référence du PSP, action','ret'),('a','b','Temps 3 : mark_psp_topup_initiated'),('a','d','Réponse sous IdempotentTx','ret'),
  ('p','a','Notification signée'),('a','a','Signature, heure, taille','self'),('a','b','Conserver brut (transaction 1)'),('a','p','200 reçu','ret'),('a','b','Traiter sous verrou (transaction 2)'),('b','b','TOPUP unique, SUCCEEDED','self'),('a','b','Caution due (à part)'),('d','a','Consulter : SUCCEEDED'),
  ('p','b','Succès après annulation : crédité si recevable','note')],
 note="Non créditable (plafond, 3-D Secure, grand livre fermé) : FAILED, aucune écriture, anomalie. Annulation : même schéma en trois temps."))
files.append(sequence('sequence-interrogation','Processus psp-poller : trois travailleurs','Une notification perdue ne laisse pas la recharge en suspens ; rien n’est gardé indéfiniment',
 [P('w','Interrogation et expiration','neutral'),P('r','Reprise des événements','neutral'),P('u','Purge','neutral'),P('a','Adaptateur PSP','second'),P('b','Base centrale')],
 [('w','b','Recharges PENDING > 2 min'),('w','a','Statut du paiement'),('#open','alt Payé'),('a','w','Payé','ret'),('w','b','Traiter (même clé que la notification)'),('#else','else Non payé, échu'),('a','w','Non payé, échu','ret'),('w','b','Recharge EXPIRED'),('#else','else Échec confirmé'),('a','w','Échec confirmé','bad'),('w','b','Recharge FAILED'),('#close',),
  ('r','b','Événements RETRY et UNMATCHED'),('r','b','Retraiter (même clé)'),('b','b','Plus de 5 essais : alerte','self'),('b','b','DISPUTE introuvable > 24 h : PSP_MISMATCH','bad'),
  ('u','b','Purger les corps bruts > 400 jours')],
 note="Pas d'appel réseau sous verrou. Le travailleur d'interrogation et celui de reprise partagent le traitement de la notification (une seule écriture par paiement)."))
files.append(sequence('sequence-notification-refusee','Notification refusée','Rien au grand livre ni au registre brut ; toujours signalée',
 [P('p','PSP ou inconnu','second'),P('a','API publique','primary'),P('b','Base centrale'),P('j','Journal et alerte','neutral')],
 [('p','a','Notification (corps brut)'),('a','p','Plus de 64 Kio : 413','bad'),('a','b','Configuration ACTIVE ?'),('a','p','Inconnue ou inactive : 404','bad'),('a','a','Signature à temps constant'),('a','p','Invalide : 401','bad'),('a','a','Horodatage à ±300 s'),('a','p','Hors tolérance : 401','bad'),('a','j','Journal de sécurité, alerte bornée'),('a','b','Compteur de refus (sans corps)')],
 note="Deux secrets acceptés pendant une rotation. 404 neutre : aucun oracle sur l'existence d'une configuration."))
files.append(sequence('sequence-contestation-carte','Contestation carte','Une écriture par contestation, jamais au-delà de la recharge ; blocage et décisions à deux',
 [P('p','PSP (faux)','second'),P('a','API publique','primary'),P('e','Moteur d’écritures','accent'),P('b','Base centrale'),P('o','Back-office (2 personnes)','data')],
 [('p','a','Notification DISPUTE'),('a','b','Conserver brut'),('a','e','CHARGEBACK (unique, plafonné)'),('e','b','Solde payé, puis pertes du payeur'),('a','b','Manque sur les lignes écrites : bloquer'),('b','b','Autre cause de blocage : gardée','self'),('a','p','200 reçu','ret'),
  ('#open','alt Grand livre verrouillé'),('b','b','LATE_CHARGEBACK : rien écrit','bad'),('o','a','Demande (ORGANIZER ou OPERATOR_ADMIN)'),('o','a','Autre personne approuve'),('a','e','CHARGEBACK à l’approbation'),
  ('#close',),('#open','alt Déblocage du portefeuille'),('o','a','Demande (ORGANIZER_ADMIN)'),('o','a','Autre personne approuve'),('b','b','Autre cause (other_block) : refus','bad'),('#close',),
  ('b','b','Introuvable après 24 h : PSP_MISMATCH','bad')],
 note="Le déblocage par contestation ne lève jamais un blocage d'une autre cause (wallet.other_block, CL029). Contestation tardive : écriture seulement après approbation."))
spec=importlib.util.spec_from_file_location('r',RENDER); r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
r._FONT_FAMILY="Helvetica Neue, Helvetica, Arial, sans-serif"; r._font_face_css=lambda: ""
for f in files: print(r.render(f))
