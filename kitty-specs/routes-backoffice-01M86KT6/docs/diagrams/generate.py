# Diagrammes de la mission 11b (rendu du skill /illustre, police sans-serif).
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
    d=D(); d.text(60,30,1300,50,title,34,'#0F172A','left'); d.text(60,84,1800,34,sub,22,'#64748B','left'); d.box(1400,30,460,44,'Plan finalisé — à valider','decision','rectangle',20)
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
    d=D(); d.text(60,30,1300,50,title,34,'#0F172A','left'); d.text(60,84,1800,34,sub,22,'#64748B','left'); d.box(1400,30,460,44,'Plan finalisé — à valider','decision','rectangle',20)
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
files.append(usecase('usecase-routes-backoffice','Routes du back-office : qui lit, qui classe, qui cherche','Lectures cloisonnées par prestataire et par portée ; aucune écriture au grand livre',
 ['Personnel connecté','Administrateur (portée)','Superviseur ou administrateur','Administrateur plateforme'],
 [('Savoir qui je suis et ce que je peux faire','primary'),('Lister et ouvrir les ventes','primary'),('Lister et classer les anomalies','primary'),('Retrouver un bracelet ou un portefeuille','primary'),('Chercher un festivalier par numéro exact','accent'),('Tenir les modèles de téléphone','second')],
 [('Personnel connecté','Savoir qui je suis et ce que je peux faire'),('Administrateur (portée)','Lister et ouvrir les ventes'),('Administrateur (portée)','Lister et classer les anomalies'),
  ('Personnel connecté','Retrouver un bracelet ou un portefeuille'),('Superviseur ou administrateur','Chercher un festivalier par numéro exact'),('Administrateur plateforme','Tenir les modèles de téléphone')],
 note="Plan finalisé le 24/11/2026, rien n’est codé ; ajouts au contrat A1 à A6 et décisions D4, D7, D9, D10 à valider par le porteur.\nLe classement ne touche jamais au grand livre. La recherche par numéro refuse vendeurs et caissiers, exige le numéro exact, masque le numéro et laisse une trace sans lui.",H=800))
files.append(sequence('sequence-classement-anomalie','Classer une anomalie, sans écriture d’argent','Fonction de la base : types classables tenus en base, un seul classement gagne',
 [P('g','Administrateur','data'),P('a','API','primary'),P('d','Base')],
 [('g','a','Classer (anomalie, motif, clé)'),('a','a','Anomalie dans ma portée ? sinon 404','self'),('a','d','classify_anomaly (verrou de ligne)'),
  ('#open','alt type non classable, ou déjà traitée'),('a','g','422 ANOMALY_KIND_NOT_CLASSIFIABLE ou 409 CONFLICT_STATE','bad'),('#close',),
  ('d','d','OPEN vers RESOLVED, sans resolution_tx_id','self'),('a','a','Audit ANOMALY_CLASSIFIED (auteur, motif)','self'),('a','g','200 : anomalie traitée','ret')],
 note="Plan finalisé le 24/11/2026, à valider (D1, D4, D10). Le droit direct de clore une anomalie est retiré à l’application (ou gardé par un déclencheur). Aucune ligne au grand livre."))
files.append(sequence('sequence-recherche-numero','Recherche d’un festivalier par numéro exact','POST, numéro jamais dans l’URL ; numéro masqué en réponse ; audit sans le numéro',
 [P('p','Personnel autorisé','data'),P('a','API','primary'),P('d','Base')],
 [('p','a','POST /search/customers (numéro E.164)'),('a','a','Rôle admin ou superviseur ? sinon 403','self'),
  ('a','d','Recherches de la minute (audit)'),('#open','alt plus de 20 en une minute'),('a','p','429 RATE_LIMITED, refus audité','bad'),('#close',),
  ('a','d','Égalité exacte, portée de l’appelant'),('a','a','Masquer le numéro, garder les portefeuilles de la portée','self'),
  ('a','d','Audit : auteur, portée, nombre, clients (jamais le numéro)'),('a','p','200 : portefeuilles et bracelets, numéro masqué','ret')],
 note="Plan finalisé le 24/11/2026, à valider (D7, D8). Numéro incomplet : résultat vide ; numéro non vérifié ou hors portée : introuvable sans indice."))
for f in files: print(r.render(f))
