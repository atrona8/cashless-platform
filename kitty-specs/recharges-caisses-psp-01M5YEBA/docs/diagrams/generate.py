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
    if note: d.text(60,top+H+20,1800,34,note,20,'#64748B','left')
    return d.save(name)

def sequence(name,title,sub,parts,msgs,note=None):
    d=D(); d.text(60,30,1800,50,title,34,'#0F172A','left'); d.text(60,84,1800,34,sub,22,'#64748B','left')
    n=len(parts); pw=250; gap=(1800-pw)/(n-1) if n>1 else 0; top=160; step=(1000-top-110)/max(len(msgs),1); step=min(step,104)
    cx={k:60+pw/2+i*gap for i,(k,_,_) in enumerate(parts)}
    bottom=top+90+len(msgs)*step+10
    for k,lab,st in parts:
        d.box(cx[k]-pw/2,top,pw,76,lab,st,'ellipse' if st=='data' else 'rectangle',20)
        d.arrow(cx[k],top+76,cx[k],bottom,'#94A3B8',True,'line')
    for i,m in enumerate(msgs):
        y=top+76+step*(i+0.72); a,b,lab=m[0],m[1],m[2]; style=m[3] if len(m)>3 else 'call'
        col={'call':'#0047CC','ret':'#047857','bad':'#DC2626'}[style]
        if a==b:
            d.box(max(cx[a]-150,64),y-30,300,56,lab,'warn' if style=='bad' else 'decision','rectangle',19)
        else:
            x1,x2=cx[a],cx[b]; s=1 if x2>x1 else -1
            d.arrow(x1+s*6,y,x2-s*8,y,col,style=='ret',width=2)
            tw=len(lab)*10.4+20; mx=(x1+x2)/2
            d._b('rectangle',mx-tw/2,y-37,tw,28,backgroundColor='#FFFFFF',strokeColor='#FFFFFF',strokeWidth=1)
            d.text(min(x1,x2)+10,y-38,abs(x2-x1)-20,30,lab,19,'#0F172A')
        d.text(14,y-16,40,30,str(i+1),18,'#94A3B8')
    if note: d.text(60,max(bottom+24,1000),1800,34,note,20,'#64748B','left')
    return d.save(name)




files=[]
P=lambda k,l,s='neutral':(k,l,s)
files.append(usecase('usecase-caisse','Caisse et recharge en espèces','Qui ouvre, qui compte, qui ferme, qui dépose',
 ['Caissier (terminal)','Superviseur','Admin back-office'],
 [('Ouvrir une session','primary'),('Compter sa caisse','primary'),('Recharger en espèces','primary'),('Prendre la caution due','neutral'),('Caution et espèces dues','neutral'),('Fermer la session','accent'),('Déposer en banque','accent')],
 [('Caissier (terminal)','Ouvrir une session'),('Caissier (terminal)','Compter sa caisse'),('Caissier (terminal)','Recharger en espèces'),('Caissier (terminal)','Caution et espèces dues'),
  ('Superviseur','Ouvrir une session'),('Superviseur','Fermer la session'),('Admin back-office','Déposer en banque')],
 includes=[('Recharger en espèces','Prendre la caution due','inclut')],
 note="Aucune espèce sans session ouverte (garde en base). Compté à l'aveugle ; le fermeur n'a pas compté. Écart au payeur du contrat (CASH_DIFF). Dépôt : une personne saisit, une autre approuve.",H=820))
files.append(usecase('usecase-psp','Recharge en ligne par PSP','Qui configure, qui choisit, qui demande, qui est notifié',
 ['Admin prestataire','Admin organisateur','Caissier ou festivalier','PSP (faux)'],
 [('Configurer un PSP (à deux)','neutral'),('Choisir le PSP de l’événement','neutral'),('Demander une recharge','primary'),('Suivre ou annuler sa recharge','primary'),('Notifier un paiement','accent'),('Notifier une contestation','accent'),('Débloquer un portefeuille (à deux)','neutral')],
 [('Admin prestataire','Configurer un PSP (à deux)'),('Admin organisateur','Choisir le PSP de l’événement'),('Admin organisateur','Débloquer un portefeuille (à deux)'),
  ('Caissier ou festivalier','Demander une recharge'),('Caissier ou festivalier','Suivre ou annuler sa recharge'),('PSP (faux)','Notifier un paiement'),('PSP (faux)','Notifier une contestation')],
 note="Jamais de crédit sans notification authentifiée (ou statut confirmé par interrogation). Carte : 3-D Secure attesté, plafond par carte et par jour. PSP réels reportés : faux refusé en production (OP-N81).",H=900))
files.append(sequence('sequence-session-caisse','Session de caisse et fermeture','Ouverture au terminal, comptage à l’aveugle, fermeture par une autre personne',
 [P('t','Terminal (caissier)','data'),P('s','Superviseur','data'),P('a','API publique','primary'),P('b','Base centrale')],
 [('t','a','Ouvrir (3 preuves + agent)'),('a','b','Caisse du terminal, session'),('a','t','Session ouverte, rien écrit','ret'),('t','a','Compter (montant)'),('a','t','Reçu, sans théorique','ret'),('s','a','Fermer la session'),('a','b','Verrou, théorique, CASH_CLOSE'),('b','b','Écart non nul : CASH_DIFF'),('a','s','Session fermée','ret'),('a','s','Fermeur ayant compté : 403','bad')],
 note="Sans comptage : 409. Seconde session sur la caisse ou le terminal : 409. Caisse remise à zéro ; écart au payeur du contrat (cash_diff_bearer)."))
