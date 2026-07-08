import { AIStrategy } from './AIStrategy';
import {
  AI_PROFILES,
  BLIND_GROWTH,
  HANDS_PER_LEVEL,
  SAVE_KEY,
  STARTING_BB,
  STARTING_SB,
  STARTING_STACK,
} from './constants';
import { Deck } from './Deck';
import { HandEvaluator } from './HandEvaluator';
import type { ActionType, GameState, HistoryEntry, Player, SidePot } from './types';

export type EngineEvent =
  | 'state'
  | 'log'
  | 'toast'
  | 'win'
  | 'sound'
  | 'thinking-start'
  | 'thinking-stop';

export interface SoundEvent {
  freq: number;
  dur: number;
  type?: OscillatorType;
}

export interface WinEvent {
  name: string;
  detail: string;
}

type Listener<T> = (payload: T) => void;

/**
 * MonarchEngine drives the entire Texas Hold'em tournament as a strict
 * finite state machine. It owns the canonical GameState and never allows
 * synchronous recursion: every transition is scheduled through a single
 * timer queue so the UI can re-render between every step.
 *
 * React never mutates state directly. It calls public methods
 * (startHand, act, toggle...) and subscribes to `onState` for updates.
 */
export class MonarchEngine {
  private state: GameState;
  private deck: Deck = new Deck();

  private waitHuman = false;
  private waitingForIdx: number | null = null;
  private autoDeal = false;
  private revealAI = true;
  private soundOn = true;

  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private actionTimer: ReturnType<typeof setTimeout> | null = null;
  private streetTimer: ReturnType<typeof setTimeout> | null = null;

  private stateListeners = new Set<Listener<GameState>>();
  private logListeners = new Set<Listener<string>>();
  private toastListeners = new Set<Listener<string>>();
  private winListeners = new Set<Listener<WinEvent>>();
  private soundListeners = new Set<Listener<SoundEvent>>();
  private thinkingListeners = new Set<Listener<{ name: string; style: string } | null>>();

  constructor() {
    this.state = this.load();
  }

  // ── PUBLIC SUBSCRIPTIONS ────────────────────────────────────────────
  onState(fn: Listener<GameState>): () => void {
    this.stateListeners.add(fn);
    fn(this.state);
    return () => this.stateListeners.delete(fn);
  }
  onLog(fn: Listener<string>): () => void {
    this.logListeners.add(fn);
    return () => this.logListeners.delete(fn);
  }
  onToast(fn: Listener<string>): () => void {
    this.toastListeners.add(fn);
    return () => this.toastListeners.delete(fn);
  }
  onWin(fn: Listener<WinEvent>): () => void {
    this.winListeners.add(fn);
    return () => this.winListeners.delete(fn);
  }
  onSound(fn: Listener<SoundEvent>): () => void {
    this.soundListeners.add(fn);
    return () => this.soundListeners.delete(fn);
  }
  onThinking(fn: Listener<{ name: string; style: string } | null>): () => void {
    this.thinkingListeners.add(fn);
    return () => this.thinkingListeners.delete(fn);
  }

  // ── PUBLIC GETTERS ──────────────────────────────────────────────────
  getState(): GameState {
    return this.state;
  }
  isWaitingForHuman(): boolean {
    return this.waitHuman;
  }
  getSettings() {
    return { soundOn: this.soundOn, autoDeal: this.autoDeal, revealAI: this.revealAI };
  }

  // ── SETTINGS ─────────────────────────────────────────────────────────
  setSoundOn(v: boolean): void {
    this.soundOn = v;
  }
  setAutoDeal(v: boolean): void {
    this.autoDeal = v;
  }
  setRevealAI(v: boolean): void {
    this.revealAI = v;
  }

  // ── LIFECYCLE ────────────────────────────────────────────────────────
  boot(): void {
    this.notify();
    this.scheduleTimeout(() => this.startHand(), 700);
  }

  destroy(): void {
    this.clearTimers();
  }

  newTournament(): void {
    this.clearTimers();
    this.waitHuman = false;
    this.waitingForIdx = null;
    this.state = this.createNewGame();
    this.save();
    this.notify();
    this.emitToast('New tournament, take your seat.');
    this.scheduleTimeout(() => this.startHand(), 400);
  }

  saveManually(): void {
    this.save(true);
  }

