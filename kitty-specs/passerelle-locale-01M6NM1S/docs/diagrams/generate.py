# Diagrammes de la mission 8 (rendu du skill /illustre, police sans-serif fontFamily 2).
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
files.append(usecase('usecase-admin','Passerelle : pilotage par les personnes','Qui inscrit, qui bascule, qui rend, qui reprend la main',
 ['Opérateur (outil admin)','Admin prestataire','Second admin prestataire','Responsable'],
 [('Inscrire une passerelle','primary'),('Demander la bascule','primary'),('Abandonner une bascule','warn'),('Demander le rendu','primary'),('Reprise forcée (à deux)','accent'),('Purger les secrets du site (à deux)','accent'),('Voir l’autorité et l’époque','neutral'),('Recevoir les alertes','neutral')],
 [('Opérateur (outil admin)','Inscrire une passerelle'),('Admin prestataire','Demander la bascule'),('Admin prestataire','Abandonner une bascule'),('Admin prestataire','Demander le rendu'),('Admin prestataire','Reprise forcée (à deux)'),('Admin prestataire','Voir l’autorité et l’époque'),
  ('Second admin prestataire','Reprise forcée (à deux)'),('Second admin prestataire','Purger les secrets du site (à deux)'),('Admin prestataire','Purger les secrets du site (à deux)'),('Responsable','Recevoir les alertes'),('Responsable','Voir l’autorité et l’époque')],
 note="Bascule demandée par un admin, avec le lien, jamais prise par la passerelle (décision du 05/11/2026). Inscription par une personne : alerte immédiate, délai de 30 min avant les mots de passe.\nReprise forcée : constat physique déclaré, seconde personne obligatoire, certificat révoqué. Purge des secrets aussi à la clôture de l’événement.\nAucune route d’inscription dans le contrat public : l’outil d’administration agit hors API.",H=860))
files.append(usecase('usecase-site','Passerelle : le site pendant la coupure','Terminal, guichet, passerelle de secours',
 ['Terminal / vendeur','Caissier de guichet','Terminal hors ligne','Passerelle de secours'],
 [('Vendre sur la passerelle','primary'),('Annuler, lire un solde','primary'),('Recharger en espèces','accent'),('Activer, prendre une caution','accent'),('Renouveler son jeton','neutral'),('Lire l’accusé du central','neutral'),('Envoyer un lot hors ligne','primary'),('Refus : opération non servie','warn'),('Refus : débit d’une STANDBY','warn')],
 [('Terminal / vendeur','Vendre sur la passerelle'),('Terminal / vendeur','Annuler, lire un solde'),('Terminal / vendeur','Renouveler son jeton'),('Terminal / vendeur','Lire l’accusé du central'),('Terminal / vendeur','Refus : opération non servie'),
  ('Caissier de guichet','Recharger en espèces'),('Caissier de guichet','Activer, prendre une caution'),('Terminal hors ligne','Envoyer un lot hors ligne'),('Passerelle de secours','Refus : débit d’une STANDBY')],
 note="Les 16 opérations marquées x-edge-available, avec les formats et erreurs du central. Recharge espèces : session de caisse ouverte et répliquée avant la bascule seulement.\nCaution sur solde, remboursement, restitution, QR : 409 DEBIT_AUTHORITY_EDGE. TOPUP_CASH dans un lot de terminal : toujours rejeté.",H=880))
files.append(sequence('sequence-bascule','Bascule : le central cède, la passerelle accuse','Une seule autorité à tout instant ; la passerelle ne débite qu’après la réponse 200',
 [P('a','Admin','data'),P('c','API centrale','primary'),P('b','Base centrale'),P('g','Passerelle','accent'),P('t','Terminal','data')],
 [('a','c','Demander la bascule'),('c','b','Accorder (époque +1, filigrane)'),('c','a','202 : GRANTED','ret'),('c','t','Débit central : 409 DEBIT_AUTHORITY_EDGE','bad'),
  ('g','c','Attente longue : accord reçu','ret'),('g','g','Rattraper jusqu’au filigrane','self'),('g','c','Accuser (époque, filigrane atteint)'),('c','b','Vérifier, passer en ACTIVE'),('c','g','200 : débit permis','ret'),('g','g','Persister, puis débiter','self'),
  ('t','g','Rejouer la vente (même clé, époque e)'),('g','t','Vente acceptée','ret')],
 note="Accusé avant le filigrane : refusé, aucun débit. Bascule non accusée : abandon par fail_edge_grant, l’autorité revient au central. La passerelle n’appelle jamais set_debit_authority."))
