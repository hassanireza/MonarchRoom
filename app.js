'use strict';

// VIP Texas Hold'em - production game logic
/* ═══════════════════════════════════════════════════════════
   MONARCH ROOM  — Texas Hold'em  v4  (production complete)

   Architecture: strict state machine with a single scheduler.
   The key insight fixing all previous bugs:

   ┌─ continueAction() ─────────────────────────────────────┐
   │  1. If hand over → stop.                               │
   │  2. If only one player left → award uncontested.       │
   │  3. If street is complete → scheduleStreetAdvance().   │
   │  4. If current player is human → stop, wait for click. │
   │  5. If current player is AI → scheduleAI().            │
   └────────────────────────────────────────────────────────┘

   Nothing ever calls continueAction() synchronously except
   boot(). All recursion goes through setTimeout, ensuring
   the call stack clears and the DOM updates between turns.

   Human button clicks call: humanAct(type) → then
   setTimeout(continueAction, 80). That's the ONLY way
   continueAction re-enters after a human action.
═══════════════════════════════════════════════════════════ */

// ── CONSTANTS ──────────────────────────────────────────────
const SAVE_KEY = "monarchRoomV4";
const RANKS  = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const SUITS  = ["S","H","D","C"];
const SYM    = {S:"♠",H:"♥",D:"♦",C:"♣"};
const HAND_NAMES = [
  "High Card","One Pair","Two Pair","Three of a Kind",
  "Straight","Flush","Full House","Four of a Kind","Straight Flush","Royal Flush"
];
const PROFILES = [
  {name:"Valentina", style:"Balanced",       agg:.58,loose:.42,bluff:.18},
  {name:"Soren",     style:"Pressure player",agg:.78,loose:.52,bluff:.32},
  {name:"Kaito",     style:"Mathematician",  agg:.46,loose:.32,bluff:.12},
  {name:"Amara",     style:"Trap specialist",agg:.54,loose:.36,bluff:.21},
  {name:"Lucien",    style:"Wild card",      agg:.84,loose:.62,bluff:.40}
];

// ── GLOBALS ────────────────────────────────────────────────
let G = null;          // game state
let E = {};            // cached DOM elements
let aiTimer   = null;  // single pending AI setTimeout id
let actionTimer = null;
let streetTimer = null;
let waitHuman = false; // true = waiting for human button click
let waitingForIdx = null;
let soundOn   = true;
let autoDeal  = false;
let revealAI  = true;
let audioCtx  = null;
let prevPot   = 0;
let prevComLen= 0;

const $ = id => document.getElementById(id);
const money = v => Math.max(0,Math.round(v)).toLocaleString("en-US");
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const rnd   = (a,b)   => Math.random()*(b-a)+a;

// ── INITIAL STATE ──────────────────────────────────────────
function newGame() {
  return {
    players: [
      {id:"hero",name:"You",human:true,stack:5000,active:true,seat:0,
       stats:{hands:0,vpip:0,showdowns:0,wins:0,best:5000}},
      ...PROFILES.map((p,i)=>({
        id:`ai${i}`,name:p.name,human:false,
        stack:5000,active:true,seat:i+1,profile:p
      }))
    ],
    // hand fields (reset each hand)
    deck:[],community:[],
    dealer:0, sbSeat:null, bbSeat:null,
    phase:"idle",       // idle | preflop | flop | turn | river | showdown | done
    currentBet:0, minRaise:50, pot:0,
    actingIdx:null,     // index into players[] of who acts next
    handDone:true, revealCards:false,
    // tournament fields
    level:1, sb:25, bb:50,
    handsPlayed:0, handsAtLevel:0,
    smallBlind:25, bigBlind:50,
    history:[], leaderboard:[],
    logs:["Welcome to the Monarch Room. Good luck."]
  };
}

function resetHand(G) {
  G.players.forEach(p=>{
    p.cards = [];
    p.folded = false;
    p.allIn = false;
    p.roundBet = 0;
    p.invested = 0;
    p.acted = false;
    p.lastAction = "";
    p.hasRendered = false;
    delete p.handRank;
  });

  G.deck       = makeDeck();
  G.community  = [];
  G.currentBet = 0;
  G.minRaise   = G.bigBlind;
  G.pot        = 0;
  G.actingIdx  = null;
  G.handDone   = false;
  G.revealCards= false;
  G.phase      = "preflop";
}

function sanitize(raw) {
  try {
    if (!raw||!Array.isArray(raw.players)||raw.players.length<2) return newGame();
    const base = newGame();
    return {
      ...base, ...raw,
      players: base.players.map((b,i)=>({...b,...(raw.players[i]||{})})),
      handDone:true, phase:"idle", actingIdx:null
    };
  } catch { return newGame(); }
}

// ── DECK ──────────────────────────────────────────────────
function makeDeck() {
  const d=[];
  SUITS.forEach(s=>RANKS.forEach((r,i)=>d.push({rank:r,suit:s,val:i+2})));
  for(let i=d.length-1;i>0;i--){const j=0|Math.random()*(i+1);[d[i],d[j]]=[d[j],d[i]];}
  return d;
}

