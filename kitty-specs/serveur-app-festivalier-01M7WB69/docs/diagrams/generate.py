# Diagrammes de la mission 10a (rendu du skill /illustre, police sans-serif).
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
    d=D(); d.text(60,30,1300,50,title,34,'#0F172A','left'); d.text(60,84,1800,34,sub,22,'#64748B','left'); d.box(1400,30,460,44,'Relu le 23/11/2026 — non fusionné','decision','rectangle',20)
    ah,uh=96,84; top=170
    ay={a:top+i*(H/len(actors))+(H/len(actors)-ah)/2 for i,a in enumerate(actors)}
    uy={u:top+i*(H/len(ucs))+(H/len(ucs)-uh)/2 for i,(u,_) in enumerate(ucs)}
    ax,aw,ux,uw=110,330,1010,430
    d.text(ax,top-44,aw,30,'Acteurs',20,'#0061FF'); d.text(ux,top-44,uw,30,"Cas d'usage",20,'#0061FF')
    for a in actors: d.box(ax,ay[a],aw,ah,a,'data','ellipse')
    for u,st in ucs: d.box(ux,uy[u],uw,uh,u,st)
    for l in links:
        a,u=l[0],l[1]; d.arrow(ax+aw+8,ay[a]+ah/2,ux-10,uy[u]+uh/2,l[2] if len(l)>2 else '#0052D6',len(l)>2)
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
    d=D(); d.text(60,30,1300,50,title,34,'#0F172A','left'); d.text(60,84,1800,34,sub,22,'#64748B','left'); d.box(1400,30,460,44,'Relu le 23/11/2026 — non fusionné','decision','rectangle',20)
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
CA='Caissier'; AD='Administrateurs'; EX='Exploitant'; FE='Festivalier'
U1='Identifier un festivalier'; R1='Identifier son propre compte'; U2='Demander une révocation'; U3='Approuver une révocation'
U4='Faire tourner le secret'; U5='Réémettre les codes'; U6='Recevoir son code'; U7='Voir bracelet et solde'
RED='#DC2626'
files.append(usecase('usecase-festivalier-serveur','Serveur de l’app festivalier','Ce que chaque acteur peut faire au guichet, à l’exploitation et dans l’app',
 [CA,AD,EX,FE],
 [(U1,'primary'),(R1,'warn'),(U2,'primary'),(U3,'primary'),(U4,'primary'),(U5,'primary'),(U6,'primary'),(U7,'primary')],
 [(CA,U1),(CA,R1,RED),(AD,U1),(AD,U2),(AD,U3),(EX,U4),(EX,U5),(FE,U6),(FE,U7)],
 note="Relu le 23/11/2026 (11 lots approuvés), non fusionné. Flèche rouge pointillée : refus (agent titulaire, 403).\nL’identification exige un compte au numéro vérifié ; la révocation se fait à deux personnes.\nAprès rotation, les anciens codes sont refusés comme inconnus ; les nouveaux sont réémis par la commande d’exploitation, dont le fichier nomme chaque bracelet.\nLe code part par WhatsApp, puis SMS ; le numéro imprimé et l’avis de solde provisoire arrivent dans /me.",H=880))
files.append(sequence('sequence-kyc','Identification et révocation à deux','Écriture par fonctions contrôlées de la base ; la révocation n’est exécutée qu’à l’approbation',
 [P('c','Caissier','data'),P('a','API','primary'),P('d','Base'),P('r','Administrateur','data'),P('s','Autre administrateur','data')],
 [('c','a','POST /kyc-verifications'),('a','d','create_kyc_verification (DEFINER)'),
  ('#open','alt refus de la fonction'),('d','a','Portefeuille anonyme, pièce expirée, agent titulaire','bad'),('a','c','422 ou 403, rien écrit','bad'),
  ('#else','sinon'),('d','d','Ligne VERIFIED (ajout seul)','self'),('d','a','Identification','ret'),('a','c','201 : niveau VERIFIED','ret'),('#close',),
  ('r','a','Demander la révocation (motif)'),('a','r','202 : demande PENDING','ret'),
  ('s','a','Approuver la demande'),
  ('#open','alt même personne que l’auteur'),('a','s','Refus, demande PENDING','bad'),
  ('#else','sinon'),('a','d','revoke_kyc_verification'),('d','d','REVOKED, auteur et motif','self'),('a','s','Approuvée, valideur audité','ret'),('#close',),
  ('a','a','Niveau NONE à la recharge suivante','note')],
 note="Relu le 23/11/2026, non fusionné. Pièce expirée : niveau NONE sans tâche planifiée. Identification déjà révoquée : demande acceptée, exécution refusée (409, demande FAILED).\nLa règle de l’agent titulaire compare le numéro vérifié du compte au téléphone de l’agent ; limite consignée (agent sans numéro non détecté)."))
