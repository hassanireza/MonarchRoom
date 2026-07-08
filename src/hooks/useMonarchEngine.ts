import { useEffect, useMemo, useRef, useState } from 'react';
import { MonarchEngine, type WinEvent } from '../engine/GameEngine';
import type { GameState } from '../engine/types';

let audioCtx: AudioContext | null = null;

function playTone(freq: number, dur: number, type: OscillatorType = 'sine') {
  try {
    audioCtx = audioCtx || new (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.075, audioCtx.currentTime + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur + 0.02);
  } catch {
    /* audio unavailable, ignore */
  }
}

export interface ThinkingInfo {
  name: string;
  style: string;
}

/**
 * Bridges the imperative MonarchEngine class to React's declarative world.
 * The engine is instantiated once per mount and never recreated; all game
 * logic stays inside the class, this hook only relays state snapshots.
 */
export function useMonarchEngine() {
  const engineRef = useRef<MonarchEngine | null>(null);
  if (!engineRef.current) engineRef.current = new MonarchEngine();
  const engine = engineRef.current;

  const [state, setState] = useState<GameState>(() => engine.getState());
  const [toast, setToast] = useState<string | null>(null);
  const [win, setWin] = useState<WinEvent | null>(null);
  const [thinking, setThinking] = useState<ThinkingInfo | null>(null);
  const [soundOn, setSoundOnState] = useState(engine.getSettings().soundOn);
  const [autoDeal, setAutoDealState] = useState(engine.getSettings().autoDeal);
  const [revealAI, setRevealAIState] = useState(engine.getSettings().revealAI);

  useEffect(() => {
    const offState = engine.onState(setState);
    const offToast = engine.onToast((txt) => {
      setToast(txt);
      const id = setTimeout(() => setToast(null), 2300);
      return () => clearTimeout(id);
    });
    const offWin = engine.onWin((evt) => {
      setWin(evt);
      const id = setTimeout(() => setWin(null), 2600);
      return () => clearTimeout(id);
    });
    const offSound = engine.onSound((evt) => playTone(evt.freq, evt.dur, evt.type));
    const offThinking = engine.onThinking(setThinking);

    engine.boot();

    return () => {
      offState();
      offToast();
      offWin();
      offSound();
      offThinking();
      engine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = useMemo(
    () => ({
      act: engine.act.bind(engine),
      startHand: engine.startHand.bind(engine),
      newTournament: engine.newTournament.bind(engine),
      saveManually: engine.saveManually.bind(engine),
      isWaitingForHuman: () => engine.isWaitingForHuman(),
      toggleSound: () => {
        const next = !soundOn;
        setSoundOnState(next);
        engine.setSoundOn(next);
        setToast(next ? 'Sound on.' : 'Muted.');
        setTimeout(() => setToast(null), 2300);
      },
      toggleAutoDeal: () => {
        const next = !autoDeal;
        setAutoDealState(next);
        engine.setAutoDeal(next);
      },
      toggleRevealAI: () => {
        const next = !revealAI;
        setRevealAIState(next);
        engine.setRevealAI(next);
      },
      save: () => {
        engine.saveManually();
        setToast('Saved to this browser.');
        setTimeout(() => setToast(null), 2300);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [soundOn, autoDeal, revealAI]
  );

  return { state, toast, win, thinking, soundOn, autoDeal, revealAI, ...api };
}
