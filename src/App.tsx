import { ControlPanel } from './components/ControlPanel';
import { LeftPanel } from './components/LeftPanel';
import { Table } from './components/Table';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';
import { useMonarchEngine } from './hooks/useMonarchEngine';

export default function App() {
  const {
    state,
    toast,
    win,
    thinking,
    soundOn,
    autoDeal,
    revealAI,
    act,
    startHand,
    newTournament,
    save,
    toggleSound,
    toggleAutoDeal,
    toggleRevealAI,
    isWaitingForHuman,
  } = useMonarchEngine();

  return (
    <div className="app">
      <TopBar state={state} soundOn={soundOn} onToggleSound={toggleSound} onSave={save} onNewTournament={newTournament} />

      <div className="main">
        <LeftPanel state={state} />
        <Table state={state} revealAI={revealAI} win={win} />
        <ControlPanel
          state={state}
          waitingForHuman={isWaitingForHuman()}
          thinking={thinking}
          autoDeal={autoDeal}
          revealAI={revealAI}
          onAct={act}
          onDeal={startHand}
          onToggleAutoDeal={toggleAutoDeal}
          onToggleRevealAI={toggleRevealAI}
        />
      </div>

      <Toast message={toast} />
    </div>
  );
}
