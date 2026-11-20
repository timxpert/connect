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
  const [busy, setBusy] = useState(false);

  if (!me || !me.is_student || me.is_sensei || me.is_moderator || me.phase || me.phase_request) return null;

  const save = async () => {
    if (!phase) return;
    setBusy(true);
    try {
      await api.requestPhase(phase);
      if (me.phase_public === false) await api.updateProfile({ phase_public: true }).catch(() => {});
      await refreshMe();
      toast('Sent for confirmation');
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
        <p>{me.phase_declined_at ? 'Not confirmed. Choose again.' : 'The Grand Sensei will confirm it.'}</p>
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
        <div className="cx-phase-btns">
          <button type="button" className="btn btn-primary" disabled={!phase || busy} onClick={save}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