files.append(sequence('sequence-vente','Vente sur la passerelle','Décision locale, entrée numérotée et chaînée, écrite avant la réponse',
 [P('t','Terminal','data'),P('g','Passerelle','accent'),P('l','Base locale'),P('r','Règles partagées','neutral')],
 [('t','g','Payer (trois preuves, époque e)'),('g','g','Vérifier preuves, état, époque','self'),('g','t','Époque supérieure : 409 STALE','bad'),
  ('g','r','Appliquer les règles de la vente'),('r','g','Montants, décision','ret'),('g','g','Solde effectif = central + deltas','self'),('g','t','Solde insuffisant ou bloqué : refus','bad'),
  ('g','l','Entrée edge_seq + chaîne + delta (une transaction)'),('l','g','Validé','ret'),('g','t','Vente acceptée','ret')],
 note="Aucune réponse avant l’écriture persistée. Époque supérieure confirmée ou plausible (au plus +2) : arrêt persistant des débits ; époque forgée très supérieure : refus sans arrêt, alerte."))
files.append(sequence('sequence-rendu','Rendu : la file revient au central, dans l’ordre','RELEASING persisté avant tout ; le central vérifie la continuité puis reprend l’autorité',
 [P('a','Admin','data'),P('c','API centrale','primary'),P('b','Base centrale'),P('g','Passerelle','accent'),P('t','Terminal','data')],
 [('a','c','Demander le rendu'),('c','b','RELEASE_REQUESTED'),('g','c','Attente longue : demande reçue','ret'),('g','g','Persister RELEASING','self'),('t','g','Nouveau débit : 409 DEBIT_AUTHORITY_MOVING','bad'),
  ('#open','loop Vider la file, un lot en vol'),('g','c','Lot EDGE_SYNC (500 opérations, 1 Mio au plus)'),('c','b','Rejouer en EDGE_SYNC, registre'),('c','g','Résultat par opération','ret'),('#close',),
  ('g','c','Rendu final (dernier numéro, dernière chaîne)'),('c','b','Continuité ?'),('c','g','409 EDGE_NOT_CAUGHT_UP : reprendre le vidage','bad'),('c','b','COMPLETED, autorité = central'),('c','g','200 : rendu accepté','ret')],
 note="Chaîne incohérente : 409 CHAIN_BROKEN, alerte, examen manuel. Opération déjà reçue du terminal : DUPLICATE. RELEASING redémarré : pas de reprise des débits."))
files.append(sequence('sequence-reprise','Reprise forcée à deux, passerelle perdue','Constat physique, deux personnes, certificat révoqué, journal des terminaux',
 [P('a','Admin 1','data'),P('b2','Admin 2','data'),P('c','API centrale','primary'),P('d','Base centrale'),P('t','Terminal','data')],
 [('a','c','Reprise forcée (constat physique déclaré)'),('c','d','Demande FORCE_CENTRAL_AUTHORITY'),('c','a','202 : en attente d’une seconde personne','ret'),('a','c','Même personne : refus','bad'),
  ('b2','c','Approuver'),('c','d','Révoquer le certificat, époque +1, FORCED'),('c','b2','Autorité = central','ret'),
  ('t','c','Renvoyer le journal non acquitté'),('c','d','Écrire une fois, par la clé du terminal'),('c','d','Référence inconnue : anomalie EDGE_REPLAY_FAILED','bad'),('c','t','Résultats','ret')],
 note="Activations et cautions perdues : pas de rejeu automatique (le contrat l’interdit), espèces en attente, résolution à deux. Passerelle zombie : risque du protocole."))
spec=importlib.util.spec_from_file_location('r',RENDER); r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
r._FONT_FAMILY="Helvetica Neue, Helvetica, Arial, sans-serif"; r._font_face_css=lambda: ""
for f in files: print(r.render(f))
