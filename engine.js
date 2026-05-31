/* GinIQ engine — 100% local. Range-aware Monte Carlo equity, exact outs,
   GTO-based preflop range charts, and a calibrated recommendation.
   No network, no GTO solver claim: this is equity-vs-range + charts + heuristics. */

const RANKS="23456789TJQKA";
const RV={}; for(let i=0;i<RANKS.length;i++)RV[RANKS[i]]=i+2;
const SUITS="cdhs";
const SUIT_SYM={c:'♣',d:'♦',h:'♥',s:'♠'};

function deck(){const d=[];for(const r of RANKS)for(const s of SUITS)d.push(r+s);return d;}
function parseCards(s){return (s.match(/[2-9TJQKA][cdhs]/g)||[]);}
function combos(a,k){const r=[];(function go(s,acc){if(acc.length===k){r.push(acc.slice());return;}for(let i=s;i<a.length;i++){acc.push(a[i]);go(i+1,acc);acc.pop();}})(0,[]);return r;}

function score5(cs){
  const vals=cs.map(c=>RV[c[0]]).sort((a,b)=>b-a);
  const suits=cs.map(c=>c[1]);
  const flush=new Set(suits).size===1;
  const uniq=[...new Set(vals)].sort((a,b)=>b-a);
  let st=false,sh=0;
  for(let i=0;i<=uniq.length-5;i++){if(uniq[i]-uniq[i+4]===4){st=true;sh=uniq[i];break;}}
  if([14,5,4,3,2].every(v=>vals.includes(v))){st=true;sh=5;}
  const cnt={};vals.forEach(v=>cnt[v]=(cnt[v]||0)+1);
  const ent=Object.entries(cnt).map(([v,c])=>[+v,c]).sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const counts=ent.map(e=>e[1]);const kick=ent.map(e=>e[0]);
  if(st&&flush)return[8,sh];
  if(counts[0]===4)return[7,kick[0],kick[1]];
  if(counts[0]===3&&counts[1]>=2)return[6,kick[0],kick[1]];
  if(flush)return[5,...vals];
  if(st)return[4,sh];
  if(counts[0]===3)return[3,...kick];
  if(counts[0]===2&&counts[1]===2)return[2,...kick];
  if(counts[0]===2)return[1,...kick];
  return[0,...vals];
}
function cmp(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]||0,y=b[i]||0;if(x!==y)return x-y;}return 0;}
function best7(cs){let b=null;for(const c of combos(cs,5)){const s=score5(c);if(!b||cmp(s,b)>0)b=s;}return b;}

const HAND_NAMES=['High card','One pair','Two pair','Three of a kind','Straight','Flush','Full house','Four of a kind','Straight flush'];
function rankName(v){return ({14:'Ace',13:'King',12:'Queen',11:'Jack',10:'Ten',9:'Nine',8:'Eight',7:'Seven',6:'Six',5:'Five',4:'Four',3:'Three',2:'Two'})[v]||v;}
function rankPlural(v){const n=rankName(v);return n==='Six'?'Sixes':n+'s';}

/* ---- preflop hand class & percentile (combo-weighted) ---- */
function preflopScore(cards){
  let r1=RV[cards[0][0]],r2=RV[cards[1][0]];if(r1<r2)[r1,r2]=[r2,r1];
  const suited=cards[0][1]===cards[1][1];const pair=r1===r2;
  let base=({14:10,13:8,12:7,11:6}[r1])||r1/2;let sc=base;
  if(pair)sc=Math.max(5,base*2);if(suited)sc+=2;
  const gap=r1-r2;
  if(!pair){if(gap===1)sc+=1;else if(gap===2)sc-=1;else if(gap===3)sc-=2;else if(gap>=4)sc-=4;}
  if(!pair&&r1<12&&gap<=1)sc+=1;
  return Math.round(sc*10)/10;
}
const _PCTL=(function(){
  const classes=[];
  for(let i=0;i<13;i++)for(let j=0;j<13;j++){
    const hi=RANKS[12-Math.min(i,j)], lo=RANKS[12-Math.max(i,j)];
    if(i<j) classes.push({score:preflopScore([hi+'s',lo+'s']), w:4, key:hi+lo+'s'});
    else if(i>j) classes.push({score:preflopScore([hi+'s',lo+'h']), w:12, key:hi+lo+'o'});
    else classes.push({score:preflopScore([hi+'s',hi+'h']), w:6, key:hi+hi});
  }
  classes.sort((a,b)=>b.score-a.score);
  const total=classes.reduce((s,c)=>s+c.w,0);
  let cum=0;const map={};
  for(const c of classes){cum+=c.w;map[c.key]=cum/total;}
  return {map};
})();
function handKey(c){
  let r1=RV[c[0][0]], r2=RV[c[1][0]];
  const hi=r1>=r2?c[0][0]:c[1][0], lo=r1>=r2?c[1][0]:c[0][0];
  if(c[0][0]===c[1][0])return c[0][0]+c[0][0];
  return hi+lo+(c[0][1]===c[1][1]?'s':'o');
}
function handPct(c){const k=handKey(c);return _PCTL.map[k]!==undefined?_PCTL.map[k]:Math.max(0.01,Math.min(1,1-(preflopScore(c)/20)));}