// ── PLAYER QUERIES ─────────────────────────────────────────
// Active = in the tournament (has chips)
const active  = ()=>G.players.filter(p=>p.active&&p.stack>0);
// In this hand = not folded (may be all-in)
const inHand  = ()=>G.players.filter(p=>p.active&&!p.folded&&(p.stack>0||p.invested>0));
// Can still bet/call this street
const canBet  = ()=>inHand().filter(p=>!p.allIn&&p.stack>0);

// Next active (has chips) seat clockwise from `from`
function nextActive(from) {
  for(let s=1;s<=G.players.length;s++){
    const i=(from+s)%G.players.length;
    if(G.players[i].active&&G.players[i].stack>0) return i;
  }
  return null;
}

// Next seat that can STILL ACT this street (not folded, not all-in, has chips)
function nextToAct(from) {
  for(let s=1;s<=G.players.length;s++){
    const i=(from+s)%G.players.length;
    const p=G.players[i];
    if(p.active&&!p.folded&&!p.allIn&&p.stack>0) return i;
  }
  return null;
}

// ── HAND START ────────────────────────────────────────────
function startHand() {
  clearTimers();
  waitHuman = false;
  waitingForIdx = null;
  clearGlow();
  hideWin();
  eliminateBusted();

  if(active().length<=1){endTournament();return;}

  const nb = nextActive(G.dealer);
  if(nb!==null) G.dealer = nb;

  resetHand(G);

  // ✅ ensure fresh animation state
  G.players.forEach(p => p.hasRendered = false);

  const live = active();
  let sbIdx, bbIdx;

  if(live.length===2){
    sbIdx = G.dealer;
    bbIdx = nextActive(G.dealer);
  } else {
    sbIdx = nextActive(G.dealer);
    bbIdx = nextActive(sbIdx);
  }

  G.sbSeat = sbIdx;
  G.bbSeat = bbIdx;

  postBlind(sbIdx, G.smallBlind, "small blind");
  postBlind(bbIdx, G.bigBlind,   "big blind");

  G.currentBet = G.players[bbIdx].roundBet;
  G.minRaise   = G.bigBlind;

  const deal = G.players.filter(p=>p.active);
  for(let pass=0; pass<2; pass++) {
    deal.forEach(p => p.cards.push(G.deck.pop()));
  }

  if(live.length===2){
    G.actingIdx = G.dealer;
  } else {
    G.actingIdx = nextToAct(bbIdx);
  }

  G.handsPlayed++;
  G.handsAtLevel++;
  G.players[0].stats.hands++;

  addLog(`— Hand ${G.handsPlayed} · Dealer: ${G.players[G.dealer].name} —`);
  checkBlindsUp();
  save();
  render();

  scheduleAction(60);
}

function postBlind(idx, amount, label) {
  const p = G.players[idx];
  const chips = Math.min(p.stack, amount);
  p.stack    -= chips;
  p.roundBet += chips;
  p.invested += chips;
  if(p.stack===0){p.allIn=true;p.acted=true;}
  // Blinds are NOT marked as acted — they still get their option
  addLog(`${p.name} posts ${label} (${money(chips)}).`);
}

function checkBlindsUp() {
  if(G.handsAtLevel>=6){
    G.handsAtLevel=0;
    G.level++;
    G.smallBlind=Math.round(G.smallBlind*1.5/5)*5;
    G.bigBlind  =G.smallBlind*2;
    G.minRaise  =G.bigBlind;
    addLog(`— Blinds up: ${money(G.smallBlind)}/${money(G.bigBlind)} —`);
    showToast(`Level ${G.level} · Blinds ${money(G.smallBlind)}/${money(G.bigBlind)}`);
  }
}

// ── STREET COMPLETE CHECK ─────────────────────────────────
// Returns true when this betting round is finished.
//
// Rules:
//  A. If ≤1 player hasn't folded → done (no more betting possible)
//  B. If nobody can bet (all in or folded) → done, run cards out
//  C. Everyone who can bet must have:
//       - acted this street, AND
//       - matched the current bet (or be all-in)
//  D. Special preflop rule: the BB gets an "option" —
//     if the bet hasn't been raised above BB, BB must get a turn.
//
function isStreetDone() {
  const alive = inHand().filter(p=>!p.folded);
  if(alive.length<=1) return true;

  const bettors = canBet(); // players who can still act
  if(bettors.length===0) return true;  // everyone all-in or folded

  // All bettors must have acted and matched the current bet
  const allSettled = bettors.every(p=>p.acted && p.roundBet===G.currentBet);
  if(!allSettled) return false;

  // Preflop BB option: if no raise has happened, BB hasn't acted → not done
  if(G.phase==="preflop"){
    const bb = G.players[G.bbSeat];
    if(bb && !bb.folded && !bb.allIn && bb.stack>0 && !bb.acted){
      return false;
    }
  }
  return true;
}

