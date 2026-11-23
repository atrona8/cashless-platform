# Diagrammes de la mission 9c (rendu du skill /illustre, police sans-serif).
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
    d=D(); d.text(60,30,1300,50,title,34,'#0F172A','left'); d.text(60,84,1800,34,sub,22,'#64748B','left'); d.box(1400,30,460,44,'Relu le 23/11/2026 — non fusionnée','decision','rectangle',20)
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
    d=D(); d.text(60,30,1300,50,title,34,'#0F172A','left'); d.text(60,84,1800,34,sub,22,'#64748B','left'); d.box(1400,30,460,44,'Relu le 23/11/2026 — non fusionnée','decision','rectangle',20)
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
files.append(usecase('usecase-rendu-partiel','Rendu partiel en espèces : qui décide, qui rend','Le prestataire autorise, l’organisateur active, le caissier rend, une seconde personne valide au-delà du seuil',
 ['Prestataire (admin)','Organisateur (admin)','Caissier ou superviseur','Seconde personne (sur place)'],
 [('Autoriser la fonction pour ses organisateurs','primary'),('Activer ou désactiver pour un événement','primary'),('Rendre une partie du solde payé','primary'),('Refus avec motif distinct','warn'),('Valider le cumul du jour au-dessus du seuil','accent')],
 [('Prestataire (admin)','Autoriser la fonction pour ses organisateurs'),('Organisateur (admin)','Activer ou désactiver pour un événement'),
  ('Caissier ou superviseur','Rendre une partie du solde payé'),('Caissier ou superviseur','Refus avec motif distinct'),('Seconde personne (sur place)','Valider le cumul du jour au-dessus du seuil')],
 note="Relue le 23/11/2026 (6 lots approuvés), non fusionnée. Refusée par défaut aux deux niveaux ; l’organisateur n’active que si le prestataire autorise.\nLe cumul du jour est celui du portefeuille (tous ses bracelets). Le bracelet reste actif ; crédits offerts et caution inchangés.",H=760))
files.append(sequence('sequence-rendu-partiel','Rendu partiel au guichet','Verrou du solde payé, cumul du jour lu sous verrou, frais du moteur, espèces sorties de la caisse',
 [P('c','Caissier','data'),P('s','Seconde personne','data'),P('a','API','primary'),P('d','Base')],
 [('c','a','Rendre N (tap_id, clé, montant)'),('a','a','Bracelet actif ? EDGE ? réglages ? session OPEN ?','self'),('#open','alt fonction non permise'),('a','c','422 REFUND_NOT_ALLOWED, rien d’écrit','bad'),('#close',),
  ('a','d','Verrous : bracelet puis solde payé'),('a','a','Cumul du jour UTC du portefeuille + N, sous verrou','self'),
  ('#open','alt cumul au-dessus du seuil'),('a','c','403 APPROVAL_REQUIRED, rien d’écrit','bad'),('s','c','Jeton sur place','ret'),('c','a','Rejouer avec le jeton'),('#close',),
  ('a','d','WALLET_REFUND brut, frais, net en caisse'),('a','c','201 : espèces remises, solde payé restant','ret')],
 note="Relue le 23/11/2026, non fusionnée. Même clé : même réponse. Coupure (EDGE) : 409. Solde payé insuffisant : 422. Phase DRAFT : 422. Bracelet gardé actif."))
files.append(sequence('sequence-reglages','Réglages : le prestataire autorise, l’organisateur active','Refusé par défaut ; contrôlé de nouveau à chaque rendu',
 [P('o','Prestataire','data'),P('g','Organisateur','data'),P('a','API','primary'),P('d','Base')],
 [('o','a','Version de configuration : cash_partial_refund_allowed'),('a','d','Clé de cascade enregistrée'),
  ('g','a','updateEvent : cash_partial_refund_enabled = true'),('a','a','Autorisation du prestataire résolue ?','self'),
  ('a','g','Non autorisé : 422 VALIDATION_FAILED','bad'),('a','d','Colonne de l’événement enregistrée, audit'),('a','g','200 : activé','ret'),
  ('a','a','À chaque rendu : les deux réglages résolus doivent être vrais','note')],
 note="Relue le 23/11/2026, non fusionnée. En LIVE, le changement suit l’opération à deux personnes existante (EVENT_SETTINGS_CHANGE), revérifiée à l’approbation.\nRetrait de l’autorisation : le rendu suivant est refusé."))
for f in files: print(r.render(f))
