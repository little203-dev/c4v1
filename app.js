/* GinIQ app — touch-first. Tap a card to open two wheels (rank + suit); drag each
   wheel up/down to set. Pot/call steppers feed pot-odds. Nothing leaves the device. */
(function(){
const G=window.GINIQ;
const RANKS=['A','K','Q','J','T','9','8','7','6','5','4','3','2'];      // high -> low
const SUITS=[['s','\u2660',false],['h','\u2665',true],['d','\u2666',true],['c','\u2663',false]];
const ITEM=50; // px per wheel item (matches .wheel .item height)

const DEF=()=>({h:[{r:1,s:1},{r:1,s:2}],                                 // K hearts, K diamonds
  board:[{r:-1,s:0},{r:-1,s:0},{r:-1,s:0},{r:-1,s:0},{r:-1,s:0}],
  pos:'CO',bbs:30,pot:0,call:0,spot:'open',vstyle:'Balanced',vpos:'BTN',players:2});
let S=DEF();
let openCard=null; // {el, st, allowEmpty}

function haptic(ms){try{navigator.vibrate&&navigator.vibrate(ms||7);}catch(e){}}

/* ---------- state accessors: ALWAYS read/write the live S object by index ---------- */
function cardRef(kind,i){return kind==='h'?S.h[i]:S.board[i];}

/* ---------- closed card face ---------- */
function paintFace(el,st){
  el.classList.remove('open');
  el.classList.toggle('empty',st.r<0);
  el.classList.toggle('red',st.r>=0&&SUITS[st.s][2]);
  if(st.r<0){el.innerHTML=`<div class="face"><div class="fr">+</div></div>`;return;}
  const rank=RANKS[st.r],suit=SUITS[st.s][1];
  el.innerHTML=`<div class="corner tl">${rank}${suit}</div><div class="face"><div class="fr">${rank}</div><div class="fs">${suit}</div></div>`;
}

/* ---------- open card: two drag-wheels ---------- */
function openCardUI(el,kind,i,allowEmpty){
  if(openCard&&openCard.el!==el)closeCard();
  const st=cardRef(kind,i);
  openCard={el,kind,i,allowEmpty};
  el.classList.add('open','sel');
  el.classList.remove('empty','red');
  const rankItems=(allowEmpty?['\u2014',...RANKS]:RANKS.slice());
  const rankIndex=allowEmpty?(st.r<0?0:st.r+1):(st.r<0?0:st.r);
  el.innerHTML=
    `<div class="wheel" data-w="r"><div class="sel-band"></div><div class="track"></div></div>`+
    `<div class="wheel" data-w="s"><div class="sel-band"></div><div class="track"></div></div>`;
  const rWheel=el.querySelector('[data-w="r"]'), sWheel=el.querySelector('[data-w="s"]');
  buildWheel(rWheel, rankItems.map(x=>({t:x,red:false})), rankIndex, idx=>{
    const cur=cardRef(kind,i);                       // re-fetch live ref every change
    if(allowEmpty){cur.r = idx===0 ? -1 : idx-1;} else {cur.r=idx;}
    if(cur.r<0)cur.s=0;
  });
  const suitItems=SUITS.map(s=>({t:s[1],red:s[2]}));
  buildWheel(sWheel, suitItems, st.r<0?0:st.s, idx=>{
    const cur=cardRef(kind,i); if(cur.r<0)return; cur.s=idx;
  });
}
function closeCard(){
  if(!openCard)return;
  const {el,kind,i}=openCard; el.classList.remove('open','sel');
  paintFace(el,cardRef(kind,i)); openCard=null;
}

/* build a vertical drag-wheel; calls onPick(index) when the centered item changes.
   Smooth: during a drag we only move the track via rAF (no per-event class/onPick
   thrash). The selected item + haptic + onPick fire only when the integer index
   actually changes, and we snap on release. */
function buildWheel(wheel, items, startIdx, onPick){
  const track=wheel.querySelector('.track');
  track.innerHTML=items.map(it=>`<div class="item ${it.red?'red':''}">${it.t}</div>`).join('');
  const nodes=[...track.querySelectorAll('.item')];
  let idx=startIdx, dragY=null, baseOffset=0, moved=false;
  let curOffset=startIdx;     // fractional offset while dragging
  let raf=null, lastMarked=startIdx;

  const yFor=o=>`translateY(${-(o*ITEM)-ITEM/2}px)`;
  const mark=(i)=>{ // update which item looks selected (cheap; only on integer change)
    if(i===lastMarked)return;
    if(nodes[lastMarked])nodes[lastMarked].classList.remove('cur');
    if(nodes[i])nodes[i].classList.add('cur');
    lastMarked=i;
    haptic(5);
  };
  const settle=(animate)=>{
    track.style.transition=animate?'transform .16s cubic-bezier(.22,.61,.36,1)':'none';
    track.style.transform=yFor(idx);
    mark(idx);
  };
  // initial paint
  nodes.forEach((n,j)=>n.classList.toggle('cur',j===startIdx));
  track.style.transform=yFor(startIdx);

  const clamp=i2=>Math.max(0,Math.min(items.length-1,i2));
  const setIdx=(i2,animate)=>{i2=clamp(i2);const changed=i2!==idx;idx=i2;if(changed)onPick(idx);settle(animate);};

  const onMove=()=>{ // rAF tick — render current drag offset
    raf=null;
    track.style.transform=yFor(curOffset);
    mark(clamp(Math.round(curOffset)));
  };

  wheel.addEventListener('pointerdown',e=>{
    e.stopPropagation();
    dragY=e.clientY;baseOffset=idx;curOffset=idx;moved=false;
    wheel.setPointerCapture&&wheel.setPointerCapture(e.pointerId);
    track.style.transition='none';
    wheel.classList.add('dragging');     // CSS disables item transitions while dragging
  });
  wheel.addEventListener('pointermove',e=>{
    if(dragY===null)return;
    const dy=e.clientY-dragY; if(Math.abs(dy)>3)moved=true;
    // clamp the fractional offset with a touch of resistance at the ends
    curOffset=Math.max(-0.5,Math.min(items.length-0.5, baseOffset - dy/ITEM));
    if(!raf)raf=requestAnimationFrame(onMove);
  });
  const end=e=>{
    if(dragY===null)return;
    const wasDrag=moved; dragY=null;
    if(raf){cancelAnimationFrame(raf);raf=null;}
    wheel.classList.remove('dragging');
    if(!wasDrag){ // tap: top half up, bottom half down
      const r=wheel.getBoundingClientRect();
      setIdx(idx+((e.clientY-r.top)<r.height/2?-1:1),true);
    } else {
      setIdx(Math.round(curOffset),true);   // snap to nearest
    }
  };
  wheel.addEventListener('pointerup',end);
  wheel.addEventListener('pointercancel',()=>{if(raf){cancelAnimationFrame(raf);raf=null;}wheel.classList.remove('dragging');dragY=null;settle(true);});
  wheel.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();setIdx(idx+(e.deltaY>0?1:-1),true);},{passive:false});
}