// ── THE SINGLE ACTION SCHEDULER ───────────────────────────
// THIS is the core fix. One function, no synchronous recursion.
function continueAction() {
  if(waitHuman) return;
  if(G.handDone) return;
  render();

  // Hand-end conditions
  if(inHand().filter(p=>!p.folded).length<=1){
    awardUncontested();
    return;
  }

  // Street done?
  if(isStreetDone()){
    scheduleStreetAdvance();
    return;
  }

  // Validate actingIdx
  if(G.actingIdx===null){
    G.actingIdx=nextToAct(G.dealer);
    if(G.actingIdx===null){scheduleStreetAdvance();return;}
  }

  const p = G.players[G.actingIdx];

  // Skip players who can't act
  if(!p||!p.active||p.folded||p.allIn||p.stack<=0){
    const nxt=nextToAct(G.actingIdx);
    if(nxt===null||nxt===G.actingIdx){scheduleStreetAdvance();return;}
    G.actingIdx=nxt;
    scheduleAction(50);
    return;
  }

  if(p.human){
    // ── HUMAN TURN: stop and wait ──
    waitHuman=true;
    waitingForIdx=G.actingIdx;
    setDec("Your Decision", buildDecText(p));
    render(); // re-render to enable buttons
  } else {
    // ── AI TURN: schedule with delay ──
    waitHuman=false;
    waitingForIdx=null;
    setDec(p.name, `${p.profile.style} is thinking…`);
    showDots();
    render();
    const delay = rnd(550,1050);
    aiTimer = setTimeout(()=>{
      aiTimer=null;
      if(G.handDone) return;
      // Guard: make sure this AI is still the acting player
      if(waitHuman) return;
      if(G.actingIdx===null||G.players[G.actingIdx]!==p){scheduleAction(0);return;}
      hideDots();
      doAiAct(p);
      scheduleAction(100);
    }, delay);
  }
}

function scheduleStreetAdvance(){
  clearActionTimer();
  clearStreetTimer();
  streetTimer = setTimeout(()=>{
    streetTimer = null;
    advanceStreet();
  }, 280);
}

function scheduleAction(delay=0){
  clearActionTimer();
  actionTimer = setTimeout(()=>{
    actionTimer = null;
    continueAction();
  }, delay);
}

function clearActionTimer(){
  if(actionTimer){
    clearTimeout(actionTimer);
    actionTimer = null;
  }
}

function clearStreetTimer(){
  if(streetTimer){
    clearTimeout(streetTimer);
    streetTimer = null;
  }
}

// ── ADVANCE TO NEXT STREET ────────────────────────────────
function advanceStreet() {
  syncPot();

  const NEXT  = {preflop:"flop",flop:"turn",turn:"river",river:"showdown"};
  const COUNT = {preflop:3,flop:1,turn:1};

  const next = NEXT[G.phase];
  if(!next||next==="showdown"){doShowdown();return;}

  // Burn + deal
  G.deck.pop(); // burn
  const n=COUNT[G.phase]||0;
  for(let i=0;i<n;i++) G.community.push(G.deck.pop());
  G.phase=next;
  addLog(`─ ${next.toUpperCase()} dealt ─`);

  // Reset street fields
  G.players.forEach(p=>{
    p.roundBet=0;
    // Pre-mark as acted anyone who can't act
    p.acted=(p.folded||p.allIn||!p.active||p.stack<=0);
  });
  G.currentBet=0;
  G.minRaise=G.bigBlind;

  // First to act post-flop: first live player left of dealer
  G.actingIdx=nextToAct(G.dealer);

  playSound(400,.06,"sine");
  render();
  // Give UI time to show the new cards before action starts
  scheduleAction(520);
}

// ── HUMAN ACTION ENTRY POINT ──────────────────────────────
function humanAct(type, amount) {
  if(!waitHuman||G.handDone) return;
  if(waitingForIdx!==G.actingIdx) return;
  const p=G.players[G.actingIdx];
  if(!p||!p.human) return;
  clearTimers();
  waitHuman=false;
  waitingForIdx=null;
  applyAction(p, type, amount);
  render();
  save();
  scheduleAction(80);
}

// ── APPLY AN ACTION ───────────────────────────────────────
function applyAction(p, type, amount) {
  const toCall = Math.max(0, G.currentBet - p.roundBet);

  if(type==="fold"){
    p.folded=true; p.acted=true; p.lastAction="Fold";
    addLog(`${p.name} folds.`);
    playSound(170,.04,"sine");

  } else if(type==="check"){
    if(toCall>0){applyAction(p,"call");return;}
    p.acted=true; p.lastAction="Check";
    addLog(`${p.name} checks.`);
    playSound(250,.03,"sine");

  } else if(type==="call"){
    if(toCall===0){applyAction(p,"check");return;}
    const paid=chipOut(p,toCall);
    p.acted=true;
    p.lastAction=`Call ${money(paid)}`;
    if(p.human) p.stats.vpip++;
    addLog(`${p.name} calls ${money(paid)}.`);
    playSound(310,.04,"triangle");

  } else if(type==="raise"){
    const cap      = p.roundBet+p.stack;
    const minTotal = G.currentBet+G.minRaise;
    const target   = Math.min(Math.max(Number(amount)||minTotal, minTotal), cap);
    const prev     = p.roundBet;
    chipOut(p, target-prev);
    const newBet   = p.roundBet;

    if(newBet>G.currentBet){
      const raised   = newBet-G.currentBet;
      const fullRaise= raised>=G.minRaise;
      if(fullRaise) G.minRaise=Math.max(G.bigBlind,raised);
      G.currentBet=newBet;
      // Reopen action for all other players who can still bet
      G.players.forEach(o=>{
        if(o!==p&&!o.folded&&!o.allIn&&o.active&&o.stack>0) o.acted=false;
      });
      p.acted=true;
      p.lastAction=p.allIn?"All In":`Raise ${money(newBet)}`;
      if(p.human) p.stats.vpip++;
      addLog(fullRaise?`${p.name} raises to ${money(newBet)}.`:`${p.name} is all in for ${money(newBet)}.`);
      playSound(530,.055,"triangle");
    } else {
      // Couldn't raise fully — treat as call/all-in
      p.acted=true;
      p.lastAction="All In";
      addLog(`${p.name} calls all in.`);
      playSound(310,.04,"triangle");
    }

  } else if(type==="allin"){
    const target=p.roundBet+p.stack;
    if(target>G.currentBet) applyAction(p,"raise",target);
    else applyAction(p,"call");
    if(!p.folded) p.lastAction="All In";
    syncPot();
    G.actingIdx=nextToAct(G.players.indexOf(p));
    return; // applyAction already handled recursively
  }

  if(p.stack===0) p.allIn=true;
  syncPot();
  G.actingIdx=nextToAct(G.players.indexOf(p));
}