  // ── STATE FACTORY ────────────────────────────────────────────────────
  private createNewGame(): GameState {
    const players: Player[] = [
      {
        id: 'hero',
        name: 'You',
        human: true,
        stack: STARTING_STACK,
        active: true,
        seat: 0,
        stats: { hands: 0, vpip: 0, showdowns: 0, wins: 0, best: STARTING_STACK },
        cards: [],
        folded: false,
        allIn: false,
        roundBet: 0,
        invested: 0,
        acted: false,
        lastAction: '',
        hasRendered: false,
      },
      ...AI_PROFILES.map((profile, i) => ({
        id: `ai${i}`,
        name: profile.name,
        human: false,
        stack: STARTING_STACK,
        active: true,
        seat: i + 1,
        profile,
        cards: [],
        folded: false,
        allIn: false,
        roundBet: 0,
        invested: 0,
        acted: false,
        lastAction: '',
        hasRendered: false,
      })),
    ];

    return {
      players,
      deck: [],
      community: [],
      dealer: 0,
      sbSeat: null,
      bbSeat: null,
      phase: 'idle',
      currentBet: 0,
      minRaise: STARTING_BB,
      pot: 0,
      actingIdx: null,
      handDone: true,
      revealCards: false,
      level: 1,
      smallBlind: STARTING_SB,
      bigBlind: STARTING_BB,
      handsPlayed: 0,
      handsAtLevel: 0,
      history: [],
      leaderboard: [],
      logs: ["Welcome to the Monarch Room. Good luck."],
    };
  }

  // ── PLAYER QUERIES ───────────────────────────────────────────────────
  private active(): Player[] {
    return this.state.players.filter((p) => p.active && p.stack > 0);
  }
  private inHand(): Player[] {
    return this.state.players.filter((p) => p.active && !p.folded && (p.stack > 0 || p.invested > 0));
  }
  private canBet(): Player[] {
    return this.inHand().filter((p) => !p.allIn && p.stack > 0);
  }
  private nextActive(from: number): number | null {
    const n = this.state.players.length;
    for (let s = 1; s <= n; s++) {
      const i = (from + s) % n;
      if (this.state.players[i].active && this.state.players[i].stack > 0) return i;
    }
    return null;
  }
  private nextToAct(from: number): number | null {
    const n = this.state.players.length;
    for (let s = 1; s <= n; s++) {
      const i = (from + s) % n;
      const p = this.state.players[i];
      if (p.active && !p.folded && !p.allIn && p.stack > 0) return i;
    }
    return null;
  }

  // ── HAND START ────────────────────────────────────────────────────────
  startHand(): void {
    this.clearTimers();
    this.waitHuman = false;
    this.waitingForIdx = null;
    this.eliminateBusted();

    if (this.active().length <= 1) {
      this.endTournament();
      return;
    }

    const nb = this.nextActive(this.state.dealer);
    if (nb !== null) this.state.dealer = nb;

    this.resetHand();

    const live = this.active();
    let sbIdx: number;
    let bbIdx: number;

    if (live.length === 2) {
      sbIdx = this.state.dealer;
      bbIdx = this.nextActive(this.state.dealer)!;
    } else {
      sbIdx = this.nextActive(this.state.dealer)!;
      bbIdx = this.nextActive(sbIdx)!;
    }

    this.state.sbSeat = sbIdx;
    this.state.bbSeat = bbIdx;

    this.postBlind(sbIdx, this.state.smallBlind, 'small blind');
    this.postBlind(bbIdx, this.state.bigBlind, 'big blind');

    this.state.currentBet = this.state.players[bbIdx].roundBet;
    this.state.minRaise = this.state.bigBlind;

    const dealTo = this.state.players.filter((p) => p.active);
    for (let pass = 0; pass < 2; pass++) {
      dealTo.forEach((p) => p.cards.push(this.deck.draw()));
    }

    this.state.actingIdx = live.length === 2 ? this.state.dealer : this.nextToAct(bbIdx);

    this.state.handsPlayed++;
    this.state.handsAtLevel++;
    this.state.players[0].stats!.hands++;

    this.log(`Hand ${this.state.handsPlayed}. Dealer: ${this.state.players[this.state.dealer].name}.`);
    this.checkBlindsUp();
    this.save();
    this.notify();

    this.scheduleAction(60);
  }

