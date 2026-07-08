import { useState } from 'react';
import { money } from '../engine/utils';
import type { GameState } from '../engine/types';
import { ChartIcon, HistoryIcon, RankIcon } from './icons';

type Tab = 'stats' | 'history' | 'rank';

interface LeftPanelProps {
  state: GameState;
}

export function LeftPanel({ state }: LeftPanelProps) {
  const [tab, setTab] = useState<Tab>('stats');
  const hero = state.players[0];
  const stats = hero.stats!;

  return (
    <aside className="panel">
      <div className="ph">
        <h2>Ledger</h2>
        <span>Auto saved</span>
      </div>
      <div className="tabs">
        <button type="button" className={`tab${tab === 'stats' ? ' on' : ''}`} onClick={() => setTab('stats')}>
          <ChartIcon /> Stats
        </button>
        <button type="button" className={`tab${tab === 'history' ? ' on' : ''}`} onClick={() => setTab('history')}>
          <HistoryIcon /> History
        </button>
        <button type="button" className={`tab${tab === 'rank' ? ' on' : ''}`} onClick={() => setTab('rank')}>
          <RankIcon /> Rank
        </button>
      </div>

      {tab === 'stats' && (
        <div className="tab-body on">
          <div className="metrics">
            <div className="metric">
              <span>Hands Won</span>
              <strong>{stats.wins}</strong>
            </div>
            <div className="metric">
              <span>Showdowns</span>
              <strong>{stats.showdowns}</strong>
            </div>
            <div className="metric">
              <span>VPIP</span>
              <strong>{stats.hands ? `${Math.round((stats.vpip / stats.hands) * 100)}%` : '0%'}</strong>
            </div>
            <div className="metric">
              <span>Best Stack</span>
              <strong>{money(stats.best)}</strong>
            </div>
          </div>
          <div className="list">
            {state.players
              .filter((p) => !p.human)
              .map((p) => (
                <div className="li" key={p.id}>
                  <div className="li-row">
                    <strong>{p.name}</strong>
                    <span>{p.active ? money(p.stack) : 'Eliminated'}</span>
                  </div>
                  <div className="li-sub">{p.profile?.style}</div>
                </div>
              ))}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="tab-body on">
          <div className="list">
            {state.history.length ? (
              state.history.map((e, i) => (
                <div className="li sm" key={i}>
                  <strong>
                    Hand {e.hand} &middot; Lv {e.level}
                  </strong>{' '}
                  &middot; {e.time}
                  <br />
                  {e.detail}
                </div>
              ))
            ) : (
              <div className="li sm">Hand results appear here.</div>
            )}
          </div>
        </div>
      )}

      {tab === 'rank' && (
        <div className="tab-body on">
          <div className="list">
            {state.leaderboard.length ? (
              state.leaderboard.map((e, i) => (
                <div className="li" key={i}>
                  <div className="li-row">
                    <span>
                      {i + 1}. {e.result}
                    </span>
                    <strong>{money(e.stack)}</strong>
                  </div>
                  <div className="li-sub">
                    {e.date} &middot; {e.hands} hands
                  </div>
                </div>
              ))
            ) : (
              <div className="li sm">No tournament scores yet.</div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
