'use client';

import React, { useState } from 'react';
import { useConnect } from './context';
import { PHASES } from './types';
import { BELTS, Icon } from './ui';

/* Every student must say which phase they're in before using Connect.
   The Grand Sensei confirms it; until then lessons stay locked. If the
   request is declined, this shows again so they can choose again. */
export function PhasePrompt() {
  const { api, me, refreshMe, toast } = useConnect();
  const [phase, setPhase] = useState<number | null>(null);
  const [show, setShow] = useState(true);
  const [busy, setBusy] = useState(false);

  if (!me || !me.is_student || me.is_sensei || me.is_moderator || me.phase || me.phase_request) return null;

  const save = async () => {
    if (!phase) return;
    setBusy(true);
    try {
      await api.requestPhase(phase);
      if (me.phase_public !== show) await api.updateProfile({ phase_public: show }).catch(() => {});
      await refreshMe();
      toast('Sent. The Grand Sensei will confirm your phase.');
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
        {me.phase_declined_at ? (
          <p>The Grand Sensei didn’t confirm the phase you chose. Pick the phase you’re really in and send it again.</p>
        ) : (
          <p>The Grand Sensei will confirm it. Your lessons open once it’s confirmed.</p>
        )}
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
          <button type="button" className="btn btn-primary" disabled={!phase || busy} onClick={save}>
            {busy ? 'Sending…' : 'Send to the Grand Sensei'}
          </button>
        </div>
      </div>
    </div>
  );
}