function chipOut(p, amount) {
  const paid=Math.min(p.stack,Math.max(0,amount));
  p.stack-=paid; p.roundBet+=paid; p.invested+=paid;
  if(p.stack===0) p.allIn=true;
  return paid;
}

function syncPot() {
  G.pot=G.players.reduce((s,p)=>s+(p.invested||0),0);
}

// ── AI DECISION ───────────────────────────────────────────
function doAiAct(p) {
  const prof   = p.profile;
  const toCall = Math.max(0, G.currentBet-p.roundBet);
  const pot    = G.pot+G.players.reduce((s,pl)=>s+pl.roundBet,0);
  const str    = estimateHand(p);
  const pos    = posScore(G.players.indexOf(p));
  const price  = toCall===0?0:toCall/Math.max(1,pot+toCall);
  const short  = p.stack<=G.bigBlind*7;
  const texture= boardTexture();
  const bluff  = texture.wet&&Math.random()<prof.bluff+pos*.1;
  const conf   = str+prof.agg*.13+pos*.09+(short?.15:0);
  const free   = toCall===0;

  // Fold if price is too steep
  if(!free&&!short&&conf+prof.loose*.14<price+.18){
    applyAction(p,"fold"); return;
  }
  // Raise/pressure if confident or bluffing
  if((conf>.70||bluff||(short&&conf>.45))&&p.stack>toCall+G.bigBlind){
    const factor = bluff?.5:conf;
    const sizeTo = G.currentBet+Math.round((G.bigBlind+pot*(.3+factor*.5))/25)*25;
    const cap    = p.roundBet+p.stack;
    const rTo    = Math.min(cap,Math.max(G.currentBet+G.minRaise,sizeTo));
    applyAction(p,(rTo>=cap&&short)?"allin":"raise",rTo);
    return;
  }
  applyAction(p, free?"check":"call");
}

function estimateHand(p) {
  if(G.community.length>=3){
    const r=evalHand([...p.cards,...G.community]);
    return Math.min(.97,r.cat/9+r.k[0]/100);
  }
  const [a,b]=p.cards;
  if(!a||!b) return .25;
  const hi=Math.max(a.val,b.val),lo=Math.min(a.val,b.val);
  let s=(hi-2)/15;
  if(a.val===b.val)s+=.32+hi/90;
  if(a.suit===b.suit)s+=.07;
  if(Math.abs(a.val-b.val)<=2)s+=.05;
  if(hi>=13&&lo>=10)s+=.11;
  return clamp(s,.05,.95);
}

function posScore(idx){
  const order=[];let c=G.dealer;
  for(let i=0;i<G.players.length;i++){
    const n=nextActive(c);if(n===null)break;order.push(n);c=n;
  }
  const spot=order.indexOf(idx);
  return spot<0?0:spot/Math.max(1,order.length-1);
}

function boardTexture(){
  if(!G.community.length)return{wet:false};
  const suits=new Map();
  const vals=G.community.map(c=>c.val).sort((a,b)=>a-b);
  G.community.forEach(c=>suits.set(c.suit,(suits.get(c.suit)||0)+1));
  const flush=[...suits.values()].some(v=>v>=3);
  let straight=false;
  for(let i=0;i<vals.length-2;i++)if(vals[i+2]-vals[i]<=4)straight=true;
  return{wet:flush||straight};
}

// ── AWARD / SHOWDOWN ──────────────────────────────────────
function awardUncontested() {
  syncPot();
  const winner=inHand().find(p=>!p.folded);
  if(!winner){endHand("Hand Over","(No winner found)");return;}
  winner.stack+=G.pot;
  if(winner.human) winner.stats.wins++;
  addLog(`${winner.name} wins ${money(G.pot)} — everyone else folded.`);
  endHand(`${winner.name} Wins`,`Collected ${money(G.pot)} uncontested.`);
}

