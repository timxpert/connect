'use client';

import React, { useState } from 'react';
import { useConnect } from './context';
import { PHASES } from './types';
import { BELTS, Icon } from './ui';

/* Asks a member which phase they're in until they choose one.
   "Later" hides it for this visit only. */
export function PhasePrompt() {
  const { api, me, refreshMe, toast } = useConnect();
  const [later, setLater] = useState(false);
  const [phase, setPhase] = useState<number | null>(null);
  const [show, setShow] = useState(true);
  const [busy, setBusy] = useState(false);

  if (later || !me || !me.is_student || me.is_sensei || me.phase) return null;

  const save = async () => {
    if (!phase) return;
    setBusy(true);
    try {
      await api.updateProfile({ phase, phase_public: show });
      await refreshMe();
      toast(`${BELTS[phase - 1]} added`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cx-sheet-wrap" role="presentation">
      <div className="cx-sheet cx-phase" role="dialog" aria-modal="true" aria-labelledby="phase-title">
        <h2 id="phase-title">Which phase are you in?</h2>
        <p>Your badge shows the belt for your phase. You can change it or hide it any time in Edit profile.</p>
        <div className="cx-phase-options" role="radiogroup" aria-label="Your phase">
          {PHASES.map((name, i) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={phase === i + 1}
              className={phase === i + 1 ? 'cx-phase-opt is-on' : 'cx-phase-opt'}
              onClick={() => setPhase(i + 1)}
            >
              <span className={`cx-badge cx-belt cx-belt-${i + 1}`}>
                <Icon name="obi" size={15} />
                {BELTS[i]}
              </span>
              <span className="cx-phase-name">
                Phase {i + 1}: {name}
              </span>
            </button>
          ))}
        </div>
        <label className="cx-check">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          <span>Show my belt to other members</span>
        </label>
        <div className="cx-phase-btns">
          <button type="button" className="btn btn-light" onClick={() => setLater(true)}>
            Later
          </button>
          <button type="button" className="btn btn-primary" disabled={!phase || busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
