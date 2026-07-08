import { money } from '../engine/utils';
import type { GameState } from '../engine/types';
import { MutedIcon, SaveIcon, SoundIcon } from './icons';

interface TopBarProps {
  state: GameState;
  soundOn: boolean;
  onToggleSound: () => void;
  onSave: () => void;
  onNewTournament: () => void;
}

export function TopBar({ state, soundOn, onToggleSound, onSave, onNewTournament }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="crest" />
        <div className="brand-text">
          <h1>Monarch Room</h1>
          <p>Private Texas Hold&rsquo;em</p>
        </div>
      </div>
      <div className="status-bar">
        <div className="pill">
          <label>Level</label>
          <strong>{state.level}</strong>
        </div>
        <div className="pill">
          <label>Blinds</label>
          <strong>
            {money(state.smallBlind)}/{money(state.bigBlind)}
          </strong>
        </div>
        <div className="pill">
          <label>Hands</label>
          <strong>{state.handsPlayed}</strong>
        </div>
        <div className="pill">
          <label>Phase</label>
          <strong>{state.phase.toUpperCase()}</strong>
        </div>
      </div>
      <div className="util">
        <button
          className="btn"
          type="button"
          title="Sound"
          aria-label="Toggle sound"
          style={{ opacity: soundOn ? 1 : 0.38 }}
          onClick={onToggleSound}
        >
          {soundOn ? <SoundIcon /> : <MutedIcon />}
        </button>
        <button className="btn" type="button" title="Save" aria-label="Save tournament" onClick={onSave}>
          <SaveIcon />
        </button>
        <button type="button" className="btn-ghost" onClick={onNewTournament}>
          New Tournament
        </button>
      </div>
    </header>
  );
}
