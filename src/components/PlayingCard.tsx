import { SYMBOLS } from '../engine/constants';
import type { Card } from '../engine/types';

interface PlayingCardProps {
  card: Card | null;
  hidden?: boolean;
  index?: number;
  animate?: boolean;
  faded?: boolean;
}

export function PlayingCard({ card, hidden, index = 0, animate, faded }: PlayingCardProps) {
  const delay = index * 72;
  const style = animate ? { animationDelay: `${delay}ms` } : faded ? { opacity: 0.2 } : undefined;

  if (!card || hidden) {
    return <div className={`card back${animate ? ' anim' : ''}`} style={style} />;
  }

  const red = card.suit === 'H' || card.suit === 'D';
  return (
    <div className={`card${red ? ' red' : ''}${animate ? ' anim' : ''}`} style={style}>
      <div className="c-rank">{card.rank}</div>
      <div className="c-pip">{SYMBOLS[card.suit]}</div>
      <div className="c-rank2">{card.rank}</div>
    </div>
  );
}