/* ---- villain range model: style × position -> fraction of hands played ---- */
const VPOS_OPEN={UTG:0.12,MP:0.16,LJ:0.18,HJ:0.22,CO:0.28,BTN:0.42,SB:0.36,BB:0.50};
const VSTYLE_MULT={Tight:0.7,Balanced:1.0,Loose:1.45,Maniac:1.9};
function villainRangeFrac(vpos,vstyle){
  let base=VPOS_OPEN[vpos]!==undefined?VPOS_OPEN[vpos]:0.25;
  base*=(VSTYLE_MULT[vstyle]!==undefined?VSTYLE_MULT[vstyle]:1.0);
  return Math.max(0.04,Math.min(0.95,base));
}

/* ===================================================================
   REAL VILLAIN RANGE MODEL
   Build an explicit, strength-ordered list of all 169 starting-hand
   classes, then take the top fraction (by combo weight) that matches a
   villain's VPIP — shaped by position. Equity is evaluated against this
   actual range (sampled by combos), not a single "top N%" number.
   =================================================================== */

// canonical ordering of all 169 classes by a poker-sensible preflop strength
const HAND_CLASSES=(function(){
  const order="AKQJT98765432"; // high->low for key building
  const list=[];
  for(let i=0;i<13;i++)for(let j=0;j<13;j++){
    const hi=order[Math.min(i,j)], lo=order[Math.max(i,j)];
    if(i===j){ // pair
      list.push({key:hi+hi, type:'pair', combos:6, score:preflopScore([hi+'s',hi+'h'])});
    } else if(i<j){ // suited
      list.push({key:hi+lo+'s', type:'suited', combos:4, score:preflopScore([hi+'s',lo+'s'])});
    } else { // offsuit
      list.push({key:hi+lo+'o', type:'offsuit', combos:12, score:preflopScore([hi+'s',lo+'h'])});
    }
  }
  // de-dup (i<j and i>j produce each suited/offsuit once; pairs once) — already unique by key
  const seen={}, uniq=[];
  for(const h of list){if(!seen[h.key]){seen[h.key]=1;uniq.push(h);}}
  uniq.sort((a,b)=>b.score-a.score);
  return uniq;
})();
const TOTAL_COMBOS=HAND_CLASSES.reduce((s,h)=>s+h.combos,0); // 1326

// villain type -> approximate VPIP (fraction of all hands played)
const TYPE_VPIP={Unknown:0.24, Tight:0.17, Balanced:0.25, Loose:0.40, Maniac:0.55};
// position tightens/loosens the realized range a touch (earlier = tighter)
const POS_SHADE={UTG:0.78,MP:0.88,LJ:0.94,HJ:1.0,CO:1.12,BTN:1.35,SB:1.05,BB:1.30};

// Build the villain's range as a set of class keys + the combos covered.
// frac override (e.g. for "facing 3-bet" we can pass a tighter frac) optional.
function buildVillainRange(vpos, vtype, fracOverride){
  let vpip = TYPE_VPIP[vtype]!==undefined?TYPE_VPIP[vtype]:0.25;
  vpip *= (POS_SHADE[vpos]!==undefined?POS_SHADE[vpos]:1.0);
  if(fracOverride!=null) vpip=fracOverride;
  vpip=Math.max(0.03,Math.min(0.95,vpip));
  const target=vpip*TOTAL_COMBOS;
  const keys=new Set(); let acc=0;
  const top=[];
  for(const h of HAND_CLASSES){
    if(acc>=target)break;
    keys.add(h.key); top.push(h.key); acc+=h.combos;
  }
  return {keys, frac:acc/TOTAL_COMBOS, top, vpip};
}

