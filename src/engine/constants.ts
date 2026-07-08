import type { AiProfile, Suit } from './types';

export const SAVE_KEY = 'monarchRoomV5';

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const SYMBOLS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export const HAND_NAMES = [
  'High Card',
  'One Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
  'Royal Flush',
];

export const AI_PROFILES: AiProfile[] = [
  { name: 'Valentina', style: 'Balanced', agg: 0.58, loose: 0.42, bluff: 0.18 },
  { name: 'Soren', style: 'Pressure player', agg: 0.78, loose: 0.52, bluff: 0.32 },
  { name: 'Kaito', style: 'Mathematician', agg: 0.46, loose: 0.32, bluff: 0.12 },
  { name: 'Amara', style: 'Trap specialist', agg: 0.54, loose: 0.36, bluff: 0.21 },
  { name: 'Lucien', style: 'Wild card', agg: 0.84, loose: 0.62, bluff: 0.4 },
];

export const STARTING_STACK = 5000;
export const STARTING_SB = 25;
export const STARTING_BB = 50;
export const HANDS_PER_LEVEL = 6;
export const BLIND_GROWTH = 1.5;
