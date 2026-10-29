# Diagrammes transverses de docs/05 (rendu du skill /illustre, police sans-serif).
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
            d.text(L+10,y-26,len(m[1])*10+20,28,m[1],18,'#64748B','left')
            continue
        a,b,lab=m[0],m[1],m[2]; style=m[3] if len(m)>3 else 'call'
        col={'call':'#0047CC','ret':'#047857','bad':'#DC2626'}.get(style,'#0047CC')
        if style=='note':
            x1,x2=min(cx[a],cx[b]),max(cx[a],cx[b]); w=max(x2-x1+120,len(lab)*10+40)
            d.box((x1+x2)/2-w/2,y-30,w,56,lab,'decision','rectangle',19)
        elif a==b:
            sw=max(300,len(lab)*10+40); d.box(cx[a]-sw/2,y-30,sw,56,lab,'warn' if style=='bad' else ('neutral' if style=='self' else 'decision'),'rectangle',19)
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
files.append(sequence('sequence-terminal-transverse','Enrôlement et requête signée d’un terminal','Du code d’enrôlement à la première requête servie (mission « Identité et enrôlement des terminaux »)',
 [P('x','Admin','data'),P('t','Terminal','data'),P('a','API publique','primary'),P('c','Autorité, attestation','accent'),P('b','Base centrale')],
 [('x','a','Émettre un code (événement)'),('a','x','Code affiché une fois','ret'),('t','a','Code, clés, attestations, CSR'),('a','c','Vérifier, émettre le certificat'),('a','b','enroll_device + audit'),('a','t','Certificat, jetons, next_seq','ret'),('t','a','Requête : mTLS + jeton + signature'),('a','b','Terminal, famille, nonce'),('a','t','Réponse (403 si révoqué)','ret')],
 note="Détail des quatre flux (enrôlement, requête, rafraîchissement, révocation) : sequence.md de la mission."))

SRC="Flux de docs/05-sequence-diagrams.md, redessiné avec /illustre le 27/10/2026 (contenu identique à l’ancien Mermaid)"
V=lambda k,l:(k,l,'data'); 
files.append(sequence('sequence-paiement-en-ligne','Paiement en ligne par bracelet (un seul aller-retour, §7.6)',SRC,
 [V('v','Vendeur'),P('t','Terminal'),P('br','Bracelet'),P('a','API','primary'),P('d','Base centrale')],
 [('v','t','Saisit le montant'),('t','br','UID, page 4, READ_SIG'),('t','t','PWD et PACK (snapshot ou auth-keys)','self'),
  ('t','a','auth-keys : processus des clés, distinct de l’API publique','note'),
  ('t','br','PWD_AUTH, lecture, INCR_CNT'),('t','a','POST /payments (lecture, seq, signé)'),('a','d','register_tap'),('a','d','post_transaction (PURCHASE)'),('a','d','consume_tap'),
  ('d','a','Transaction validée','ret'),('a','t','201 Payé','ret'),('t','v','Succès affiché','ret')]))
files.append(sequence('sequence-vente-hors-ligne','Vente hors ligne puis synchronisation (§9.3 à §9.6)',SRC,
 [V('v','Vendeur'),P('t','Terminal'),P('a','API','primary'),P('d','Base centrale')],
 [('t','t','Réseau coupé','note'),('v','t','Encaisse'),('t','t','Contrôle snapshot et plafonds','self'),('t','t','Journal local (fsync)','self'),('t','t','Réseau revenu','note'),
  ('t','a','POST /offline-batches (lot signé, chaîné)'),('a','d','open_offline_batch'),('#open','loop Chaque opération, dans l’ordre des seq'),
  ('a','d','post_transaction (OFFLINE_SYNC)'),('d','d','Part non couverte en S-ATTENTE','note'),('#close',),
  ('a','d','complete_offline_batch'),('a','t','Résultat par opération','ret')]))
files.append(sequence('sequence-bascule-passerelle','Bascule vers la passerelle et retour (§9.7)',SRC,
 [P('g','Passerelle'),P('a','API','primary'),P('d','Base centrale'),P('t','Terminal')],
 [('g','a','Demande d’autorité'),('a','d','grant_edge_authority (époque +1)'),('a','g','Autorité accordée','ret'),('g','a','ack du handover'),
  ('g','t','Coupure internet','note'),('t','g','Paiements (LAN)'),('g','a','Internet revenu','note'),
  ('g','a','POST /edge/handovers/{id}/release'),('g','a','POST /edge/sync-batches (EDGE_SYNC)'),('a','d','record_edge_seq, post_transaction'),
  ('a','d','complete_edge_release (époque +1)'),('a','g','Autorité rendue au central','ret')]))
files.append(sequence('sequence-recharge-mobile-money','Recharge mobile money (§8.5, §11.1)',SRC,
 [V('f','Festivalier'),P('p','App festivalier'),P('a','API','primary'),P('s','PSP','accent'),P('d','Base centrale')],
 [('f','p','Recharge 20 000 XOF'),('p','a','POST /topups/psp'),('a','s','Initie le paiement'),('s','p','Validation par le client','ret'),('s','a','Webhook signé'),
  ('a','a','Vérifie la signature, stocke brut','self'),('a','d','post_transaction (TOPUP, frais PSP)'),('a','d','take_deposit si caution due'),('a','s','200','ret'),
  ('p','a','GET /topups/psp/{id}'),('a','p','Recharge réussie','ret')]))
files.append(sequence('sequence-double-validation','Double validation au back-office (§3.2)',SRC,
 [V('u','Auteur'),V('w','Valideur'),P('b','Back-office'),P('a','API','primary'),P('d','Base centrale')],
 [('u','b','Lance une action à deux'),('b','a','Appel de l’opération'),('a','d','Crée approval_request (24 h)'),('a','b','202 demande PENDING','ret'),
  ('w','b','Ouvre la demande'),('b','a','POST /approval-requests/{id}/approve'),('a','d','decide_approval_request (valideur ≠ auteur)'),
  ('a','d','Exécute l’action une fois'),('a','b','Demande EXECUTED','ret')]))
files.append(sequence('sequence-cloture-evenement','Clôture d’un événement (§12.1)',SRC,
 [V('o','Organisateur'),P('b','Back-office'),P('a','API','primary'),P('d','Base centrale')],
 [('o','b','Passe à l’étape suivante'),('b','a','Vérifie caisses, PSP, terminaux'),('a','d','set_event_status'),('d','d','Verrous, conditions calculées','self'),
  ('#open','alt Condition non remplie'),('d','a','CL019 (condition nommée)','ret'),('a','b','Liste des conditions','ret'),
  ('#else','else Conditions remplies'),('d','d','Statut des grands livres','self'),('d','a','Statut changé','ret'),('a','b','Nouveau statut','ret'),('#close',)]))
spec=importlib.util.spec_from_file_location('r',RENDER); r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
r._FONT_FAMILY="Helvetica Neue, Helvetica, Arial, sans-serif"; r._font_face_css=lambda: ""
for f in files: print(r.render(f))
