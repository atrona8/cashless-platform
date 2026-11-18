# Diagrammes de la mission 11a (rendu du skill /illustre, police sans-serif).
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
    d=D(); d.text(60,30,1300,50,title,34,'#0F172A','left'); d.text(60,84,1800,34,sub,22,'#64748B','left'); d.box(1400,30,460,44,'Plan finalisé — non implémenté','decision','rectangle',20)
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
    d=D(); d.text(60,30,1300,50,title,34,'#0F172A','left'); d.text(60,84,1800,34,sub,22,'#64748B','left'); d.box(1400,30,460,44,'Plan finalisé — non implémenté','decision','rectangle',20)
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
T='Terminal (vendeur)'; B='Back-office (administrateur)'; S='Administrateur de site'; X='API compromise (menace)'
U1='Ouvrir une session (PIN)'; U2='Créer ou modifier un lot'; U3='Demander un remboursement (IBAN)'; U4='Décider un lot de versements'; U5='Inscrire une passerelle'
R1='Écrire un lot directement'; R2='Ouvrir une session sans PIN'; R3='Insérer une demande payée'
RED='#DC2626'
files.append(usecase('usecase-durcissements','Durcissements serveur hérités','Ce que chaque acteur peut faire, et ce que la base refuse à une API compromise',
 [T,B,S,X],
 [(U1,'primary'),(U2,'primary'),(U3,'primary'),(U4,'primary'),(U5,'primary'),(R1,'warn'),(R2,'warn'),(R3,'warn')],
 [(T,U1),(B,U2),(B,U3),(B,U4),(S,U5),(X,R1,RED),(X,R2,RED),(X,R3,RED)],
 note="Plan finalisé le 18/11/2026, non implémenté. Flèches rouges pointillées : tentatives refusées par la base.\nLe PIN n’est vérifié que par le processus vendor-pin ; les lots passent par des fonctions contrôlées.\nUne demande de remboursement ne naît qu’à son état initial ; l’IBAN est masqué au journal.\nL’inscription d’une passerelle rend le grand livre de l’événement ; les routes et réponses restent celles d’avant.",H=880))
files.append(sequence('sequence-pin-vendeur','Ouverture d’une session de vendeur','Seul le processus vendor-pin vérifie le PIN ; sans lui, l’API refuse, aucun repli',
 [P('t','Terminal','data'),P('a','API','primary'),P('p','Processus vendor-pin','accent'),P('d','Base')],
 [('t','a','POST /vendor-sessions (PIN)'),('a','p','Appel signé (HMAC, horodatage)'),
  ('#open','alt processus absent ou signature fausse'),('a','t','Refus, aucun repli','bad'),
  ('#else','sinon PIN juste'),('p','d','begin_vendor_pin_check (essai compté)'),('d','p','Empreinte du PIN','ret'),
  ('p','p','Vérification argon2','self'),('p','d','open_vendor_session + audit'),('p','a','Session ouverte','ret'),('a','t','200 : jeton de session','ret'),
  ('#else','sinon PIN faux'),('p','d','Essai compté, audit'),('a','t','Refus : même réponse qu’avant','bad'),('#close',)],
 note="Plan finalisé le 18/11/2026, non implémenté. Le rôle cashless_pin est le seul à lire l’empreinte ; l’API n’exécute plus ces fonctions.\nLimite nommée : l’API voit le PIN en transit."))
files.append(sequence('sequence-lot-bracelets','Lot de bracelets : fonction contrôlée ou refus','L’API n’écrit plus la table du lot ; une API compromise se heurte au refus de la base',
 [P('b','Back-office','data'),P('a','API','primary'),P('d','Base'),P('x','API compromise','neutral')],
 [('b','a','Créer un lot de bracelets'),('a','d','create_media_batch (DEFINER)'),
  ('d','d','Statut ORDERED imposé, auteur noté','self'),('d','a','Lot créé','ret'),('a','b','201 : même réponse qu’avant','ret'),
  ('x','d','INSERT direct dans media_batch'),('d','x','Refus 42501 : droit retiré','bad')],
 note="Plan finalisé le 18/11/2026, non implémenté. Mêmes garde-fous pour la modification d’un lot (colonnes en liste blanche, lot ORDERED seulement),\nle changement de statut et l’émission des codes de réclamation."))
for f in files: print(r.render(f))
