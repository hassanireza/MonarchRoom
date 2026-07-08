import { HandEvaluator } from './HandEvaluator';
import { clamp } from './utils';
import type { Card, GameState, Player } from './types';

export interface AiDecision {
  type: 'fold' | 'check' | 'call' | 'raise' | 'allin';
  amount?: number;
}

/**
 * Encapsulates every heuristic an AI opponent uses to decide its action.
 * Pure and stateless: given a game snapshot and a player, it returns a
 * decision. This keeps opponent "personality" logic isolated from the
 * turn scheduling and state mutation living in GameEngine.
 */
export class AIStrategy {
  /** Decide the next action for the given AI player based on the current state. */
  static decide(state: GameState, player: Player): AiDecision {
    const profile = player.profile!;
    const toCall = Math.max(0, state.currentBet - player.roundBet);
    const pot = state.pot + state.players.reduce((s, p) => s + p.roundBet, 0);
    const strength = AIStrategy.estimateHandStrength(state, player);
    const position = AIStrategy.positionScore(state, state.players.indexOf(player));
    const price = toCall === 0 ? 0 : toCall / Math.max(1, pot + toCall);
    const short = player.stack <= state.bigBlind * 7;
    const texture = AIStrategy.boardTexture(state.community);
    const bluff = texture.wet && Math.random() < profile.bluff + position * 0.1;
    const confidence = strength + profile.agg * 0.13 + position * 0.09 + (short ? 0.15 : 0);
    const free = toCall === 0;

    if (!free && !short && confidence + profile.loose * 0.14 < price + 0.18) {
      return { type: 'fold' };
    }

    if ((confidence > 0.7 || bluff || (short && confidence > 0.45)) && player.stack > toCall + state.bigBlind) {
      const factor = bluff ? 0.5 : confidence;
      const sizeTo = state.currentBet + Math.round((state.bigBlind + pot * (0.3 + factor * 0.5)) / 25) * 25;
      const cap = player.roundBet + player.stack;
      const raiseTo = Math.min(cap, Math.max(state.currentBet + state.minRaise, sizeTo));
      return { type: raiseTo >= cap && short ? 'allin' : 'raise', amount: raiseTo };
    }

    return { type: free ? 'check' : 'call' };
  }

  /** Rough 0..1 strength estimate: pre-flop hand chart heuristic, post-flop real evaluation. */
  private static estimateHandStrength(state: GameState, player: Player): number {
    if (state.community.length >= 3) {
      const rank = HandEvaluator.evaluate([...player.cards, ...state.community]);
      return Math.min(0.97, rank.cat / 9 + rank.k[0] / 100);
    }
    const [a, b] = player.cards;
    if (!a || !b) return 0.25;
    const hi = Math.max(a.val, b.val);
    const lo = Math.min(a.val, b.val);
    let score = (hi - 2) / 15;
    if (a.val === b.val) score += 0.32 + hi / 90;
    if (a.suit === b.suit) score += 0.07;
    if (Math.abs(a.val - b.val) <= 2) score += 0.05;
    if (hi >= 13 && lo >= 10) score += 0.11;
    return clamp(score, 0.05, 0.95);
  }

  /** 0 (early position) .. 1 (last to act) score relative to the dealer button. */
  private static positionScore(state: GameState, idx: number): number {
    const order: number[] = [];
    let cursor = state.dealer;
    for (let i = 0; i < state.players.length; i++) {
      const next = AIStrategy.nextActiveSeat(state, cursor);
      if (next === null) break;
      order.push(next);
      cursor = next;
    }
    const spot = order.indexOf(idx);
    return spot < 0 ? 0 : spot / Math.max(1, order.length - 1);
  }

  private static nextActiveSeat(state: GameState, from: number): number | null {
    for (let s = 1; s <= state.players.length; s++) {
      const i = (from + s) % state.players.length;
      if (state.players[i].active && state.players[i].stack > 0) return i;
    }
    return null;
  }

  /** Detect "wet" boards (flush or straight draws present) to modulate bluff frequency. */
  private static boardTexture(community: Card[]): { wet: boolean } {
    if (!community.length) return { wet: false };
    const suits = new Map<string, number>();
    const values = community.map((c) => c.val).sort((a, b) => a - b);
    community.forEach((c) => suits.set(c.suit, (suits.get(c.suit) || 0) + 1));
    const flush = [...suits.values()].some((v) => v >= 3);
    let straight = false;
    for (let i = 0; i < values.length - 2; i++) {
      if (values[i + 2] - values[i] <= 4) straight = true;
    }
    return { wet: flush || straight };
  }
}