function doShowdown() {
  syncPot();
  G.revealCards=revealAI;
  G.phase="showdown";
  const alive=inHand().filter(p=>!p.folded);
  alive.forEach(p=>{
    p.handRank=evalHand([...p.cards,...G.community]);
    if(p.human) p.stats.showdowns++;
  });
  const pots=sidePots();
  const awards=[];
  for(const sp of pots){
    const elig=sp.elig.filter(p=>!p.folded);
    if(!elig.length)continue;
    const best=elig.reduce((t,p)=>!t||cmpHands(p.handRank,t.handRank)>0?p:t,null);
    const winners=elig.filter(p=>cmpHands(p.handRank,best.handRank)===0);
    const share=Math.floor(sp.amt/winners.length);
    let rem=sp.amt-share*winners.length;
    winners.forEach(w=>{
      w.stack+=share+(rem-->0?1:0);
      awards.push({player:w,amt:share,hand:w.handRank.name});
      if(w.human) w.stats.wins++;
    });
  }
  if(!awards.length){endHand("Showdown","(No awards)");return;}
  const top=awards.sort((a,b)=>b.amt-a.amt)[0];
  const detail=awards.map(a=>`${a.player.name} wins ${money(a.amt)} with ${a.hand}`).join(". ");
  addLog(detail+".");
  endHand(`${top.player.name} Wins`,detail);
}

function sidePots() {
  const levels=[...new Set(G.players.filter(p=>p.invested>0).map(p=>p.invested))].sort((a,b)=>a-b);
  const pots=[];let prev=0;
  for(const lv of levels){
    const contrib=G.players.filter(p=>p.invested>=lv);
    const amt=(lv-prev)*contrib.length;
    if(amt>0) pots.push({amt,elig:contrib.filter(p=>p.active)});
    prev=lv;
  }
  return pots;
}

function endHand(title,detail) {
  G.handDone=true; G.phase="done"; G.actingIdx=null; G.pot=0;
  waitHuman=false;
  eliminateBusted();
  const hero=G.players[0];
  hero.stats.best=Math.max(hero.stats.best,hero.stack);
  G.history.unshift({
    title,detail,hand:G.handsPlayed,level:G.level,
    time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})
  });
  G.history=G.history.slice(0,40);
  updateRank(title);
  showWin(title,detail);
  glowWinner(title);
  render();
  save();
  if(active().length<=1){setTimeout(endTournament,900);return;}
  if(autoDeal) setTimeout(startHand,2600);
}

function eliminateBusted(){
  G.players.forEach(p=>{
    if(p.active&&p.stack<=0&&G.handDone){
      p.active=false;
      addLog(`${p.name} has been eliminated.`);
    }
  });
}

function endTournament(){
  const w=active()[0]||G.players.reduce((a,b)=>a.stack>b.stack?a:b);
  G.handDone=true; G.phase="tournament_over";
  showWin("Tournament Complete",`${w.name} takes the final stack!`);
  addLog(`Tournament over. ${w.name} wins.`);
  updateRank(`${w.name} champion`);
  render(); save();
}

function updateRank(result){
  G.leaderboard.unshift({
    result,stack:G.players[0].stack,
    hands:G.handsPlayed,date:new Date().toLocaleDateString()
  });
  G.leaderboard=G.leaderboard.slice(0,10);
}

// ── HAND EVALUATOR ────────────────────────────────────────
function evalHand(cards){
  const bv=new Map(), bs=new Map();
  cards.forEach(c=>{
    bv.set(c.val,[...(bv.get(c.val)||[]),c]);
    bs.set(c.suit,[...(bs.get(c.suit)||[]),c]);
  });
  const vd=[...new Set(cards.map(c=>c.val))].sort((a,b)=>b-a);
  const fg=[...bs.values()].find(g=>g.length>=5);
  if(fg){
    const sh=strHigh(fg.map(c=>c.val));
    if(sh) return mk(sh===14?9:8,[sh],sh===14?"Royal Flush":"Straight Flush");
  }
  const grps=[...bv.entries()].map(([v,g])=>({v,n:g.length})).sort((a,b)=>b.n-a.n||b.v-a.v);
  const q=grps.find(g=>g.n===4);
  if(q) return mk(7,[q.v,...vd.filter(v=>v!==q.v).slice(0,1)],"Four of a Kind");
  const tr=grps.filter(g=>g.n===3),pr=grps.filter(g=>g.n===2);
  if(tr.length&&(pr.length||tr.length>1)) return mk(6,[tr[0].v,tr.length>1?tr[1].v:pr[0].v],"Full House");
  if(fg) return mk(5,fg.map(c=>c.val).sort((a,b)=>b-a).slice(0,5),"Flush");
  const st=strHigh(vd);
  if(st) return mk(4,[st],"Straight");
  if(tr.length) return mk(3,[tr[0].v,...vd.filter(v=>v!==tr[0].v).slice(0,2)],"Three of a Kind");
  if(pr.length>=2){const pv=pr.map(p=>p.v).sort((a,b)=>b-a).slice(0,2);return mk(2,[...pv,vd.find(v=>!pv.includes(v))],"Two Pair");}
  if(pr.length) return mk(1,[pr[0].v,...vd.filter(v=>v!==pr[0].v).slice(0,3)],"One Pair");
  return mk(0,vd.slice(0,5),"High Card");
}
function strHigh(vals){
  const u=[...new Set(vals)].sort((a,b)=>b-a);
  if(u.includes(14))u.push(1);
  for(let i=0;i<=u.length-5;i++){
    const r=u.slice(i,i+5);
    if(r[0]-r[4]===4&&new Set(r).size===5) return r[0]===1?5:r[0];
  }
  return 0;
}
function mk(cat,k,name){return{cat,k,name:name||HAND_NAMES[cat]};}
function cmpHands(a,b){
  if(a.cat!==b.cat) return a.cat-b.cat;
  for(let i=0;i<Math.max(a.k.length,b.k.length);i++){
    const d=(a.k[i]||0)-(b.k[i]||0);if(d)return d;
  }
  return 0;
}

