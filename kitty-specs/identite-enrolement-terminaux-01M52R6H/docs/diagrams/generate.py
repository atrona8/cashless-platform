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
files=[]
files.append(usecase('usecase-terminaux','Terminaux — identité et enrôlement','Qui fait entrer un terminal, et ce que le terminal fait ensuite',
 ['Admin prestataire','Admin organisateur','Terminal'],
 [('Émettre un code d’enrôlement','neutral'),('Suivre les terminaux','neutral'),('Suspendre ou réactiver','neutral'),('Révoquer un terminal','accent'),('S’enrôler (attestation)','primary'),('Renouveler son jeton','neutral'),('Lire sa configuration','neutral'),('Signaler sa présence','neutral'),('Appeler une route signée','primary')],
 [('Admin prestataire','Émettre un code d’enrôlement'),('Admin prestataire','Suivre les terminaux'),('Admin prestataire','Suspendre ou réactiver'),('Admin prestataire','Révoquer un terminal'),
  ('Admin organisateur','Émettre un code d’enrôlement'),('Admin organisateur','Suivre les terminaux'),('Admin organisateur','Suspendre ou réactiver'),('Admin organisateur','Révoquer un terminal'),
  ('Terminal','S’enrôler (attestation)'),('Terminal','Renouveler son jeton'),('Terminal','Lire sa configuration'),('Terminal','Signaler sa présence'),('Terminal','Appeler une route signée')],
 note="En bleu : trois preuves (certificat, jeton lié, signature). En orange : définitif. Suspendu : configuration et présence seulement. iOS : QR seulement (OP-N64).",H=980))
P=lambda k,l,s='neutral':(k,l,s)
files.append(sequence('sequence-enrolement','Enrôlement d’un terminal','Limites d’abord, puis le code, l’attestation, le certificat ; tout refus est audité',
 [P('t','Terminal','data'),P('a','API publique','primary'),P('v','Vérif. attestation','accent'),P('c','Autorité, signataire','accent'),P('b','Base centrale')],
 [('t','t','Scanner le code, créer les clés'),('t','a','Code, clés, attestations, CSR'),('a','b','Limites (refus seuls) : 429'),('a','b','Lire le code (empreinte HMAC)'),('a','v','Chaînes, défi, révocations'),('a','c','Certificat client'),('a','b','enroll_device + audit'),('a','c','Jeton d’appareil signé'),('a','t','201 : certificat, jetons, next_seq','ret'),('a','b','Refus : essai + audit, sous verrou','bad')],
 note="Code inconnu : audit dans la chaîne de la plateforme. 10 refus par code, 30 par adresse (/64 en IPv6). Autorité et signataire : faux (OP-N73)."))
files.append(sequence('sequence-requete-terminal','Requête d’un terminal','Trois preuves liées au même terminal, vérifiées dans l’ordre ; rien n’est écrit avant le nonce',
 [P('t','Terminal','data'),P('g','Garde du terminal','primary'),P('b','Base centrale'),P('r','Route métier','primary')],
 [('t','g','mTLS + jeton + requête signée'),('g','g','Certificat et jeton'),('g','b','Terminal et famille relus'),('g','g','Empreintes, corps, signature'),('g','g','Révoqué : 403, rien écrit','bad'),('g','b','Nonce consommé (heure base)'),('g','g','Suspendu : 403 hors config','bad'),('g','r','Terminal vérifié'),('r','b','Écriture, statut revérifié'),('r','t','Réponse','ret')],
 note="Preuve absente ou fausse : 401, sans dire laquelle. Horloge hors tolérance : 400 avec l’heure. Autorité non servie : 401."))
files.append(sequence('sequence-rafraichissement','Renouvellement du jeton','Jeton à usage unique, grâce de 60 s pour une réponse perdue (OP-N65)',
 [P('t','Terminal','data'),P('a','API publique','primary'),P('b','Base centrale')],
 [('t','a','mTLS + jeton + preuve signée'),('a','b','Terminal relu, nonce consommé'),('a','b','Échanger (verrou)'),('b','a','Nouvelle paire','ret'),('a','t','Réponse perdue','bad'),('t','a','Même jeton, < 60 s'),('a','b','Grâce : paire neuve'),('a','t','Nouvelle paire','ret'),('t','a','Réutilisation hors grâce','bad'),('a','b','Famille révoquée, audit','bad')],
 note="Échange en cours : 409, à réessayer. Terminal suspendu ou révoqué : 403. Famille révoquée : ses jetons d’appareil refusés aussitôt."))
files.append(sequence('sequence-revocation','Révocation d’un terminal','Une personne suffit ; effet à la requête suivante, sans liste de révocation',
 [P('x','Admin','data'),P('a','API publique','primary'),P('b','Base centrale'),P('t','Terminal','data')],
 [('x','a','Révoquer (motif, clé bo:)'),('a','b','set_device_status REVOKED'),('b','b','Jetons, historique, audit'),('a','x','200 : terminal révoqué','ret'),('t','a','Requête suivante, 3 preuves'),('a','b','Terminal relu'),('a','t','403 DEVICE_REVOKED','bad')],
 note="Rien n’est écrit pour la requête refusée (pas de nonce). Le serial redevient libre : nouveau terminal, next_seq = dernier vu + 1."))
spec=importlib.util.spec_from_file_location('r',RENDER); r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
r._FONT_FAMILY="Helvetica Neue, Helvetica, Arial, sans-serif"; r._font_face_css=lambda: ""
for f in files: print(r.render(f))