/* ---------- bind a card element by index (clone-replace to drop any stale listeners) ---------- */
function bindCard(id,kind,i,allowEmpty){
  let el=document.getElementById(id);
  if(!el)return null;
  if(el.parentNode){                          // clone-replace to drop any stale listeners
    const fresh=el.cloneNode(false);
    el.parentNode.replaceChild(fresh,el);
    el=fresh;
  }
  paintFace(el,cardRef(kind,i));
  el.addEventListener('click',e=>{
    if(el.classList.contains('open'))return;  // wheel taps handled inside
    openCardUI(el,kind,i,allowEmpty);
  });
  return el;
}
/* tap outside an open card closes it (but not when tapping inside the open card) */
document.addEventListener('pointerdown',e=>{
  if(openCard && !openCard.el.contains(e.target))closeCard();
},true);

/* ---------- segmented selectors ---------- */
function buildSeg(id,options,current,onPick){
  const el=document.getElementById(id);
  el.innerHTML=options.map(o=>{const v=Array.isArray(o)?o[0]:o,l=Array.isArray(o)?o[1]:o;
    return `<button data-v="${v}" class="${v===current?'on':''}">${l}</button>`;}).join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{
    el.querySelectorAll('button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');haptic(6);onPick(b.dataset.v);});
}