// does a concrete 2-card combo belong to a range key-set?
function comboKey(a,b){
  let r1=RV[a[0]], r2=RV[b[0]];
  const hi=r1>=r2?a[0]:b[0], lo=r1>=r2?b[0]:a[0];
  if(a[0]===b[0])return a[0]+a[0];
  return hi+lo+(a[1]===b[1]?'s':'o');
}

/* ---- equity vs an EXPLICIT range, multiway aware ----
   nOpp = number of opponents (1 = heads-up, 2 = 3-way, 3 = 4-way+).
   Returns {eq, lo, hi, n, win, tie, lose}. Each opponent is dealt a hand
   sampled FROM the villain range (pre-enumerated combos), so even tight
   multiway ranges fill all iterations instead of starving on rejection. */
function equityVsRangeSet(hero, board, rangeKeys, nOpp, iters){
  const known=new Set([...hero,...board]);
  const base=deck().filter(c=>!known.has(c));
  // pre-enumerate every 2-card combo from the live deck that belongs to the range
  let rangeCombos=[];
  for(let i=0;i<base.length;i++)for(let j=i+1;j<base.length;j++){
    if(!rangeKeys || !rangeKeys.size || rangeKeys.has(comboKey(base[i],base[j])))
      rangeCombos.push([base[i],base[j]]);
  }
  if(rangeCombos.length<nOpp) // range too small given dead cards; fall back to any 2 cards
    rangeCombos=null;

  let sum=0,sumsq=0,counted=0,guard=0,win=0,tie=0,lose=0;
  const maxGuard=iters*200;
  const need=5-board.length;
  while(counted<iters && guard<maxGuard){
    guard++;
    const used=new Set(known);
    const opps=[]; let ok=true;
    for(let k=0;k<nOpp;k++){
      let a,b,tries=0,placed=false;
      while(tries++<40){
        if(rangeCombos){const cb=rangeCombos[(Math.random()*rangeCombos.length)|0];a=cb[0];b=cb[1];}
        else {a=base[(Math.random()*base.length)|0];b=base[(Math.random()*base.length)|0];}
        if(a!==b && !used.has(a) && !used.has(b)){placed=true;break;}
      }
      if(!placed){ok=false;break;}
      used.add(a);used.add(b);opps.push([a,b]);
    }
    if(!ok)continue;
    // draw the runout from remaining cards
    const remain=base.filter(c=>!used.has(c));
    for(let i=remain.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[remain[i],remain[j]]=[remain[j],remain[i]];}
    const runout=board.concat(remain.slice(0,need));
    const hr=best7(hero.concat(runout));
    let lost=false, tied=false;
    for(const o of opps){
      const c=cmp(hr,best7(o.concat(runout)));
      if(c<0){lost=true;break;}
      if(c===0)tied=true;
    }
    let v;
    if(lost){v=0;lose++;}
    else if(tied){v=0.5;tie++;}
    else {v=1;win++;}
    sum+=v;sumsq+=v*v;counted++;
  }
  if(counted===0)return {eq:equityRandom(hero,board,iters),lo:0,hi:1,n:0,win:0,tie:0,lose:0};
  const mean=sum/counted, variance=Math.max(0,sumsq/counted-mean*mean), se=Math.sqrt(variance/counted);
  return {eq:mean, lo:Math.max(0,mean-1.96*se), hi:Math.min(1,mean+1.96*se), n:counted,
          win:win/counted, tie:tie/counted, lose:lose/counted};
}