  private resetHand(): void {
    this.state.players.forEach((p) => {
      p.cards = [];
      p.folded = false;
      p.allIn = false;
      p.roundBet = 0;
      p.invested = 0;
      p.acted = false;
      p.lastAction = '';
      p.hasRendered = false;
      delete p.handRank;
    });

    this.deck.reset();
    this.state.community = [];
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;
    this.state.pot = 0;
    this.state.actingIdx = null;
    this.state.handDone = false;
    this.state.revealCards = false;
    this.state.phase = 'preflop';
  }

  private postBlind(idx: number, amount: number, label: string): void {
    const p = this.state.players[idx];
    const chips = Math.min(p.stack, amount);
    p.stack -= chips;
    p.roundBet += chips;
    p.invested += chips;
    if (p.stack === 0) {
      p.allIn = true;
      p.acted = true;
    }
    this.log(`${p.name} posts ${label} (${this.fmt(chips)}).`);
  }

  private checkBlindsUp(): void {
    if (this.state.handsAtLevel >= HANDS_PER_LEVEL) {
      this.state.handsAtLevel = 0;
      this.state.level++;
      this.state.smallBlind = Math.round((this.state.smallBlind * BLIND_GROWTH) / 5) * 5;
      this.state.bigBlind = this.state.smallBlind * 2;
      this.state.minRaise = this.state.bigBlind;
      this.log(`Blinds up: ${this.fmt(this.state.smallBlind)}/${this.fmt(this.state.bigBlind)}.`);
      this.emitToast(`Level ${this.state.level}. Blinds ${this.fmt(this.state.smallBlind)}/${this.fmt(this.state.bigBlind)}`);
    }
  }

  // ── STREET COMPLETION ────────────────────────────────────────────────
  private isStreetDone(): boolean {
    const alive = this.inHand().filter((p) => !p.folded);
    if (alive.length <= 1) return true;

    const bettors = this.canBet();
    if (bettors.length === 0) return true;

    const allSettled = bettors.every((p) => p.acted && p.roundBet === this.state.currentBet);
    if (!allSettled) return false;

    if (this.state.phase === 'preflop') {
      const bb = this.state.bbSeat !== null ? this.state.players[this.state.bbSeat] : null;
      if (bb && !bb.folded && !bb.allIn && bb.stack > 0 && !bb.acted) return false;
    }
    return true;
  }

  // ── ACTION SCHEDULER ──────────────────────────────────────────────────
  private continueAction(): void {
    if (this.waitHuman) return;
    if (this.state.handDone) return;
    this.notify();

    if (this.inHand().filter((p) => !p.folded).length <= 1) {
      this.awardUncontested();
      return;
    }

    if (this.isStreetDone()) {
      this.scheduleStreetAdvance();
      return;
    }

    if (this.state.actingIdx === null) {
      this.state.actingIdx = this.nextToAct(this.state.dealer);
      if (this.state.actingIdx === null) {
        this.scheduleStreetAdvance();
        return;
      }
    }

    const p = this.state.players[this.state.actingIdx];

    if (!p || !p.active || p.folded || p.allIn || p.stack <= 0) {
      const nxt = this.nextToAct(this.state.actingIdx);
      if (nxt === null || nxt === this.state.actingIdx) {
        this.scheduleStreetAdvance();
        return;
      }
      this.state.actingIdx = nxt;
      this.scheduleAction(50);
      return;
    }

    if (p.human) {
      this.waitHuman = true;
      this.waitingForIdx = this.state.actingIdx;
      this.notify();
    } else {
      this.waitHuman = false;
      this.waitingForIdx = null;
      this.thinkingListeners.forEach((fn) => fn({ name: p.name, style: p.profile!.style }));
      this.notify();
      const delay = 550 + Math.random() * 500;
      this.aiTimer = setTimeout(() => {
        this.aiTimer = null;
        if (this.state.handDone) return;
        if (this.waitHuman) return;
        if (this.state.actingIdx === null || this.state.players[this.state.actingIdx] !== p) {
          this.scheduleAction(0);
          return;
        }
        this.thinkingListeners.forEach((fn) => fn(null));
        this.doAiAct(p);
        this.scheduleAction(100);
      }, delay);
    }
  }