// ── RENDER ────────────────────────────────────────────────
function render(){
  // Top bar
  E.lvl.textContent    = G.level;
  E.blinds.textContent = `${money(G.smallBlind)}/${money(G.bigBlind)}`;
  E.handN.textContent  = G.handsPlayed;
  E.phase.textContent  = G.phase.toUpperCase();
  E.streetLabel.textContent = ["preflop","flop","turn","river","showdown"].includes(G.phase)
    ? G.phase.toUpperCase() : "";

  // Pot
  const totalPot=G.pot+G.players.reduce((s,p)=>s+p.roundBet,0);
  E.potAmt.textContent=money(totalPot);
  if(totalPot!==prevPot&&totalPot>0){
    E.pot.classList.remove("bump");
    void E.pot.offsetWidth;
    E.pot.classList.add("bump");
    prevPot=totalPot;
  }

  // Turn label
  if(G.actingIdx!==null&&!G.handDone){
    E.turnLabel.textContent=`${G.players[G.actingIdx].name} to act`;
  } else {
    E.turnLabel.textContent=G.handDone?"Between hands":"Waiting";
  }

  renderSeats();
  renderCommunity();
  renderControls();
  renderPanels();
}

function renderSeats(){
  // First time: build seats once
  if(!E.seats.hasChildNodes()){
    E.seats.innerHTML = G.players.map((p,i)=>`
      <div class="seat" data-p="${p.seat}" data-i="${i}">
        <div class="chip"></div>
        <div class="seat-inner">
          <div class="seat-head">
            <strong class="name"></strong>
            <span class="badge"></span>
          </div>
          <div class="seat-cards"></div>
          <div class="hand-label"></div>
          <div class="seat-stack">
            <span class="action"></span>
            <strong class="stack"></strong>
          </div>
        </div>
      </div>
    `).join("");
  }

  // Update ONLY what changed
  G.players.forEach((p,i)=>{
    const seat = E.seats.querySelector(`[data-i="${i}"]`);
    if(!seat) return;

    // classes
    seat.classList.toggle("active", i===G.actingIdx && !G.handDone);
    seat.classList.toggle("folded", p.folded);
    seat.classList.toggle("out", !p.active);

    // name
    seat.querySelector(".name").textContent = p.name;

    // badge
    const badge = seat.querySelector(".badge");
    const b = i===G.dealer?"D":i===G.sbSeat?"S":i===G.bbSeat?"B":"";
    badge.textContent = b;

    // stack + action
    seat.querySelector(".stack").textContent = money(p.stack);
    seat.querySelector(".action").textContent =
      !p.active ? "Out" : p.allIn ? "All In" : p.lastAction || "";

    // chip
    const chip = seat.querySelector(".chip");
    if(p.roundBet > 0){
      chip.textContent = money(p.roundBet);
      chip.classList.add("show");
    } else {
      chip.textContent = "";
      chip.classList.remove("show");
    }

    // cards (still re-rendered, but that's OK)
    const hidden = !p.human && !G.revealCards;
    const animate = !p.hasRendered;

    seat.querySelector(".seat-cards").innerHTML =
      (p.cards && p.cards.length)
        ? p.cards.map((c,ci)=>cardHtml_(c,hidden,ci,animate)).join("")
        : cardHtml_(null,true,0,animate) + cardHtml_(null,true,1,animate);

    // showdown hand label
    const hl = seat.querySelector(".hand-label");
    hl.textContent = (G.phase==="showdown" && p.handRank && !p.folded)
      ? p.handRank.name : "";
  });

  // mark rendered
  G.players.forEach(p => p.hasRendered = true);
}

function cardHtml_(card, hidden, idx, animate){
  const delay = idx * 72;

  if(!card || hidden){
    return `<div class="card back ${animate ? 'anim' : ''}" 
      style="${animate ? `animation-delay:${delay}ms` : ''}"></div>`;
  }

  const red = (card.suit==="H"||card.suit==="D") ? " red" : "";
  const sym = SYM[card.suit];

  return `<div class="card${red} ${animate ? 'anim' : ''}" 
    style="${animate ? `animation-delay:${delay}ms` : ''}">
    <div class="c-rank">${card.rank}</div>
    <div class="c-pip">${sym}</div>
    <div class="c-rank2">${card.rank}</div>
  </div>`;
}