/* ---- equity vs a RANGE (legacy frac API, kept for compatibility) ---- */
/* Returns {eq, lo, hi, n}: mean equity + ~95% confidence interval. */
function equityVsRange(hero,board,frac,iters){
  const known=new Set([...hero,...board]);
  const base=deck().filter(c=>!known.has(c));
  let sum=0,sumsq=0,counted=0,guard=0;
  const maxGuard=iters*60;
  while(counted<iters && guard<maxGuard){
    guard++;
    // sample villain hole cards
    let a=base[(Math.random()*base.length)|0], b=base[(Math.random()*base.length)|0];
    if(a===b)continue;
    if(handPct([a,b])>frac)continue; // reject hands outside villain's range
    const used=new Set([...known,a,b]);
    const rem=base.filter(c=>c!==a&&c!==b);
    // shuffle remaining for runout
    for(let i=rem.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[rem[i],rem[j]]=[rem[j],rem[i]];}
    const need=5-board.length;
    const full=board.concat(rem.slice(0,need));
    const hr=best7(hero.concat(full));
    const vr=best7([a,b].concat(full));
    const c=cmp(hr,vr);
    const v=c>0?1:(c===0?0.5:0);
    sum+=v;sumsq+=v*v;counted++;
  }
  if(counted===0){const e=equityRandom(hero,board,iters);return {eq:e,lo:e,hi:e,n:0};}
  const mean=sum/counted;
  const variance=Math.max(0,sumsq/counted-mean*mean);
  const se=Math.sqrt(variance/counted);
  return {eq:mean, lo:Math.max(0,mean-1.96*se), hi:Math.min(1,mean+1.96*se), n:counted};
}
function equityRandom(hero,board,iters){
  const known=new Set([...hero,...board]);
  const base=deck().filter(c=>!known.has(c));
  let win=0,tie=0;
  for(let it=0;it<iters;it++){
    const pool=base.slice();
    for(let i=pool.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[pool[i],pool[j]]=[pool[j],pool[i]];}
    const v=[pool[0],pool[1]];const need=5-board.length;
    const b=board.concat(pool.slice(2,2+need));
    const c=cmp(best7(hero.concat(b)),best7(v.concat(b)));
    if(c>0)win++;else if(c===0)tie++;
  }
  return (win+tie*0.5)/iters;
}

/* ---- EXACT outs: cards that bring hero to a STRONG made hand (two-pair+ or a
   completed straight/flush) — the meaningful "outs to a likely winner" players study.
   We exclude marginal high-card->weak-pair bumps so a straight/flush draw shows its
   true out count (e.g. open-ender = 8, flush draw = 9). ---- */
function exactOuts(hero,board){
  if(board.length<3||board.length>=5)return {n:0,cards:[],hitPct:0};
  const cur=best7(hero.concat(board));
  const curCat=cur[0];
  const used=new Set([...hero,...board]);
  const rest=deck().filter(c=>!used.has(c));
  const cards=[];
  for(const c of rest){
    const nr=best7(hero.concat(board.concat([c])));
    const cat=nr[0];
    // out = card that brings hero to a genuinely strong hand: two-pair+ (2), trips (3),
    // straight (4), flush (5) or better. Bare one-pair is NOT counted, so a straight/flush
    // draw reports its true outs (open-ender 8, flush 9) instead of every pairing card.
    if(cat>curCat && cat>=2)cards.push(c);
  }
  const unseen=rest.length;
  const toCome=5-board.length;
  let hit = toCome===2
    ? 1-((unseen-cards.length)/unseen)*((unseen-1-cards.length)/(unseen-1))
    : cards.length/unseen;
  return {n:cards.length, cards, hitPct:hit};
}

/* ---- made-hand + draw description ---- */
function handRankDesc(hero,board){
  if(board.length<3)return preflopHandDesc(hero);
  const s=best7(hero.concat(board));
  let made=HAND_NAMES[s[0]]||'High card';
  if(s[0]===1)made=`Pair of ${rankPlural(s[1])}`;
  else if(s[0]===0)made=`${rankName(s[1])}-high`;
  else if(s[0]===2)made=`Two pair, ${rankPlural(s[1])} & ${rankPlural(s[2])}`;
  else if(s[0]===3)made=`Trip ${rankPlural(s[1])}`;
  const draws=[];
  if(board.length<5){
    const cards=hero.concat(board);
    const bySuit={};cards.forEach(c=>bySuit[c[1]]=(bySuit[c[1]]||0)+1);
    if(Object.values(bySuit).some(n=>n===4)&&s[0]<5)draws.push('flush draw');
    const vals=[...new Set(cards.map(c=>RV[c[0]]))].sort((a,b)=>a-b);
    if(vals.includes(14))vals.unshift(1);
    let oesd=false,gut=false;
    for(let i=0;i<vals.length-3;i++){const w=vals.slice(i,i+4);if(w[3]-w[0]===3)oesd=true;else if(w[3]-w[0]===4)gut=true;}
    if(s[0]<4){if(oesd)draws.push('open-ended straight draw');else if(gut)draws.push('gutshot');}
  }
  return draws.length?`${made} + ${draws.join(' + ')}`:made;
}
function preflopHandDesc(cards){
  if(cards.length<2)return '—';
  let a=RV[cards[0][0]],b=RV[cards[1][0]];if(a<b)[a,b]=[b,a];
  const suited=cards[0][1]===cards[1][1];
  if(a===b)return `Pair of ${rankPlural(a)}`;
  return `${rankName(a)}-${rankName(b)} ${suited?'suited':'offsuit'}`;
}

