# Diagrammes de la mission 9a (rendu du skill /illustre, police sans-serif).
# Usage : python3 generate.py <dossier de sortie> <render_excalidraw.py>
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
files.append(usecase('usecase-remboursement','Remboursements : festivalier et back-office','Qui demande, qui décide, qui approuve, qui confirme le paiement',
 ['Festivalier','Titulaire (numéro vérifié)','Back-office : auteur','Back-office : valideur','Back-office : confirmeur'],
 [('Demander un remboursement','primary'),('Suivre mes demandes','primary'),('Confirmer ou bloquer (lien reçu)','accent'),('Lister et refuser une demande','neutral'),('Proposer l’approbation','primary'),('Approuver à deux','accent'),('Confirmer le paiement (PAID, FAILED)','primary')],
 [('Festivalier','Demander un remboursement'),('Festivalier','Suivre mes demandes'),('Titulaire (numéro vérifié)','Confirmer ou bloquer (lien reçu)'),
  ('Back-office : auteur','Lister et refuser une demande'),('Back-office : auteur','Proposer l’approbation'),('Back-office : confirmeur','Confirmer le paiement (PAID, FAILED)'),
  ('Back-office : valideur','Approuver à deux')],
 note="Livré (review du 16/11/2026). Le valideur est une autre personne que l’auteur et que le demandeur. Le paiement Wave ou Orange Money est fait hors système.\nPAID : toute personne habilitée. FAILED : refusé à l’auteur et au valideur (403), donc un troisième administrateur. Le titulaire décide par le lien reçu avec son code.",H=860))
files.append(usecase('usecase-guichet','Guichet de retour : restituer et solder','Un seul appel, dans l’ordre imposé : caution, crédits offerts, solde payé, espèces dues, restitution',
 ['Caissier','Superviseur'],
 [('Restituer et solder le bracelet','primary'),('Rendre le solde payé en espèces','primary'),('Rendre les espèces dues','neutral'),('Approuver sur place (cumul)','accent')],
 [('Caissier','Restituer et solder le bracelet'),('Caissier','Rendre le solde payé en espèces'),('Caissier','Rendre les espèces dues'),('Superviseur','Approuver sur place (cumul)')],
 note="Livré (review du 16/11/2026). Le plafond porte sur le total des espèces qui sortent (caution, solde payé, espèces dues) : au-delà, jeton d’une seconde personne.\nTout ou rien : un refus à une étape n’écrit rien ; le rejeu avec la même clé rend la même réponse.",H=620))
files.append(sequence('sequence-demande-approbation','Demande, approbation à deux, confirmation du paiement','Le grand livre sort l’argent à l’approbation ; le paiement est fait hors système puis confirmé',
 [P('f','Festivalier','data'),P('a','API','primary'),P('d','Base'),P('b1','Back-office auteur','data'),P('b2','Back-office valideur','data'),P('b3','Confirmeur tiers','data')],
 [('f','a','Demander (numéro vérifié, clé)'),('a','d','Éligibilité, frais, demande REQUESTED'),('a','f','201 : montant estimé','ret'),('a','f','Sinon (fenêtre close, solde nul) : 422','bad'),
  ('b1','a','Approuver la demande'),('a','d','Approbation WALLET_REFUND PENDING'),('a','b1','202 : en attente','ret'),
  ('b2','a','Approuver (autre personne)'),('a','d','Écriture WALLET_REFUND, PROCESSING'),('a','b2','Confirmer FAILED par le valideur : 403','bad'),('b3','a','Confirmer PAID + référence ou FAILED + motif'),('a','d','FAILED : REVERSAL, solde recrédité'),('a','b3','200 : PAID ou FAILED','ret')],
 note="Approbation : même personne que l’auteur ou le demandeur, refus. FAILED : refusé à l’auteur et au valideur (403). Autorité EDGE : 409. PAID n’écrit rien. Livré (16/11/2026)."))
files.append(sequence('sequence-autre-numero','Autre numéro : décision du titulaire et échéance','Le code du nouveau numéro prouve qu’il existe ; le titulaire peut bloquer jusqu’à l’échéance',
 [P('f','Festivalier','data'),P('a','API','primary'),P('t','Titulaire','data'),P('d','Base et maintenance')],
 [('f','a','Demander vers un autre numéro + code'),('a','f','Compte sans identité vérifiée : 422','bad'),('a','d','Vérifier et consommer le code du numéro'),('a','d','AWAITING_HOLDER, échéance hold_until'),('a','t','Code et lien (demande, défi) envoyés','ret'),
  ('#open','alt le titulaire répond avant l’échéance'),('t','a','Décision CONFIRM ou BLOCK + code (lien)'),('a','d','CONFIRM : REQUESTED ; BLOCK : BLOCKED'),
  ('#else','sinon : aucune réponse'),('d','d','Échéance atteinte : REQUESTED','self'),('#close',),
  ('a','f','Montant au-delà du seuil : identité à noter','note')],
 note="Sans identité vérifiée : refus 422, jamais REQUESTED directement. Après l’échéance, le titulaire ne peut plus bloquer (409). Livré (16/11/2026)."))
files.append(sequence('sequence-guichet-retour','Guichet de retour enchaîné','Une seule transaction, dans l’ordre imposé ; jeton sur place au-delà du plafond',
 [P('c','Caissier','data'),P('s','Superviseur','data'),P('a','API','primary'),P('d','Base')],
 [('c','a','Restituer le bracelet, solder le solde'),('a','a','Session de caisse ; cumul des espèces avant toute écriture','self'),
  ('#open','alt cumul des espèces au-delà du plafond'),('a','c','403 : approbation requise','bad'),('s','c','Jeton sur place','ret'),('c','a','Rejouer avec le jeton'),('#close',),
  ('a','d','Caution, crédits offerts, solde payé, espèces dues'),('a','d','Restitution : bracelet RELEASED'),('a','c','200 : espèces à remettre','ret')],
 note="Cumul = caution en espèces + solde payé + espèces dues. Tout ou rien : un refus à une étape n’écrit rien ; rejeu avec la même clé : même réponse. Livré (16/11/2026)."))
for f in files: print(r.render(f))