  private scheduleStreetAdvance(): void {
    this.clearActionTimer();
    this.clearStreetTimer();
    this.streetTimer = setTimeout(() => {
      this.streetTimer = null;
      this.advanceStreet();
    }, 280);
  }

  private scheduleAction(delay = 0): void {
    this.clearActionTimer();
    this.actionTimer = setTimeout(() => {
      this.actionTimer = null;
      this.continueAction();
    }, delay);
  }

  private scheduleTimeout(fn: () => void, delay: number): void {
    setTimeout(fn, delay);
  }

  private clearAiTimer(): void {
    if (this.aiTimer) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
  }
  private clearActionTimer(): void {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
  }
  private clearStreetTimer(): void {
    if (this.streetTimer) {
      clearTimeout(this.streetTimer);
      this.streetTimer = null;
    }
  }
  private clearTimers(): void {
    this.clearAiTimer();
    this.clearActionTimer();
    this.clearStreetTimer();
  }

  // ── STREET ADVANCE ────────────────────────────────────────────────────
  private advanceStreet(): void {
    this.syncPot();

    const next: Record<string, string> = { preflop: 'flop', flop: 'turn', turn: 'river', river: 'showdown' };
    const count: Record<string, number> = { preflop: 3, flop: 1, turn: 1 };

    const nextPhase = next[this.state.phase];
    if (!nextPhase || nextPhase === 'showdown') {
      this.doShowdown();
      return;
    }

    this.deck.burn();
    const n = count[this.state.phase] || 0;
    for (let i = 0; i < n; i++) this.state.community.push(this.deck.draw());
    this.state.phase = nextPhase as GameState['phase'];
    this.log(`${nextPhase.toUpperCase()} dealt.`);

    this.state.players.forEach((p) => {
      p.roundBet = 0;
      p.acted = p.folded || p.allIn || !p.active || p.stack <= 0;
    });
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bigBlind;
    this.state.actingIdx = this.nextToAct(this.state.dealer);

    this.emitSound({ freq: 400, dur: 0.06 });
    this.notify();
    this.scheduleAction(520);
  }

  // ── HUMAN ACTION ENTRY POINT ──────────────────────────────────────────
  act(type: ActionType, amount?: number): void {
    if (!this.waitHuman || this.state.handDone) return;
    if (this.waitingForIdx !== this.state.actingIdx) return;
    const p = this.state.actingIdx !== null ? this.state.players[this.state.actingIdx] : null;
    if (!p || !p.human) return;
    this.clearTimers();
    this.waitHuman = false;
    this.waitingForIdx = null;
    this.applyAction(p, type, amount);
    this.notify();
    this.save();
    this.scheduleAction(80);
  }

  // ── APPLY ACTION ───────────────────────────────────────────────────────
  private applyAction(p: Player, type: ActionType, amount?: number): void {
    const toCall = Math.max(0, this.state.currentBet - p.roundBet);

    if (type === 'fold') {
      p.folded = true;
      p.acted = true;
      p.lastAction = 'Fold';
      this.log(`${p.name} folds.`);
      this.emitSound({ freq: 170, dur: 0.04 });
    } else if (type === 'check') {
      if (toCall > 0) {
        this.applyAction(p, 'call');
        return;
      }
      p.acted = true;
      p.lastAction = 'Check';
      this.log(`${p.name} checks.`);
      this.emitSound({ freq: 250, dur: 0.03 });
    } else if (type === 'call') {
      if (toCall === 0) {
        this.applyAction(p, 'check');
        return;
      }
      const paid = this.chipOut(p, toCall);
      p.acted = true;
      p.lastAction = `Call ${this.fmt(paid)}`;
      if (p.human && p.stats) p.stats.vpip++;
      this.log(`${p.name} calls ${this.fmt(paid)}.`);
      this.emitSound({ freq: 310, dur: 0.04, type: 'triangle' });
    } else if (type === 'raise') {
      const cap = p.roundBet + p.stack;
      const minTotal = this.state.currentBet + this.state.minRaise;
      const target = Math.min(Math.max(Number(amount) || minTotal, minTotal), cap);
      const prev = p.roundBet;
      this.chipOut(p, target - prev);
      const newBet = p.roundBet;

      if (newBet > this.state.currentBet) {
        const raised = newBet - this.state.currentBet;
        const fullRaise = raised >= this.state.minRaise;
        if (fullRaise) this.state.minRaise = Math.max(this.state.bigBlind, raised);
        this.state.currentBet = newBet;
        this.state.players.forEach((o) => {
          if (o !== p && !o.folded && !o.allIn && o.active && o.stack > 0) o.acted = false;
        });
        p.acted = true;
        p.lastAction = p.allIn ? 'All In' : `Raise ${this.fmt(newBet)}`;
        if (p.human && p.stats) p.stats.vpip++;
        this.log(
          fullRaise
            ? `${p.name} raises to ${this.fmt(newBet)}.`
            : `${p.name} is all in for ${this.fmt(newBet)}.`
        );
        this.emitSound({ freq: 530, dur: 0.055, type: 'triangle' });
      } else {
        p.acted = true;
        p.lastAction = 'All In';
        this.log(`${p.name} calls all in.`);
        this.emitSound({ freq: 310, dur: 0.04, type: 'triangle' });
      }
    } else if (type === 'allin') {
      const target = p.roundBet + p.stack;
      if (target > this.state.currentBet) this.applyAction(p, 'raise', target);
      else this.applyAction(p, 'call');
      if (!p.folded) p.lastAction = 'All In';
      this.syncPot();
      this.state.actingIdx = this.nextToAct(this.state.players.indexOf(p));
      return;
    }

    if (p.stack === 0) p.allIn = true;
    this.syncPot();
    this.state.actingIdx = this.nextToAct(this.state.players.indexOf(p));
  }