/* ---- GTO-BASED PREFLOP RANGE CHARTS ----
   Standard ~100bb cash open / vs-open thresholds expressed as top-fraction of hands,
   by hero position. These are widely-taught reference ranges (not solver output for
   this exact node, but the charts players study). Used preflop only. */
const OPEN_CHART={UTG:0.16,MP:0.18,LJ:0.21,HJ:0.26,CO:0.31,BTN:0.45,SB:0.42,BB:0.55};
// vs a single raise: continue (call+3bet) fraction & the 3-bet (value/bluff) fraction
const VS_RAISE={
  UTG:{cont:0.09,threeb:0.045},MP:{cont:0.10,threeb:0.05},LJ:{cont:0.11,threeb:0.055},
  HJ:{cont:0.13,threeb:0.06},CO:{cont:0.15,threeb:0.07},BTN:{cont:0.20,threeb:0.09},
  SB:{cont:0.13,threeb:0.075},BB:{cont:0.30,threeb:0.08}
};
const NASH={8:0.42,10:0.36,12:0.30,15:0.24,20:0.17};
function closestNash(b){return Object.keys(NASH).map(Number).reduce((p,c)=>Math.abs(c-b)<Math.abs(p-b)?c:p);}

function pct(x){return Math.round(x*100)+'%';}

/* ---- THE RECOMMENDATION ---- */
/* o = {cards,board,pos,vpos,vstyle,bbs,pot,call,spot,players} */
function recommend(o, iters){
  const hero=parseCards(o.cards), board=parseCards(o.board||'');
  const bbs=+o.bbs;
  const players=Math.max(2,Math.min(4,+(o.players||2)));   // total players in pot
  const nOpp=players-1;
  const pot=+(o.pot||0), call=+(o.call||0);
  const potOdds = call>0 ? call/(pot+call) : null;          // equity needed to call
  iters=iters || (board.length>=3 ? (nOpp>1?1700:2600) : 1500);

  // tighten villain range for stronger aggression spots
  let fracOverride=null;
  if(o.spot==='facing_3bet')fracOverride=0.07;
  else if(o.spot==='facing_jam')fracOverride=0.12;
  const range=buildVillainRange(o.vpos||'CO', o.vstyle||'Balanced', fracOverride);

  if(board.length>=3){
    // ---- POSTFLOP: equity vs the EXPLICIT villain range, multiway aware ----
    const er=equityVsRangeSet(hero, board, range.keys, nOpp, iters);
    const eq=er.eq;
    const outs=exactOuts(hero,board);
    const ranking=handRankDesc(hero,board);

    // decision emerges from equity vs the price, not fixed thresholds
    let verb,cls,why,evEdge=null;
    const street=board.length===3?'flop':board.length===4?'turn':'river';
    const rDesc=`a ${(o.vstyle||'Balanced').toLowerCase()} ${o.vpos||'CO'} range (top ${pct(range.frac)}${nOpp>1?`, ${nOpp} opponents`:''})`;

    if(potOdds!=null){
      // facing a bet: compare equity to required pot odds -> EV of calling
      evEdge = eq - potOdds;                                  // + = profitable call
      const callEV = eq*(pot+call) - (1-eq)*call;             // BB EV of calling
      if(eq>=0.62 && call < pot*1.5){
        verb='RAISE (value)';cls='raise';
        why=`You hold ${pct(eq)} equity versus ${rDesc} — well above the ${pct(potOdds)} you need to call. That's a clear value edge: raise to grow the pot while you're ahead, rather than just calling.`;
      } else if(evEdge>=0){
        verb='CALL';cls='call';
        why=`Your ${pct(eq)} equity beats the ${pct(potOdds)} you need, so calling is +EV (about ${callEV>=0?'+':''}${callEV.toFixed(1)} BB). ${outs.n?`You have ${outs.n} clean outs (${pct(outs.hitPct)} to improve), which carries the call. `:''}Not strong enough to raise for value here.`;
      } else if(evEdge>-0.06 && outs.n>=8){
        verb='CALL (drawing)';cls='call';
        why=`Bare pot odds are slightly short (${pct(eq)} vs ${pct(potOdds)} needed), but with ${outs.n} outs and implied odds — chips you can win on later streets when you hit — continuing is defensible. Fold if stacks are shallow or the opponent won't pay you off.`;
      } else {
        verb='FOLD';cls='fold';
        why=`You need ${pct(potOdds)} to call and only have ${pct(eq)} against ${rDesc}. Calling loses about ${Math.abs(callEV).toFixed(1)} BB on average. ${outs.n?`Even your ${outs.n} outs (${pct(outs.hitPct)}) don't bridge the gap. `:''}Release it.`;
      }
    } else {
      // no bet to face (checked to hero / opening pot): bet-or-check on raw edge
      if(eq>=0.62){verb='BET (value)';cls='raise';
        why=`You're a clear favorite — ${pct(eq)} equity versus ${rDesc}. Bet for value (≈55–70% pot) so worse hands and draws pay you. Checking forfeits value.`;}
      else if(eq>=0.50){verb='BET (thin) / CHECK';cls='raise';
        why=`Slight edge at ${pct(eq)}. A smaller value bet (≈33–50% pot) gets called by worse and protects against draws, but checking to control the pot is fine too.`;}
      else if(eq>=0.40){verb='CHECK / CALL';cls='call';
        why=`Marginal — ${pct(eq)} versus ${rDesc}. Keep the pot small: check, and call reasonable bets. ${outs.n?`Your ${outs.n} outs (${pct(outs.hitPct)}) add continuing value.`:''}`;}
      else{verb='CHECK / FOLD';cls='fold';
        why=`Only ${pct(eq)} equity and ${outs.n?`${outs.n} outs`:'little to draw to'}. Check; fold to pressure unless you have a clear bluffing plan.`;}
    }

    const confidence=postflopConfidence(eq, potOdds, er, range, nOpp);
    return {
      mode:'postflop', verb, cls, why, eq, conf:[er.lo,er.hi], n:er.n,
      ranking, outs, vfrac:range.frac, rangeTop:range.top,
      win:er.win, tie:er.tie, lose:er.lose,
      potOdds, evEdge, confidence, players
    };
  }

  // ---- PREFLOP (chart-based + short-stack Nash) ----
  const res=preflopRec(o, hero, bbs);
  res.players=players; res.potOdds=potOdds;
  res.confidence=preflopConfidence(res.hp, res.thr);
  res.rangeTop=range.top;
  return res;
}