/* ---------- numeric steppers ---------- */
function bindSteppers(){
  const lim={bbs:[1,500],pot:[0,2000],call:[0,2000]};
  const setv=(k,val)=>{const[mn,mx]=lim[k];S[k]=Math.max(mn,Math.min(mx,val));document.getElementById('v-'+k).textContent=S[k];haptic(6);};
  document.querySelectorAll('.stepper button').forEach(b=>{
    const k=b.dataset.k,d=+b.dataset.d;
    let t=null;
    const tick=()=>setv(k,S[k]+d*(k==='bbs'?1:1));
    b.addEventListener('click',tick);
    b.addEventListener('pointerdown',()=>{t=setInterval(()=>setv(k,S[k]+d*5),170);});
    ['pointerup','pointerleave','pointercancel'].forEach(ev=>b.addEventListener(ev,()=>{if(t){clearInterval(t);t=null;}}));
  });
}

/* ---------- init ---------- */
function init(){
  bindCard('h0','h',0,false);
  bindCard('h1','h',1,false);
  const boardEl=document.getElementById('board');
  const caps=['flop','flop','flop','turn','river'];
  boardEl.innerHTML=caps.map((c,i)=>`<div class="bcell"><div class="card" id="b${i}"></div><div class="bcap">${c}</div></div>`).join('');
  for(let i=0;i<5;i++)bindCard('b'+i,'b',i,true);
  buildSelectors();
  bindSteppers();
  document.getElementById('analyze').onclick=analyze;
  document.getElementById('reset').onclick=reset;
  syncCallVisibility();
}
const SPOTS=[['open','First to act'],['facing_raise','Facing raise'],['facing_3bet','Facing 3-bet'],['facing_jam','Facing all-in'],['facing_call','Facing call']];
const POSNS=['UTG','MP','LJ','HJ','CO','BTN','SB','BB'];
function buildSelectors(){
  buildSeg('pos',POSNS,S.pos,v=>S.pos=v);
  buildSeg('players',[[2,'Heads-up'],[3,'3-way'],[4,'4-way+']],S.players,v=>{S.players=+v;});
  buildSeg('spot',SPOTS,S.spot,v=>{S.spot=v;syncCallVisibility();});
  buildSeg('vstyle',['Unknown','Tight','Balanced','Loose','Maniac'],S.vstyle,v=>S.vstyle=v);
  buildSeg('vpos',POSNS,S.vpos,v=>S.vpos=v);
}
// "To call" only matters when facing a bet
function syncCallVisibility(){
  const show=['facing_raise','facing_3bet','facing_jam'].includes(S.spot);
  const el=document.getElementById('call-stepper');
  if(el)el.style.display=show?'':'none';
  if(!show){S.call=0;const v=document.getElementById('v-call');if(v)v.textContent='0';}
}
function reset(){
  closeCard();S=DEF();
  bindCard('h0','h',0,false);
  bindCard('h1','h',1,false);
  for(let i=0;i<5;i++)bindCard('b'+i,'b',i,true);
  ['bbs','pot','call'].forEach(k=>document.getElementById('v-'+k).textContent=S[k]);
  buildSelectors();
  syncCallVisibility();
  document.getElementById('out').innerHTML=`<div class="placeholder">Set your hand and tap <b style="color:var(--blu)">Analyze</b> to see the play.</div>`;
  haptic(12);
}
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600);}