function renderCommunity(){
  const cards = [...G.community];
  while(cards.length < 5) cards.push(null);

  E.community.innerHTML = cards.map((c,i)=>{
    if(!c) return `<div class="card back" style="opacity:.2"></div>`;

    const isNew = i >= prevComLen;
    const delay = isNew ? (i - prevComLen) * 110 : 0;

    const red = (c.suit==="H"||c.suit==="D") ? " red" : "";
    const sym = SYM[c.suit];

    return `<div class="card${red} ${isNew ? 'anim' : ''}" 
      style="${isNew ? `animation-delay:${delay}ms` : ''}">
      <div class="c-rank">${c.rank}</div>
      <div class="c-pip">${sym}</div>
      <div class="c-rank2">${c.rank}</div>
    </div>`;
  }).join("");

  prevComLen = G.community.length;
}

function renderControls(){
  const p=G.actingIdx!==null?G.players[G.actingIdx]:null;
  const myTurn=!!(p?.human&&!G.handDone&&waitHuman);
  const toCall=myTurn?Math.max(0,G.currentBet-p.roundBet):0;

  E.btnFold.disabled    = !myTurn;
  E.btnCheck.disabled   = !myTurn||toCall>0;
  E.btnCall.disabled    = !myTurn||toCall===0;
  E.btnRaise.disabled   = !myTurn||!p||p.stack<=toCall;
  E.btnAllIn.disabled   = !myTurn;
  E.btnDeal.disabled    = !G.handDone||active().length<=1;
  E.btnCall.textContent = toCall>0?`Call ${money(toCall)}`:"Call";

  if(myTurn&&p){
    const minR=Math.min(p.roundBet+p.stack,Math.max(G.currentBet+G.minRaise,G.bigBlind));
    const maxR=p.roundBet+p.stack;
    E.raiseSlider.min  = minR;
    E.raiseSlider.max  = Math.max(minR,maxR);
    E.raiseSlider.step = G.bigBlind>=100?50:25;
    E.raiseSlider.value= clamp(+E.raiseSlider.value,+E.raiseSlider.min,+E.raiseSlider.max);
  }
  E.raiseDisplay.textContent=money(+E.raiseSlider.value);
}

function renderPanels(){
  const h=G.players[0];
  E.sWins.textContent  = h.stats.wins;
  E.sShows.textContent = h.stats.showdowns;
  E.sVpip.textContent  = h.stats.hands?`${Math.round(h.stats.vpip/h.stats.hands*100)}%`:"0%";
  E.sBest.textContent  = money(h.stats.best);

  E.aiStats.innerHTML=G.players.filter(p=>!p.human).map(p=>`
    <div class="li">
      <div class="li-row"><strong>${p.name}</strong><span>${p.active?money(p.stack):"Eliminated"}</span></div>
      <div class="li-sub">${p.profile.style}</div>
    </div>`).join("");

  E.historyList.innerHTML=G.history.length
    ?G.history.map(e=>`<div class="li sm"><strong>Hand ${e.hand} · Lv ${e.level}</strong> · ${e.time}<br>${e.detail}</div>`).join("")
    :`<div class="li sm">Hand results appear here.</div>`;

  E.rankList.innerHTML=G.leaderboard.length
    ?G.leaderboard.map((e,i)=>`
      <div class="li">
        <div class="li-row"><span>${i+1}. ${e.result}</span><strong>${money(e.stack)}</strong></div>
        <div class="li-sub">${e.date} · ${e.hands} hands</div>
      </div>`).join("")
    :`<div class="li sm">No tournament scores yet.</div>`;

  E.log.innerHTML=G.logs.slice(0,30)
    .map(l=>`<div class="log-entry">${l}</div>`).join("");
}

// ── UI HELPERS ────────────────────────────────────────────
function setDec(title, text){
  const d=E.decTitle.querySelector(".dots");
  if(d)d.remove();
  E.decTitle.textContent=title;
  E.decText.textContent=text;
}
function showDots(){
  if(E.decTitle.querySelector(".dots"))return;
  const d=document.createElement("span");
  d.className="dots";
  d.innerHTML="<i></i><i></i><i></i>";
  E.decTitle.appendChild(d);
}
function hideDots(){
  const d=E.decTitle.querySelector(".dots");
  if(d)d.remove();
}

function buildDecText(p){
  const toCall=Math.max(0,G.currentBet-p.roundBet);
  const pot=G.pot+G.players.reduce((s,pl)=>s+pl.roundBet,0);
  const ph=G.phase.charAt(0).toUpperCase()+G.phase.slice(1);
  return toCall===0
    ?`${ph} — You may check or open the betting. Stack: ${money(p.stack)}.`
    :`${ph} — It costs ${money(toCall)} to call. Pot is ${money(pot)}.`;
}

function addLog(txt){
  G.logs.unshift(txt);
  G.logs=G.logs.slice(0,100);
}

let winTimer=null;
function showWin(name,detail){
  E.winName.textContent=name;
  E.winDetail.textContent=detail;
  E.winOverlay.classList.add("show");
  spawnConfetti();
  if(winTimer)clearTimeout(winTimer);
  winTimer=setTimeout(hideWin,2600);
}
function hideWin(){E.winOverlay.classList.remove("show");}