/* honest confidence: how decisive is this call/fold given the edge + noise + complexity */
function postflopConfidence(eq, potOdds, er, range, nOpp){
  let margin;
  if(potOdds!=null) margin=Math.abs(eq-potOdds)/Math.max(0.08,potOdds);
  else margin=Math.abs(eq-0.5)/0.5;
  let c=0.5+0.5*Math.min(1,margin);
  const ci=(er.hi-er.lo);
  c-=Math.min(0.15, ci*0.8);
  c-=(nOpp-1)*0.06;
  if(range.frac>0.45)c-=0.05;
  if(er.n<400)c-=0.18;          // few valid sims => low certainty, say so honestly
  else if(er.n<1200)c-=0.08;
  return Math.max(0.4, Math.min(0.97, c));
}
function preflopConfidence(hp, thr){
  if(thr==null)return 0.7;
  const margin=Math.abs(hp-thr)/Math.max(0.05,thr);
  return Math.max(0.45, Math.min(0.96, 0.55+0.45*Math.min(1,margin)));
}

function preflopRec(o, hero, bbs){
  const hp=handPct(hero), desc=preflopHandDesc(hero), sc=preflopScore(hero);
  if(bbs<=15 && (o.spot==='open'||o.spot==='facing_jam')){
    const thr=NASH[closestNash(bbs)];
    if(hp<=thr)return {mode:'preflop',verb:'SHOVE (all-in)',cls:'raise',sc,hp,thr,
      why:`At ${bbs} BB this is a push/fold spot. ${desc} sits in the top ${pct(hp)} of hands and the Nash jam range at this depth is about the top ${pct(thr)} — shoving is profitable and sidesteps tricky short-stack play.`};
    return {mode:'preflop',verb:'FOLD',cls:'fold',sc,hp,thr,
      why:`At ${bbs} BB, ${desc} (top ${pct(hp)}) is outside the Nash jam range (~top ${pct(thr)}). Fold and wait for a stronger shove.`};
  }
  const pos=o.pos||'CO';
  if(o.spot==='open'){
    const thr=OPEN_CHART[pos]!==undefined?OPEN_CHART[pos]:0.25;
    if(hp<=thr)return {mode:'preflop',verb:'RAISE (open ≈2.2–2.5x)',cls:'raise',sc,hp,thr,
      why:`${desc} is in the top ${pct(hp)} of hands — inside a standard ${pos} opening range (~top ${pct(thr)}). Open-raise to take the lead.`};
    return {mode:'preflop',verb:'FOLD',cls:'fold',sc,hp,thr,
      why:`${desc} (top ${pct(hp)}) is outside a disciplined ${pos} open (~top ${pct(thr)}). Folding keeps your range strong.`};
  }
  if(o.spot==='facing_raise'){
    const ch=VS_RAISE[pos]||{cont:0.13,threeb:0.06};
    if(hp<=ch.threeb)return {mode:'preflop',verb:'3-BET',cls:'raise',sc,hp,thr:ch.threeb,
      why:`${desc} (top ${pct(hp)}) is strong enough to 3-bet for value from ${pos} (~top ${pct(ch.threeb)}). Build the pot while ahead.`};
    if(hp<=ch.cont)return {mode:'preflop',verb:'CALL',cls:'call',sc,hp,thr:ch.cont,
      why:`${desc} (top ${pct(hp)}) can profitably continue versus a raise from ${pos} (~top ${pct(ch.cont)}). Too good to fold, not quite a 3-bet.`};
    return {mode:'preflop',verb:'FOLD',cls:'fold',sc,hp,thr:ch.cont,
      why:`${desc} (top ${pct(hp)}) is too weak to continue versus a raise here. Releasing it is the disciplined play.`};
  }
  if(o.spot==='facing_3bet'){
    const ch=VS_RAISE[pos]||{cont:0.13,threeb:0.06};
    if(hp<=ch.threeb*0.55)return {mode:'preflop',verb:'4-BET / CALL',cls:'raise',sc,hp,thr:ch.threeb*0.55,
      why:`${desc} (top ${pct(hp)}) is premium versus a 3-bet — 4-bet the strongest, call the rest. You're at the top of your range.`};
    if(hp<=ch.threeb)return {mode:'preflop',verb:'CALL (carefully)',cls:'call',sc,hp,thr:ch.threeb,
      why:`${desc} (top ${pct(hp)}) is borderline versus a 3-bet. Call in position with a plan; fold the weaker end out of position.`};
    return {mode:'preflop',verb:'FOLD',cls:'fold',sc,hp,thr:ch.threeb,
      why:`${desc} (top ${pct(hp)}) should fold to a 3-bet — continuing bleeds chips against a dominating range.`};
  }
  if(o.spot==='facing_call'){ // limped/flatted pot, hero can iso-raise or check
    const thr=(OPEN_CHART[pos]||0.25)*1.1;
    if(hp<=thr)return {mode:'preflop',verb:'RAISE (isolate)',cls:'raise',sc,hp,thr,
      why:`${desc} (top ${pct(hp)}) is worth an isolation raise over limpers from ${pos} — take the lead and play a bigger pot in position against weak hands.`};
    return {mode:'preflop',verb:'CHECK / FOLD',cls:'call',sc,hp,thr,
      why:`${desc} (top ${pct(hp)}) isn't strong enough to raise over the limpers profitably. See a cheap flop if you're in the big blind, otherwise fold.`};
  }
  // facing_jam deep
  const thr=NASH[closestNash(Math.min(20,bbs))];
  if(hp<=thr)return {mode:'preflop',verb:'CALL the jam',cls:'raise',sc,hp,thr,
    why:`${desc} (top ${pct(hp)}) is strong enough to call an all-in (calling range ~top ${pct(thr)}). You have the equity to take the flip.`};
  return {mode:'preflop',verb:'FOLD',cls:'fold',sc,hp,thr,
    why:`${desc} (top ${pct(hp)}) can't call an all-in profitably (need ~top ${pct(thr)}). Fold.`};
}

// expose for app.js
window.GINIQ={recommend,parseCards,pct,SUIT_SYM,RANKS,SUITS,handRankDesc,preflopHandDesc,buildVillainRange};