  private chipOut(p: Player, amount: number): number {
    const paid = Math.min(p.stack, Math.max(0, amount));
    p.stack -= paid;
    p.roundBet += paid;
    p.invested += paid;
    if (p.stack === 0) p.allIn = true;
    return paid;
  }

  private syncPot(): void {
    this.state.pot = this.state.players.reduce((s, p) => s + (p.invested || 0), 0);
  }

  // ── AI DECISION ────────────────────────────────────────────────────────
  private doAiAct(p: Player): void {
    const decision = AIStrategy.decide(this.state, p);
    this.applyAction(p, decision.type, decision.amount);
  }

  // ── AWARD / SHOWDOWN ─────────────────────────────────────────────────
  private awardUncontested(): void {
    this.syncPot();
    const winner = this.inHand().find((p) => !p.folded);
    if (!winner) {
      this.endHand('Hand Over', '(No winner found)');
      return;
    }
    winner.stack += this.state.pot;
    if (winner.human && winner.stats) winner.stats.wins++;
    this.log(`${winner.name} wins ${this.fmt(this.state.pot)}, everyone else folded.`);
    this.endHand(`${winner.name} Wins`, `Collected ${this.fmt(this.state.pot)} uncontested.`);
  }

  private doShowdown(): void {
    this.syncPot();
    this.state.revealCards = this.revealAI;
    this.state.phase = 'showdown';
    const alive = this.inHand().filter((p) => !p.folded);
    alive.forEach((p) => {
      p.handRank = HandEvaluator.evaluate([...p.cards, ...this.state.community]);
      if (p.human && p.stats) p.stats.showdowns++;
    });

    const pots = this.sidePots();
    const awards: { player: Player; amt: number; hand: string }[] = [];
    for (const sp of pots) {
      const elig = sp.elig.filter((p) => !p.folded);
      if (!elig.length) continue;
      const best = elig.reduce<Player | null>(
        (top, p) => (!top || HandEvaluator.compare(p.handRank!, top.handRank!) > 0 ? p : top),
        null
      )!;
      const winners = elig.filter((p) => HandEvaluator.compare(p.handRank!, best.handRank!) === 0);
      const share = Math.floor(sp.amt / winners.length);
      let rem = sp.amt - share * winners.length;
      winners.forEach((w) => {
        w.stack += share + (rem-- > 0 ? 1 : 0);
        awards.push({ player: w, amt: share, hand: w.handRank!.name });
        if (w.human && w.stats) w.stats.wins++;
      });
    }

    if (!awards.length) {
      this.endHand('Showdown', '(No awards)');
      return;
    }
    const top = [...awards].sort((a, b) => b.amt - a.amt)[0];
    const detail = awards.map((a) => `${a.player.name} wins ${this.fmt(a.amt)} with ${a.hand}`).join('. ');
    this.log(`${detail}.`);
    this.endHand(`${top.player.name} Wins`, detail);
  }