files.append(sequence('sequence-recharge-especes','Recharge en espèces et caution due','Écriture rattachée à la session ; caution prise ensuite, à part',
 [P('t','Terminal (caissier)','data'),P('a','API publique','primary'),P('e','Moteur d’écritures','accent'),P('b','Base centrale')],
 [('t','a','Recharger 5 000 (session)'),('a','b','Session ouverte du terminal ?'),('a','e','TOPUP_CASH (en ligne)'),('e','b','Caisse → portefeuille payé'),('a','b','Rattacher à la session'),('a','b','Caution due ? (autre transaction)'),('a','t','201 : recharge, caution','ret'),('a','t','Sans session : 409, rien écrit','bad'),('a','t','Plafond : 422, rien écrit','bad'),('b','b','Caution en échec : reste DUE')],
 note="Au-delà du plafond en ligne, refus (le découpage vers L-ESP-A-RENDRE est réservé au hors ligne). Caution prise seulement en mode prélevé sur le solde."))
files.append(sequence('sequence-recharge-psp','Recharge PSP : demande, notification, traitement','Rien n’est crédité avant la notification authentifiée',
 [P('d','Demandeur','data'),P('a','API publique','primary'),P('p','PSP (faux)','second'),P('b','Base centrale')],
 [('d','a','Demander (moyen, montant)'),('a','b','Configuration, recharge PENDING'),('a','p','Initier (référence marchande)'),('a','d','Action de paiement','ret'),('p','a','Notification signée'),('a','a','Signature, heure, taille'),('a','b','Conserver brut (transaction 1)'),('a','p','200 reçu','ret'),('a','b','Traiter sous verrou (transaction 2)'),('b','b','TOPUP unique, SUCCEEDED'),('a','b','Caution due (à part)'),('a','d','Consultation : SUCCEEDED','ret')],
 note="Non créditable (plafond, 3-D Secure, plafond de carte, grand livre fermé) : FAILED, aucune écriture, anomalie portant le montant à rendre. Même clé qu'une interrogation."))
files.append(sequence('sequence-interrogation','Interrogation planifiée et expiration','Une notification perdue ne laisse pas la recharge en suspens',
 [P('w','Travailleur psp-poller','neutral'),P('a','Adaptateur PSP','second'),P('b','Base centrale')],
 [('w','b','Recharges PENDING > 2 min'),('w','a','Statut du paiement'),('a','w','Payé','ret'),('w','b','Traiter (même clé que la notification)'),('a','w','Sinon : non payé, échu','ret'),('w','b','Recharge EXPIRED'),('a','w','Sinon : échec confirmé','bad'),('w','b','Recharge FAILED'),('b','b','Échec du travailleur : alerte')],
 note="Pas d'appel réseau sous verrou. Notification non retrouvée (UNMATCHED) ou en erreur (RETRY) : reprise par le même travailleur, alerte au-delà de 5 essais."))
files.append(sequence('sequence-notification-refusee','Notification refusée','Rien au grand livre ni au registre brut ; toujours signalée',
 [P('p','PSP ou inconnu','second'),P('a','API publique','primary'),P('b','Base centrale'),P('j','Journal et alerte','neutral')],
 [('p','a','Notification (corps brut)'),('a','p','Plus de 64 Kio : 413','bad'),('a','b','Configuration ACTIVE ?'),('a','p','Inconnue ou inactive : 404','bad'),('a','a','Signature à temps constant'),('a','p','Invalide : 401','bad'),('a','a','Horodatage à ±300 s'),('a','p','Hors tolérance : 401','bad'),('a','j','Journal de sécurité, alerte bornée'),('a','b','Compteur de refus (sans corps)')],
 note="Deux secrets acceptés pendant une rotation. 404 neutre : aucun oracle sur l'existence d'une configuration."))
files.append(sequence('sequence-contestation-carte','Contestation carte','Une seule écriture par contestation, jamais au-delà de la recharge',
 [P('p','PSP (faux)','second'),P('a','API publique','primary'),P('e','Moteur d’écritures','accent'),P('b','Base centrale')],
 [('p','a','Notification DISPUTE'),('a','b','Conserver brut'),('a','b','Contestation : unique, plafonnée'),('a','e','CHARGEBACK'),('e','b','Solde payé, puis pertes du payeur'),('a','b','Solde insuffisant : BLOQUÉ'),('a','p','200 reçu','ret'),('b','b','Verrouillé : LATE_CHARGEBACK','bad'),('b','b','Inconnue : PSP_MISMATCH','bad')],
 note="Contestation tardive : écriture après approbation d'une seconde personne. Déblocage du portefeuille : demande WALLET_UNBLOCK à deux."))
spec=importlib.util.spec_from_file_location('r',RENDER); r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
r._FONT_FAMILY="Helvetica Neue, Helvetica, Arial, sans-serif"; r._font_face_css=lambda: ""
for f in files: print(r.render(f))
