import { useEffect, useState } from 'react';
import { money } from '../engine/utils';
import type { GameState } from '../engine/types';
import type { ThinkingInfo } from '../hooks/useMonarchEngine';

interface ControlPanelProps {
  state: GameState;
  waitingForHuman: boolean;
  thinking: ThinkingInfo | null;
  autoDeal: boolean;
  revealAI: boolean;
  onAct: (type: 'fold' | 'check' | 'call' | 'raise' | 'allin', amount?: number) => void;
  onDeal: () => void;
  onToggleAutoDeal: () => void;
  onToggleRevealAI: () => void;
}

export function ControlPanel({
  state,
  waitingForHuman,
  thinking,
  autoDeal,
  revealAI,
  onAct,
  onDeal,
  onToggleAutoDeal,
  onToggleRevealAI,
}: ControlPanelProps) {
  const hero = state.actingIdx !== null ? state.players[state.actingIdx] : null;
  const myTurn = !!(hero?.human && !state.handDone && waitingForHuman);
  const toCall = myTurn && hero ? Math.max(0, state.currentBet - hero.roundBet) : 0;

  const minRaise = myTurn && hero ? Math.min(hero.roundBet + hero.stack, Math.max(state.currentBet + state.minRaise, state.bigBlind)) : state.bigBlind;
  const maxRaise = myTurn && hero ? hero.roundBet + hero.stack : state.bigBlind * 100;
  const step = state.bigBlind >= 100 ? 50 : 25;

  const [raiseValue, setRaiseValue] = useState(minRaise);

  useEffect(() => {
    if (myTurn) {
      setRaiseValue((v) => Math.min(Math.max(v, minRaise), Math.max(minRaise, maxRaise)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTurn, minRaise, maxRaise]);

  const decisionTitle = myTurn ? 'Your Decision' : thinking ? thinking.name : state.handDone ? 'Ready' : 'Waiting';
  const decisionText = myTurn && hero
    ? buildDecisionText(state, hero, toCall)
    : thinking
      ? `${thinking.style} is thinking`
      : 'A new tournament is about to begin. Good luck.';

  const turnLabel = state.actingIdx !== null && !state.handDone
    ? `${state.players[state.actingIdx].name} to act`
    : state.handDone
      ? 'Between hands'
      : 'Waiting';

  return (
    <aside className="panel">
      <div className="ph">
        <h2>Command</h2>
        <span>{turnLabel}</span>
      </div>
      <div className="controls">
        <div className="decision-box">
          <h3>
            {decisionTitle}
            {thinking && !myTurn && (
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
            )}
          </h3>
          <p>{decisionText}</p>
        </div>

        <div className="slider-block">
          <div className="slider-top">
            <span>Raise to</span>
            <strong>{money(raiseValue)}</strong>
          </div>
          <input
            type="range"
            min={minRaise}
            max={Math.max(minRaise, maxRaise)}
            step={step}
            value={raiseValue}
            disabled={!myTurn}
            onChange={(e) => setRaiseValue(+e.target.value)}
          />
        </div>

        <div className="action-row">
          <button type="button" className="btn-action" disabled={!myTurn} onClick={() => onAct('fold')}>
            Fold
          </button>
          <button
            type="button"
            className="btn-action"
            disabled={!myTurn || toCall === 0}
            onClick={() => onAct('call')}
          >
            {toCall > 0 ? `Call ${money(toCall)}` : 'Call'}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!myTurn || !hero || hero.stack <= toCall}
            onClick={() => onAct('raise', raiseValue)}
          >
            Raise
          </button>
        </div>

        <div className="mini-row">
          <button
            type="button"
            className="btn-ghost"
            disabled={!myTurn || toCall > 0}
            onClick={() => onAct('check')}
          >
            Check
          </button>
          <button type="button" className="btn-ghost" disabled={!myTurn} onClick={() => onAct('allin')}>
            All In
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={!state.handDone || state.players.filter((p) => p.active && p.stack > 0).length <= 1}
            onClick={onDeal}
          >
            Deal
          </button>
        </div>

        <div className="settings">
          <div className="toggle-row">
            <span>Auto-deal next hand</span>
            <button
              className={`sw${autoDeal ? ' on' : ''}`}
              type="button"
              aria-pressed={autoDeal}
              aria-label="Toggle auto deal"
              onClick={onToggleAutoDeal}
            />
          </div>
          <div className="toggle-row">
            <span>Show AI cards at showdown</span>
            <button
              className={`sw${revealAI ? ' on' : ''}`}
              type="button"
              aria-pressed={revealAI}
              aria-label="Toggle AI card reveal"
              onClick={onToggleRevealAI}
            />
          </div>
        </div>

        <div className="log">
          {state.logs.slice(0, 30).map((l, i) => (
            <div className="log-entry" key={i}>
              {l}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function buildDecisionText(state: GameState, p: GameState['players'][number], toCall: number): string {
  const pot = state.pot + state.players.reduce((s, pl) => s + pl.roundBet, 0);
  const phase = state.phase.charAt(0).toUpperCase() + state.phase.slice(1);
  return toCall === 0
    ? `${phase}. You may check or open the betting. Stack: ${money(p.stack)}.`
    : `${phase}. It costs ${money(toCall)} to call. Pot is ${money(pot)}.`;
}
