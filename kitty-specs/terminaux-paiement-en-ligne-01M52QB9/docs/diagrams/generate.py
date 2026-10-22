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
files.append(usecase('usecase-encaissement','Encaissement en ligne','Qui prépare la caisse, qui encaisse, qui paie',
 ['Admin commerçant','Admin organisateur','Vendeur (terminal)','Festivalier (app)','Superviseur'],
 [('Gérer les vendeurs','neutral'),('Gérer le catalogue','neutral'),('Ouvrir sa session (PIN)','primary'),('Encaisser par bracelet','primary'),('Encaisser par QR','primary'),('Annuler sa vente','accent'),('Payer un QR','neutral'),('Annuler hors fenêtre','accent')],
 [('Admin commerçant','Gérer les vendeurs'),('Admin commerçant','Gérer le catalogue'),('Admin organisateur','Gérer le catalogue'),
  ('Vendeur (terminal)','Ouvrir sa session (PIN)'),('Vendeur (terminal)','Encaisser par bracelet'),('Vendeur (terminal)','Encaisser par QR'),('Vendeur (terminal)','Annuler sa vente'),
  ('Festivalier (app)','Payer un QR'),('Superviseur','Annuler hors fenêtre')],
 note="En bleu : session de vendeur et trois preuves du terminal. En orange : contre-passation, une seule fois. Catalogue au commerçant si l'organisateur le délègue.",H=1000))
P=lambda k,l,s='neutral':(k,l,s)
files.append(sequence('sequence-session-vendeur','Session de vendeur','L’essai est compté avant la vérification ; 5 échecs bloquent jusqu’au commerçant',
 [P('t','Terminal','data'),P('a','API publique','primary'),P('b','Base centrale')],
 [('t','a','Vendeur et PIN (3 preuves)'),('a','b','Compter l’essai (validé)'),('b','a','Empreinte du PIN','ret'),('a','a','Vérifier (argon2id + secret)'),('a','b','Ouvrir la session (revérifiée)'),('a','t','Session ouverte, 12 h','ret'),('a','t','PIN faux : 401 neutre','bad'),('b','b','5e échec : vendeur bloqué','bad')],
 note="Même réponse pour PIN faux, vendeur inconnu, bloqué ou d’un autre commerçant. Limite consignée : la base croit l’API sur la vérification (OP-N76)."))
files.append(sequence('sequence-paiement-bracelet','Paiement par bracelet','Un aller-retour, une transaction : tout ou rien',
 [P('t','Terminal','data'),P('a','API publique','primary'),P('e','Moteur d’écritures','accent'),P('b','Base centrale')],
 [('t','a','Lecture, lignes, session'),('a','b','Numéro du terminal'),('a','b','Terminal et session relus'),('a','b','Lecture enregistrée'),('a','b','Portefeuille payable'),('a','e','Vente PURCHASE'),('e','b','Écriture'),('a','b','Lignes et vendeur'),('a','b','Passage consommé'),('a','t','201 : vente, solde','ret'),('a','t','Refus : rien écrit','bad')],
 note="Prix : version courante ou dernière servie au terminal. Refus : passage non enregistré, la même lecture peut resservir ; numéro enregistré à part."))
files.append(sequence('sequence-annulation','Annulation d’une vente','Le vendeur de la vente dans la fenêtre ; sinon un superviseur',
 [P('t','Terminal','data'),P('s','Superviseur','data'),P('a','API publique','primary'),P('b','Base centrale')],
 [('t','a','Annuler (session du vendeur)'),('a','b','Même vendeur, même terminal ?'),('a','b','Fenêtre (heure de la base)'),('a','b','Contre-passation, une fois'),('a','t','201 : vente annulée','ret'),('a','t','Hors fenêtre : 403','bad'),('s','t','Jeton sur place'),('t','a','Annuler + jeton'),('a','b','Contre-passation (superviseur)'),('a','t','201 : vente annulée','ret')],
 note="Seconde annulation : 409 (index unique en base). Au back-office : demande à deux personnes."))
files.append(sequence('sequence-qr-commercant','Paiement par QR commerçant','Le terminal affiche, le festivalier paie dans l’app',
 [P('t','Terminal','data'),P('a','API publique','primary'),P('f','App festivalier','data'),P('b','Base centrale')],
 [('t','a','Demande : montant, lignes'),('a','b','Demande (empreinte du jeton)'),('a','t','Jeton une fois, 60 s','ret'),('f','a','Payer : jeton, portefeuille'),('a','b','Verrouiller et contrôler'),('a','b','Vente puis confirmation'),('a','f','Payé','ret'),('t','a','Statut (attente)'),('a','t','Confirmée','ret')],
 note="Jeton inconnu, payé, annulé ou expiré : même refus. Aucun jeton en clair, même dans le registre d’idempotence. App : identité réelle en mission 10."))
spec=importlib.util.spec_from_file_location('r',RENDER); r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
r._FONT_FAMILY="Helvetica Neue, Helvetica, Arial, sans-serif"; r._font_face_css=lambda: ""
for f in files: print(r.render(f))