files.append(sequence('sequence-chaine-codes','Chaîne d’envoi des codes','Un seul code par défi, gardé en mémoire du processus ; les bascules ne comptent pas dans les limites',
 [P('f','App festivalier','data'),P('a','API','primary'),P('w','WhatsApp (faux)','accent'),P('p','SMS principal (faux)','accent'),P('b','SMS repli (faux)','accent')],
 [('f','a','Demander un code (AUTO)'),('a','a','Défi créé, code en mémoire','self'),('a','w','Envoyer le code'),
  ('#open','alt confirmé en 10 s'),('w','a','Livraison confirmée','ret'),('a','f','Code reçu par WhatsApp','ret'),
  ('#else','sinon 10 s écoulées ou sans WhatsApp'),('a','p','Même code par SMS'),
  ('#open','alt confirmé en 20 s'),('p','a','Livraison confirmée','ret'),
  ('#else','sinon 20 s écoulées'),('a','b','Même code par SMS de repli'),('b','a','Livraison confirmée ou non','ret'),('#close',),('#close',),
  ('a','a','Code effacé de la mémoire','self'),
  ('f','a','Demander un code (SMS)'),('a','p','Envoyer le code, sans WhatsApp')],
 note="Relu le 23/11/2026, non fusionné. Essais notés sans le code ; code gardé 35 s au plus : au plafond, la chaîne s’arrête sans repli (OP-N166) ; redémarrage : bascule perdue.\nLes trois faux refusent le démarrage en production ; l’en-tête X-Test-Otp-Code du faux reste jusqu’à la mission 12b (OP-N120)."))
files.append(sequence('sequence-rotation','Rotation du secret et réémission','Rotation immédiate : toute empreinte d’une ancienne version compte comme absente',
 [P('f','Festivalier','data'),P('a','API','primary'),P('d','Base'),P('c','Commande réémission','accent'),P('e','Exploitant','data')],
 [('e','a','Nouveau secret, version + 1'),('a','a','Redémarrage, version courante','self'),
  ('f','a','Ancien code (rattachement)'),('a','d','Empreinte, version courante'),('d','a','Aucune empreinte','ret'),('a','f','Même réponse qu’un code inconnu','bad'),
  ('e','c','reissue-claim-codes (lot)'),('c','d','reissue_claim_codes (claimadmin)'),
  ('d','d','Bracelets au code périmé ou absent','self'),('d','c','Nombre de codes réémis','ret'),
  ('c','c','Fichier rank,code,url,uid,printed_number (0600)','self'),('c','e','Fichier pour l’imprimeur','ret'),
  ('e','e','Étiquette posée sur le bracelet de l’UID','self'),('f','a','Nouveau code (rattachement)'),('a','d','Empreinte, version courante'),('d','a','Bracelet trouvé','ret'),('a','f','Bracelet rattaché','ret')],
 note="Relu le 23/11/2026, non fusionné. Rôle cashless_claimadmin (sans mot de passe en production, migrate.ts refuse) ; cashless_app n’a aucun droit sur la réémission.\nLes lots clos sont compris ; les bracelets dont le code courant a déjà servi sont ignorés ; aucun code en clair en base, au journal ni à la sortie standard."))
for f in files: print(r.render(f))
