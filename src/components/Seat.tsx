import { money } from '../engine/utils';
import type { GameState, Player } from '../engine/types';
import { PlayingCard } from './PlayingCard';

interface SeatProps {
  player: Player;
  index: number;
  state: GameState;
  revealAI: boolean;
  isGlowing: boolean;
  animate: boolean;
}

export function Seat({ player, index, state, revealAI, isGlowing, animate }: SeatProps) {
  const isActing = index === state.actingIdx && !state.handDone;
  const badge = index === state.dealer ? 'D' : index === state.sbSeat ? 'S' : index === state.bbSeat ? 'B' : '';
  const hidden = !player.human && !revealAI;
  const actionLabel = !player.active ? 'Out' : player.allIn ? 'All In' : player.lastAction || '';

  return (
    <div
      className={[
        'seat',
        isActing ? 'active' : '',
        player.folded ? 'folded' : '',
        !player.active ? 'out' : '',
        isGlowing ? 'glow' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-p={player.seat}
      data-i={index}
    >
      <div className={`chip${player.roundBet > 0 ? ' show' : ''}`}>
        {player.roundBet > 0 ? money(player.roundBet) : ''}
      </div>
      <div className="seat-inner">
        <div className="seat-head">
          <strong className="name">{player.name}</strong>
          <span className="badge">{badge}</span>
        </div>
        <div className="seat-cards">
          {player.cards.length ? (
            player.cards.map((c, i) => (
              <PlayingCard key={i} card={c} hidden={hidden} index={i} animate={animate} />
            ))
          ) : (
            <>
              <PlayingCard card={null} hidden index={0} animate={animate} />
              <PlayingCard card={null} hidden index={1} animate={animate} />
            </>
          )}
        </div>
        <div className="hand-label">
          {state.phase === 'showdown' && player.handRank && !player.folded ? player.handRank.name : ''}
        </div>
        <div className="seat-stack">
          <span className="action">{actionLabel}</span>
          <strong className="stack">{money(player.stack)}</strong>
        </div>
      </div>
    </div>
  );
}
