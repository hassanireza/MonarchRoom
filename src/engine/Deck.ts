import { RANKS, SUITS } from './constants';
import type { Card } from './types';

/** A single shuffled 52 card deck. Encapsulates all card creation and dealing. */
export class Deck {
  private cards: Card[] = [];

  constructor() {
    this.reset();
  }

  /** Rebuild and Fisher-Yates shuffle a fresh 52 card deck. */
  reset(): void {
    const cards: Card[] = [];
    for (const suit of SUITS) {
      RANKS.forEach((rank, i) => cards.push({ rank, suit, val: i + 2 }));
    }
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    this.cards = cards;
  }

  /** Remove and return the top card. */
  draw(): Card {
    const card = this.cards.pop();
    if (!card) {
      // Should never happen in a 6-max hold'em hand, but guard defensively.
      this.reset();
      return this.cards.pop() as Card;
    }
    return card;
  }

  /** Discard the top card without returning it (used before dealing new streets). */
  burn(): void {
    this.cards.pop();
  }

  get remaining(): number {
    return this.cards.length;
  }

  toJSON(): Card[] {
    return this.cards;
  }

  static fromJSON(cards: Card[]): Deck {
    const deck = new Deck();
    deck.cards = Array.isArray(cards) ? cards : [];
    return deck;
  }
}
