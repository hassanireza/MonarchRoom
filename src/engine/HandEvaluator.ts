import { HAND_NAMES } from './constants';
import type { Card, HandRank } from './types';

/**
 * Stateless best-of-seven hand evaluator. Given any set of five to seven
 * cards, it determines the best five card poker hand and returns a
 * comparable rank descriptor.
 */
export class HandEvaluator {
  /** Evaluate the best hand available from the given cards (hole + community). */
  static evaluate(cards: Card[]): HandRank {
    const byValue = new Map<number, Card[]>();
    const bySuit = new Map<string, Card[]>();

    cards.forEach((c) => {
      byValue.set(c.val, [...(byValue.get(c.val) || []), c]);
      bySuit.set(c.suit, [...(bySuit.get(c.suit) || []), c]);
    });

    const distinctValuesDesc = [...new Set(cards.map((c) => c.val))].sort((a, b) => b - a);

    const flushGroup = [...bySuit.values()].find((g) => g.length >= 5);
    if (flushGroup) {
      const straightHigh = HandEvaluator.straightHigh(flushGroup.map((c) => c.val));
      if (straightHigh) {
        return HandEvaluator.make(
          straightHigh === 14 ? 9 : 8,
          [straightHigh],
          straightHigh === 14 ? 'Royal Flush' : 'Straight Flush'
        );
      }
    }

    const groups = [...byValue.entries()]
      .map(([v, g]) => ({ v, n: g.length }))
      .sort((a, b) => b.n - a.n || b.v - a.v);

    const quad = groups.find((g) => g.n === 4);
    if (quad) {
      return HandEvaluator.make(
        7,
        [quad.v, ...distinctValuesDesc.filter((v) => v !== quad.v).slice(0, 1)],
        'Four of a Kind'
      );
    }

    const trips = groups.filter((g) => g.n === 3);
    const pairs = groups.filter((g) => g.n === 2);

    if (trips.length && (pairs.length || trips.length > 1)) {
      return HandEvaluator.make(
        6,
        [trips[0].v, trips.length > 1 ? trips[1].v : pairs[0].v],
        'Full House'
      );
    }

    if (flushGroup) {
      return HandEvaluator.make(
        5,
        flushGroup
          .map((c) => c.val)
          .sort((a, b) => b - a)
          .slice(0, 5),
        'Flush'
      );
    }

    const straightHigh = HandEvaluator.straightHigh(distinctValuesDesc);
    if (straightHigh) return HandEvaluator.make(4, [straightHigh], 'Straight');

    if (trips.length) {
      return HandEvaluator.make(
        3,
        [trips[0].v, ...distinctValuesDesc.filter((v) => v !== trips[0].v).slice(0, 2)],
        'Three of a Kind'
      );
    }

    if (pairs.length >= 2) {
      const pairValues = pairs.map((p) => p.v).sort((a, b) => b - a).slice(0, 2);
      const kicker = distinctValuesDesc.find((v) => !pairValues.includes(v)) ?? 0;
      return HandEvaluator.make(2, [...pairValues, kicker], 'Two Pair');
    }

    if (pairs.length) {
      return HandEvaluator.make(
        1,
        [pairs[0].v, ...distinctValuesDesc.filter((v) => v !== pairs[0].v).slice(0, 3)],
        'One Pair'
      );
    }

    return HandEvaluator.make(0, distinctValuesDesc.slice(0, 5), 'High Card');
  }

  /** Compare two hand ranks. Positive means `a` beats `b`. */
  static compare(a: HandRank, b: HandRank): number {
    if (a.cat !== b.cat) return a.cat - b.cat;
    const len = Math.max(a.k.length, b.k.length);
    for (let i = 0; i < len; i++) {
      const diff = (a.k[i] || 0) - (b.k[i] || 0);
      if (diff) return diff;
    }
    return 0;
  }

  private static straightHigh(values: number[]): number {
    const unique = [...new Set(values)].sort((a, b) => b - a);
    if (unique.includes(14)) unique.push(1); // ace plays low for the wheel
    for (let i = 0; i <= unique.length - 5; i++) {
      const run = unique.slice(i, i + 5);
      if (run[0] - run[4] === 4 && new Set(run).size === 5) {
        return run[0] === 1 ? 5 : run[0];
      }
    }
    return 0;
  }

  private static make(cat: number, kickers: number[], name?: string): HandRank {
    return { cat, k: kickers, name: name || HAND_NAMES[cat] };
  }
}
