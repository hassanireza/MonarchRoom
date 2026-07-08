export type Suit = 'S' | 'H' | 'D' | 'C';

export interface Card {
  rank: string;
  suit: Suit;
  val: number;
}

export type Phase =
  | 'idle'
  | 'preflop'
  | 'flop'
  | 'turn'
  | 'river'
  | 'showdown'
  | 'done'
  | 'tournament_over';

export interface AiProfile {
  name: string;
  style: string;
  agg: number;
  loose: number;
  bluff: number;
}

export interface PlayerStats {
  hands: number;
  vpip: number;
  showdowns: number;
  wins: number;
  best: number;
}

export interface HandRank {
  cat: number;
  k: number[];
  name: string;
}

export interface Player {
  id: string;
  name: string;
  human: boolean;
  stack: number;
  active: boolean;
  seat: number;
  profile?: AiProfile;
  stats?: PlayerStats;

  cards: Card[];
  folded: boolean;
  allIn: boolean;
  roundBet: number;
  invested: number;
  acted: boolean;
  lastAction: string;
  hasRendered: boolean;
  handRank?: HandRank;
}

export interface HistoryEntry {
  title: string;
  detail: string;
  hand: number;
  level: number;
  time: string;
}

export interface LeaderboardEntry {
  result: string;
  stack: number;
  hands: number;
  date: string;
}

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface GameState {
  players: Player[];
  deck: Card[];
  community: Card[];

  dealer: number;
  sbSeat: number | null;
  bbSeat: number | null;

  phase: Phase;
  currentBet: number;
  minRaise: number;
  pot: number;
  actingIdx: number | null;
  handDone: boolean;
  revealCards: boolean;

  level: number;
  smallBlind: number;
  bigBlind: number;
  handsPlayed: number;
  handsAtLevel: number;

  history: HistoryEntry[];
  leaderboard: LeaderboardEntry[];
  logs: string[];
}

export interface SidePot {
  amt: number;
  elig: Player[];
}
