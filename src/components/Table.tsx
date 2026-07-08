import { useEffect, useRef, useState } from 'react';
import { money } from '../engine/utils';
import type { GameState } from '../engine/types';
import type { WinEvent } from '../engine/GameEngine';
import { PlayingCard } from './PlayingCard';
import { Seat } from './Seat';

interface TableProps {
  state: GameState;
  revealAI: boolean;
  win: WinEvent | null;
}

const CONFETTI_COLORS = ['#efd08c', '#c9a763', '#75c899', '#d7685f', '#b0cce0', '#fff'];

function rnd(a: number, b: number) {
  return Math.random() * (b - a) + a;
}

export function Table({ state, revealAI, win }: TableProps) {
  const dealtLenRef = useRef<Map<string, number>>(new Map());
  const communityLenRef = useRef(0);
  const prevPotRef = useRef(0);
  const [potBump, setPotBump] = useState(false);
  const [confetti, setConfetti] = useState<{ id: number; style: React.CSSProperties }[]>([]);

  const totalPot = state.pot + state.players.reduce((s, p) => s + p.roundBet, 0);

  useEffect(() => {
    if (totalPot !== prevPotRef.current && totalPot > 0) {
      setPotBump(false);
      requestAnimationFrame(() => setPotBump(true));
      prevPotRef.current = totalPot;
    }
  }, [totalPot]);

  const seatAnimate = state.players.map((p) => dealtLenRef.current.get(p.id) !== p.cards.length && p.cards.length > 0);

  useEffect(() => {
    const map = dealtLenRef.current;
    const timer = setTimeout(() => {
      state.players.forEach((p) => map.set(p.id, p.cards.length));
    }, 500);
    return () => clearTimeout(timer);
  });

  useEffect(() => {
    if (win) {
      const pieces = Array.from({ length: 32 }, (_, i) => {
        const size = rnd(5, 11);
        return {
          id: i,
          style: {
            left: `${rnd(4, 96)}%`,
            top: `${rnd(2, 38)}%`,
            width: `${size}px`,
            height: `${size}px`,
            background: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            animationDelay: `${rnd(0, 500)}ms`,
            animationDuration: `${rnd(900, 1600)}ms`,
          } as React.CSSProperties,
        };
      });
      setConfetti(pieces);
    } else {
      setConfetti([]);
    }
  }, [win]);

  const communityCards = [...state.community];
  while (communityCards.length < 5) communityCards.push(null as never);
  const isNewCard = (i: number) => i >= communityLenRef.current;
  useEffect(() => {
    const timer = setTimeout(() => {
      communityLenRef.current = state.community.length;
    }, 500);
    return () => clearTimeout(timer);
  });

  const streetLabel = ['preflop', 'flop', 'turn', 'river', 'showdown'].includes(state.phase)
    ? state.phase.toUpperCase()
    : '';

  const winnerName = win?.name.replace(/ Wins$/, '').trim();

  return (
    <section className="table-wrap">
      <div className="table-felt-logo">MR</div>

      <div className="community">
        {communityCards.map((c, i) => (
          <PlayingCard key={i} card={c} faded={!c} animate={!!c && isNewCard(i)} index={isNewCard(i) ? i - communityLenRef.current : 0} />
        ))}
      </div>

      <div className={`pot${potBump ? ' bump' : ''}`}>
        <span>POT</span>
        <strong>{money(totalPot)}</strong>
      </div>

      <div className="street-label">{streetLabel}</div>

      <div className={`win-overlay${win ? ' show' : ''}`}>
        <div className="win-card">
          <div className="confetti-layer">
            {confetti.map((c) => (
              <div key={c.id} className="cp" style={c.style} />
            ))}
          </div>
          <div className="wlabel">Result</div>
          <span className="wname">{win?.name || 'Monarch Room'}</span>
          <div className="wdetail">{win?.detail || 'Welcome. Take your seat.'}</div>
        </div>
      </div>

      <div id="seats">
        {state.players.map((p, i) => (
          <Seat
            key={p.id}
            player={p}
            index={i}
            state={state}
            revealAI={revealAI}
            isGlowing={!!win && p.name === winnerName}
            animate={seatAnimate[i]}
          />
        ))}
      </div>
    </section>
  );
}