  private sidePots(): SidePot[] {
    const levels = [...new Set(this.state.players.filter((p) => p.invested > 0).map((p) => p.invested))].sort(
      (a, b) => a - b
    );
    const pots: SidePot[] = [];
    let prev = 0;
    for (const lv of levels) {
      const contrib = this.state.players.filter((p) => p.invested >= lv);
      const amt = (lv - prev) * contrib.length;
      if (amt > 0) pots.push({ amt, elig: contrib.filter((p) => p.active) });
      prev = lv;
    }
    return pots;
  }

  private endHand(title: string, detail: string): void {
    this.state.handDone = true;
    this.state.phase = 'done';
    this.state.actingIdx = null;
    this.state.pot = 0;
    this.waitHuman = false;
    this.eliminateBusted();

    const hero = this.state.players[0];
    if (hero.stats) hero.stats.best = Math.max(hero.stats.best, hero.stack);

    const entry: HistoryEntry = {
      title,
      detail,
      hand: this.state.handsPlayed,
      level: this.state.level,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    this.state.history = [entry, ...this.state.history].slice(0, 40);
    this.updateLeaderboard(title);

    this.winListeners.forEach((fn) => fn({ name: title, detail }));
    this.notify();
    this.save();

    if (this.active().length <= 1) {
      this.scheduleTimeout(() => this.endTournament(), 900);
      return;
    }
    if (this.autoDeal) this.scheduleTimeout(() => this.startHand(), 2600);
  }

  private eliminateBusted(): void {
    this.state.players.forEach((p) => {
      if (p.active && p.stack <= 0 && this.state.handDone) {
        p.active = false;
        this.log(`${p.name} has been eliminated.`);
      }
    });
  }

  private endTournament(): void {
    const w = this.active()[0] || this.state.players.reduce((a, b) => (a.stack > b.stack ? a : b));
    this.state.handDone = true;
    this.state.phase = 'tournament_over';
    this.winListeners.forEach((fn) => fn({ name: 'Tournament Complete', detail: `${w.name} takes the final stack.` }));
    this.log(`Tournament over. ${w.name} wins.`);
    this.updateLeaderboard(`${w.name} champion`);
    this.notify();
    this.save();
  }

  private updateLeaderboard(result: string): void {
    this.state.leaderboard = [
      {
        result,
        stack: this.state.players[0].stack,
        hands: this.state.handsPlayed,
        date: new Date().toLocaleDateString(),
      },
      ...this.state.leaderboard,
    ].slice(0, 10);
  }

  // ── UTIL ────────────────────────────────────────────────────────────
  private fmt(v: number): string {
    return Math.max(0, Math.round(v)).toLocaleString('en-US');
  }

  private log(txt: string): void {
    this.state.logs = [txt, ...this.state.logs].slice(0, 100);
    this.logListeners.forEach((fn) => fn(txt));
  }

  private emitToast(txt: string): void {
    this.toastListeners.forEach((fn) => fn(txt));
  }

  private emitSound(evt: SoundEvent): void {
    if (!this.soundOn) return;
    this.soundListeners.forEach((fn) => fn(evt));
  }

  private notify(): void {
    // Shallow-clone so React sees a new reference and re-renders.
    this.state = { ...this.state };
    this.stateListeners.forEach((fn) => fn(this.state));
  }

  // ── PERSISTENCE ───────────────────────────────────────────────────────
  private save(_manual = false): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
    } catch {
      /* storage unavailable, ignore */
    }
  }

  private load(): GameState {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return this.createNewGame();
      const parsed = JSON.parse(raw);
      return this.sanitize(parsed);
    } catch {
      return this.createNewGame();
    }
  }

  private sanitize(raw: unknown): GameState {
    try {
      const data = raw as Partial<GameState>;
      if (!data || !Array.isArray(data.players) || data.players.length < 2) return this.createNewGame();
      const base = this.createNewGame();
      return {
        ...base,
        ...data,
        players: base.players.map((b, i) => ({ ...b, ...(data.players![i] || {}) })),
        handDone: true,
        phase: 'idle',
        actingIdx: null,
      };
    } catch {
      return this.createNewGame();
    }
  }
}