function glowWinner(title){
  const name=title.replace(/ Wins$/,"").trim();
  G.players.forEach((p,i)=>{
    const s=E.seats.querySelector(`[data-i="${i}"]`);
    if(s&&p.name===name) s.classList.add("glow");
  });
}
function clearGlow(){
  document.querySelectorAll(".seat.glow").forEach(s=>s.classList.remove("glow"));
}

function spawnConfetti(){
  const c=E.confettiLayer; c.innerHTML="";
  const cols=["#efd08c","#c9a763","#75c899","#d7685f","#b0cce0","#fff"];
  for(let i=0;i<32;i++){
    const el=document.createElement("div");
    el.className="cp";
    const sz=rnd(5,11);
    el.style.cssText=`left:${rnd(4,96)}%;top:${rnd(2,38)}%;
      width:${sz}px;height:${sz}px;
      background:${cols[0|Math.random()*cols.length]};
      border-radius:${Math.random()>.5?"50%":"2px"};
      animation-delay:${rnd(0,500)}ms;
      animation-duration:${rnd(900,1600)}ms;`;
    c.appendChild(el);
  }
}

function showToast(txt){
  E.toast.textContent=txt;
  E.toast.classList.add("show");
  setTimeout(()=>E.toast.classList.remove("show"),2300);
}

function clearAI(){if(aiTimer){clearTimeout(aiTimer);aiTimer=null;}}
function clearTimers(){
  clearAI();
  clearActionTimer();
  clearStreetTimer();
}

// ── SOUND ────────────────────────────────────────────────
function playSound(freq,dur,type="sine"){
  if(!soundOn)return;
  try{
    audioCtx=audioCtx||new(window.AudioContext||window.webkitAudioContext)();
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.type=type;o.frequency.value=freq;
    g.gain.setValueAtTime(.0001,audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(.075,audioCtx.currentTime+.014);
    g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+dur);
    o.connect(g).connect(audioCtx.destination);
    o.start();o.stop(audioCtx.currentTime+dur+.02);
  }catch{}
}

// ── SAVE / LOAD ───────────────────────────────────────────
function save(manual=false){
  try{localStorage.setItem(SAVE_KEY,JSON.stringify(G));}catch{}
  E.saveLabel.textContent=manual?"Saved ✓":"Auto saved";
  if(manual)showToast("Saved to this browser.");
}
function load(){
  try{return sanitize(JSON.parse(localStorage.getItem(SAVE_KEY)));}
  catch{return newGame();}
}

// ── EVENTS ───────────────────────────────────────────────
function initEvents(){
  E.btnFold.onclick  = ()=>humanAct("fold");
  E.btnCall.onclick  = ()=>humanAct("call");
  E.btnCheck.onclick = ()=>humanAct("check");
  E.btnRaise.onclick = ()=>humanAct("raise",+E.raiseSlider.value);
  E.btnAllIn.onclick = ()=>humanAct("allin");
  E.btnDeal.onclick  = startHand;
  E.raiseSlider.oninput=()=>E.raiseDisplay.textContent=money(+E.raiseSlider.value);

  E.btnSave.onclick=()=>save(true);
  E.btnNew.onclick=()=>{
    clearTimers(); waitHuman=false; waitingForIdx=null;
    prevPot=0; prevComLen=0;
    G=newGame(); save(); render();
    showToast("New tournament — take your seat.");
    setTimeout(startHand,400);
  };
  E.btnSound.onclick=()=>{
    soundOn=!soundOn;
    E.btnSound.style.opacity=soundOn?"1":".38";
    showToast(soundOn?"Sound on.":"Muted.");
  };
  E.swAuto.onclick=()=>{
    autoDeal=!autoDeal;
    E.swAuto.classList.toggle("on",autoDeal);
    E.swAuto.setAttribute("aria-pressed",autoDeal);
  };
  E.swReveal.onclick=()=>{
    revealAI=!revealAI;
    E.swReveal.classList.toggle("on",revealAI);
    E.swReveal.setAttribute("aria-pressed",revealAI);
  };
  document.querySelectorAll(".tab").forEach(tab=>{
    tab.onclick=()=>{
      document.querySelectorAll(".tab").forEach(t=>t.classList.remove("on"));
      document.querySelectorAll(".tab-body").forEach(b=>b.classList.remove("on"));
      tab.classList.add("on");
      $(`${tab.dataset.tab}`).classList.add("on");
    };
  });
}

function cacheEls(){
  ["lvl","blinds","handN","phase","saveLabel",
   "community","potAmt","pot","streetLabel",
   "winOverlay","winName","winDetail","confettiLayer",
   "seats","turnLabel","decTitle","decText","raiseDisplay","raiseSlider",
   "btnFold","btnCall","btnRaise","btnCheck","btnAllIn","btnDeal",
   "swAuto","swReveal","log","toast",
   "sWins","sShows","sVpip","sBest",
   "aiStats","historyList","rankList",
   "btnSound","btnSave","btnNew"
  ].forEach(id=>E[id]=$(id));
}

// ── BOOT ─────────────────────────────────────────────────
function boot(){
  cacheEls();
  G=load();
  initEvents();
  render();
  setTimeout(startHand,700);
}
boot();

