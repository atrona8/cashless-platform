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
files.append(usecase('usecase-administration','Bracelets NFC — administration','Qui prépare les bracelets et garde les clés',
 ['Admin prestataire','Exploitant','Admin organisateur','Agent de personnalisation','Superviseur'],
 [('Gérer les clés (à deux)','primary'),('Contrôler les clés','neutral'),('Gérer un lot','neutral'),('Commander les codes','neutral'),('Personnaliser un bracelet','accent'),('Mettre en liste noire','neutral'),('Sortir de liste noire (à deux)','primary')],
 [('Admin prestataire','Gérer les clés (à deux)'),('Admin prestataire','Contrôler les clés'),('Exploitant','Gérer les clés (à deux)'),('Exploitant','Contrôler les clés'),('Admin organisateur','Gérer un lot'),('Admin organisateur','Commander les codes'),('Agent de personnalisation','Personnaliser un bracelet'),('Superviseur','Mettre en liste noire'),('Superviseur','Sortir de liste noire (à deux)')],
 note="En bleu : action validée par une seconde personne. En orange : seule opération où un mot de passe de bracelet est remis (chiffré) à un poste.",H=900))
files.append(usecase('usecase-terrain','Bracelets NFC — terrain','Ce que font le terminal, le guichet et le festivalier',
 ['Terminal','Agent de guichet','Festivalier'],
 [('Lire un bracelet','primary'),('Activer et cautionner','neutral'),('Rendre ou remplacer','neutral'),('Rendre les espèces dues','neutral'),('Remettre en stock','neutral'),('Déclarer perdu, retrouvé','neutral'),('Confirmer au guichet','neutral'),('Rattacher par code','second'),('Consulter un solde par code','second')],
 [('Terminal','Lire un bracelet'),('Agent de guichet','Activer et cautionner'),('Agent de guichet','Rendre ou remplacer'),('Agent de guichet','Rendre les espèces dues'),('Agent de guichet','Remettre en stock'),('Agent de guichet','Déclarer perdu, retrouvé'),('Agent de guichet','Confirmer au guichet'),('Festivalier','Rattacher par code'),('Festivalier','Consulter un solde par code')],
 includes=[('Activer et cautionner','Lire un bracelet','commence par une lecture'),('Rendre ou remplacer','Lire un bracelet',''),('Rendre les espèces dues','Lire un bracelet',''),('Confirmer au guichet','Lire un bracelet','')],
 note="Bracelet approvisionné : rattachement seulement après confirmation au guichet. Espèces : refus (409) tant qu'aucune caisse n'est ouverte.",H=1040))
P=lambda k,l,s='neutral':(k,l,s)
files.append(sequence('sequence-personnalisation','Personnalisation d’un bracelet','Le mot de passe n’est jamais transmis ni stocké en clair',
 [P('p','Poste','data'),P('s','Personnalisation','primary'),P('k','Service de clés','accent'),P('b','Base centrale')],
 [('p','s','Enregistrer + clé à usage unique'),('s','k','Calculer le mot de passe'),('k','s','Mot de passe','ret'),('s','k','Clé de session (1er bracelet)'),('s','s','Sceller (clé de session)'),('s','b','Bracelet personnalisé, audit'),('s','s','Chiffrer pour le poste, effacer'),('s','p','Mot de passe sous enveloppe','ret')],
 note="Aucun droit de déchiffrer ici. La signature NXP est vérifiée par le poste ; le serveur n’en garde que l’empreinte."))
files.append(sequence('sequence-lecture','Lecture d’un bracelet par un terminal','Deux processus : les clés d’un côté, l’API publique de l’autre',
 [P('t','Terminal','data'),P('c','Processus des clés','primary'),P('k','Service de clés','accent'),P('a','API publique','primary'),P('b','Base centrale')],
 [('t','c','Demander le mot de passe'),('c','b','Lire le chiffré du bracelet'),('c','k','Déchiffrer (hors cache)'),('c','t','Mot de passe chiffré pour ce terminal','ret'),('t','a','Enregistrer la lecture'),('a','b','register_tap'),('a','t','Résultat et solde','ret')],
 note="La clé de données reste en mémoire 5 minutes au plus, dans le seul processus des clés. Bracelet inconnu : même refus, même délai."))
files.append(sequence('sequence-lecture-suspecte','Lecture suspecte dans une opération','L’opération échoue, mais le blocage du bracelet reste',
 [P('t','Terminal','data'),P('a','API publique','primary'),P('b','Base centrale')],
 [('t','a','Opération avec lecture'),('a','b','register_tap, dans l’opération'),('b','a','Copie suspectée','bad'),('a','b','Annuler l’opération'),('a','b','register_tap seul, validé'),('b','b','Liste noire + anomalie','bad'),('a','t','Erreur : copie suspectée','bad')]))
files.append(sequence('sequence-rattachement','Rattachement d’un bracelet approvisionné','Le code imprimé ne suffit pas : il faut le bracelet en main',
 [P('f','Festivalier','data'),P('g','Agent de guichet','data'),P('a','API publique','primary'),P('b','Base centrale')],
 [('f','a','Saisir le code imprimé'),('a','b','Solde non nul : demande en attente'),('a','f','Code de confirmation à 6 chiffres','ret'),('g','a','Lecture du bracelet (taps)'),('g','a','Code imprimé, code reçu, lecture'),('a','b','Confirmer, lecture consommée'),('a','g','Portefeuille rattaché','ret')],
 note="Solde nul : rattachement direct. Bracelet jamais activé : activation par l’app si l’événement l’autorise."))
files.append(sequence('sequence-creation-cle','Création d’une clé, à deux','Aucun service permanent ne peut créer une clé',
 [P('x','Admin prestataire','data'),P('y','Second admin','data'),P('a','API publique','primary'),P('e','Commande d’admin.','accent'),P('k','Service de clés','accent'),P('b','Base centrale')],
 [('x','a','Demander une clé'),('y','a','Approuver'),('a','b','Travail CREATE_KEY'),('e','e','Lancée par l’exploitant'),('e','b','Prendre le travail'),('e','k','Créer la clé HMAC'),('e','b','Clé enregistrée, travail fini')],
 note="Référence notée avant l’écriture : une reprise ne crée pas de seconde clé. Première clé de données : première personnalisation."))
files.append(sequence('sequence-controle-quotidien','Contrôle quotidien des mots de passe','Un passage par prestataire et par 24 h, sans anomalie',
 [P('o','Contrôle quotidien','primary'),P('k','Service de clés','accent'),P('b','Base centrale')],
 [('o','b','Échantillon de bracelets'),('o','k','Déchiffrer la clé de données'),('o','k','Recalculer le mot de passe'),('o','o','Comparer, effacer'),('o','b','Compte rendu OK, MISMATCH, ERROR'),('o','b','Audit des écarts (identifiant)','bad')],
 note="Avec --once : code de sortie 2 sur écart, 3 sur panne du service de clés (nouvel essai au passage suivant)."))
spec=importlib.util.spec_from_file_location('r',RENDER); r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
r._FONT_FAMILY="Helvetica Neue, Helvetica, Arial, sans-serif"; r._font_face_css=lambda: ""
for f in files: print(r.render(f))