function cardStr(st){return st.r<0?null:RANKS[st.r]+SUITS[st.s][0];}
function ocHTML(cards){return cards.map(c=>{const red=c[1]==='h'||c[1]==='d';return `<span class="oc ${red?'red':''}">${c[0]}${G.SUIT_SYM[c[1]]}</span>`;}).join('');}
function bigCards(str){return G.parseCards(str).map(c=>{const red=c[1]==='h'||c[1]==='d';return `<span class="oc ${red?'red':''}">${c[0]}${G.SUIT_SYM[c[1]]}</span>`;}).join(' ');}

function analyze(){
  closeCard();
  const c0=cardStr(S.h[0]),c1=cardStr(S.h[1]);
  const board=S.board.map(cardStr).filter(Boolean);
  const all=[c0,c1,...board];
  const dup=all.find((c,i)=>all.indexOf(c)!==i);
  if(dup){toast('Duplicate card: '+dup[0]+G.SUIT_SYM[dup[1]]+' — each card must be unique.');haptic(40);return;}
  if(board.length===1||board.length===2){toast('A board needs 0 (preflop), 3 (flop), 4 (turn) or 5 (river) cards.');haptic(40);return;}
  const btn=document.getElementById('analyze');btn.disabled=true;
  const out=document.getElementById('out');
  out.innerHTML=`<div class="placeholder"><span class="spinner"></span>Running ${board.length>=3?'range-vs-range':'preflop'} analysis…</div>`;
  const o={cards:c0+' '+c1,pos:S.pos,bbs:S.bbs,pot:S.pot,call:S.call,spot:S.spot,
           board:board.join(' '),vstyle:S.vstyle,vpos:S.vpos,players:S.players};
  setTimeout(()=>{
    let r;try{r=G.recommend(o);}catch(e){out.innerHTML=`<div class="placeholder">Error: ${e.message}</div>`;btn.disabled=false;return;}
    const eq=r.eq!=null?r.eq:null, po=r.potOdds;
    haptic(r.cls==='raise'?[10,40,10]:14);

    // ----- premium recommendation card -----
    const conf=Math.round((r.confidence||0)*100);
    const edge=r.evEdge!=null?r.evEdge:(eq!=null?eq-0.5:null);
    const edgeStr=(r.evEdge!=null)?((r.evEdge>=0?'+':'')+Math.round(r.evEdge*100)+'%'):'—';
    let html=`<div class="rec ${r.cls}">
      <div class="rec-top"><div class="verb">${r.verb}</div>
        <div class="badges">
          <div class="badge"><span class="bk">Confidence</span><span class="bv">${conf}%</span></div>
          ${r.evEdge!=null?`<div class="badge"><span class="bk">EV edge</span><span class="bv ${r.evEdge>=0?'g':'r'}">${edgeStr}</span></div>`:''}
        </div>
      </div>
      <div class="why">${r.why}</div>`;

    // key metrics grid
    const m=[];
    if(r.mode==='postflop'){
      m.push(['Equity',G.pct(r.eq),'']);
      if(po!=null)m.push(['Pot odds (need)',G.pct(po),'']);
      m.push(['Your hand',r.ranking,'']);
      if(r.outs&&r.outs.n)m.push(['Outs',r.outs.n+' \u00b7 '+G.pct(r.outs.hitPct),'']);
      m.push(['Villain range','top '+G.pct(r.vfrac),'']);
      if(r.players>2)m.push(['Players',r.players+'-way','']);
    }else{
      m.push(['Hand strength','top '+G.pct(r.hp),'']);
      m.push(['Chen score',r.sc+'/20','']);
      if(po!=null)m.push(['Pot odds (need)',G.pct(po),'']);
    }
    html+=`<div class="metrics">`+m.map(x=>`<div class="metric"><div class="k">${x[0]}</div><div class="v ${x[2]}">${x[1]}</div></div>`).join('')+`</div>`;

    // equity bar with pot-odds marker
    if(eq!=null){
      html+=`<div class="barwrap"><i style="width:${Math.round(eq*100)}%"></i>${po!=null?`<span class="po" style="left:${Math.round(po*100)}%"></span>`:''}</div>`;
      html+=`<div class="conf">${r.n?`\u00b1${Math.round((r.conf[1]-r.conf[0])/2*100)}% (95% CI, ${r.n} sims)`:'preflop chart'}${po!=null?` \u00b7 vertical mark = price you need (${G.pct(po)})`:''}</div>`;
    }
    html+=`</div>`; // close rec

    // ----- detail drawer -----
    html+=`<details class="drawer"><summary>Detail breakdown</summary><div class="drawer-body">`;
    if(r.mode==='postflop'){
      // equity breakdown
      html+=`<div class="dsec"><div class="dlab">Equity breakdown</div>
        <div class="wtl"><span class="w">Win ${G.pct(r.win)}</span><span class="t">Tie ${G.pct(r.tie)}</span><span class="l">Lose ${G.pct(r.lose)}</span></div>
        <div class="wtlbar"><i style="width:${Math.round(r.win*100)}%" class="bw"></i><i style="width:${Math.round(r.tie*100)}%" class="bt"></i><i style="width:${Math.round(r.lose*100)}%" class="bl"></i></div></div>`;
      // pot odds breakdown
      if(po!=null){
        const ahead=eq>=po;
        html+=`<div class="dsec"><div class="dlab">Pot odds</div>
          <div class="prow"><span>Need</span><b>${G.pct(po)}</b></div>
          <div class="prow"><span>Have</span><b>${G.pct(eq)}</b></div>
          <div class="prow ${ahead?'g':'r'}"><span>Edge</span><b>${(eq-po>=0?'+':'')}${Math.round((eq-po)*100)}%</b></div></div>`;
      }
      // outs
      if(r.outs&&r.outs.cards.length)
        html+=`<div class="dsec"><div class="dlab">Clean outs (${r.outs.n})</div><div>${ocHTML(r.outs.cards)}</div></div>`;
    }
    // range list
    if(r.rangeTop&&r.rangeTop.length){
      const list=r.rangeTop.slice(0,28);
      html+=`<div class="dsec"><div class="dlab">Villain range \u00b7 top ${G.pct(r.vfrac||r.rangeTop.length/169)}</div>
        <div class="rngwrap">${list.map(k=>`<span class="rk">${k}</span>`).join('')}${r.rangeTop.length>28?`<span class="rk more">+${r.rangeTop.length-28}</span>`:''}</div></div>`;
    }
    html+=`</div></details>`;

    // ----- scrollable summary -----
    let summ=`<div class="summary">`;
    const row=(k,v,cls)=>`<div class="row"><span class="k">${k}</span><span class="val ${cls||''}">${v}</span></div>`;
    summ+=row('Hand',bigCards(c0+' '+c1));
    if(board.length)summ+=row('Board',bigCards(board.join(' ')));
    summ+=row('Position',S.pos+(r.players>2?` \u00b7 ${r.players}-way`:''));
    summ+=row('Situation',{open:'First to act',facing_raise:'Facing a raise',facing_3bet:'Facing a 3-bet',facing_jam:'Facing an all-in',facing_call:'Facing a call'}[S.spot]);
    summ+=row('Stack',S.bbs+' BB');
    summ+=row('Pot',S.pot+' BB');
    if(po!=null)summ+=row('To call',S.call+' BB');
    if(eq!=null)summ+=row('Equity',G.pct(eq));
    if(po!=null){
      summ+=row('Pot odds',G.pct(po));
      const ahead=eq>=po;
      summ+=row('Equity vs pot odds', ahead?`${G.pct(eq)} \u2265 ${G.pct(po)} \u00b7 +EV`:`${G.pct(eq)} < ${G.pct(po)} \u00b7 \u2212EV`, ahead?'g':'r');
    }
    summ+=`</div>`;
    out.innerHTML=html+summ;
    btn.disabled=false;
  },45);
}

if(document.readyState!=='loading')init();else document.addEventListener('DOMContentLoaded',init);
})();
