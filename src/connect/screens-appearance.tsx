'use client';
/* Appearance: theme, chat colour and chat wallpaper. */

import React, { useRef, useState } from 'react';
import { useConnect } from './context';
import { CHAT_COLORS, PATTERNS, WALLPAPERS, saveAppearance, useAppearance, wallpaperFromFile, type ChatColor, type Pattern, type ThemeChoice, type Wallpaper } from './appearance';
import { Icon } from './ui';
import { navigate } from './router';

const THEMES: [ThemeChoice, string][] = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'Same as phone'],
];

export function Appearance() {
  const { toast } = useConnect();
  const look = useAppearance();
  const pickPhoto = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const usePhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      saveAppearance({ wall: 'photo', photo: await wallpaperFromFile(file) });
    } catch {
      toast('That picture couldn’t be used. Try another one.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cx-col cx-look">
      <button type="button" className="cx-back cx-back-btn" onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/'))}>
        <Icon name="back" size={20} />
        Back
      </button>
      <h1 className="cx-h1">Appearance</h1>
      <p className="cx-look-note">Saved on this device.</p>

      <section className="cx-look-block">
        <h2>Theme</h2>
        <div className="cx-look-seg" role="radiogroup" aria-label="Theme">
          {THEMES.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={look.theme === id} className={look.theme === id ? 'is-on' : ''} onClick={() => saveAppearance({ theme: id })}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="cx-look-block">
        <h2>Chat preview</h2>
        <div className="cx-look-preview" data-wall={look.wall === 'photo' && !look.photo ? 'plain' : look.wall} data-pattern={look.wall === 'photo' ? 'none' : look.pattern} style={look.wall === 'photo' && look.photo ? { backgroundImage: `url("${look.photo}")` } : undefined}>
          <span className="cx-look-theirs">Did you finish the logo reveal?</span>
          <span className="cx-look-mine">Yes! Posting it tonight</span>
        </div>
      </section>

      <section className="cx-look-block">
        <h2>Chat colour</h2>
        <div className="cx-look-colors" role="radiogroup" aria-label="Chat colour">
          {(Object.keys(CHAT_COLORS) as ChatColor[]).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={look.chat === id}
              aria-label={CHAT_COLORS[id].label}
              className={look.chat === id ? 'is-on' : ''}
              style={{ background: CHAT_COLORS[id].bg, color: CHAT_COLORS[id].ink }}
              onClick={() => saveAppearance({ chat: id })}
            >
              {look.chat === id && <Icon name="check" size={20} />}
            </button>
          ))}
        </div>
      </section>

      <section className="cx-look-block">
        <h2>Chat wallpaper</h2>
        <div className="cx-look-walls" role="radiogroup" aria-label="Chat wallpaper">
          {WALLPAPERS.map((w) => (
            <button key={w.id} type="button" role="radio" aria-checked={look.wall === w.id} className={look.wall === w.id ? 'is-on' : ''} onClick={() => saveAppearance({ wall: w.id as Wallpaper })}>
              <span className="cx-look-wall" data-wall={w.id} data-pattern={look.pattern} />
              <small>{w.label}</small>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={look.wall === 'photo'} className={look.wall === 'photo' ? 'is-on' : ''} onClick={() => (look.photo ? saveAppearance({ wall: 'photo' }) : pickPhoto.current?.click())} disabled={busy}>
            <span className="cx-look-wall cx-look-photo" style={look.photo ? { backgroundImage: `url("${look.photo}")` } : undefined}>
              {!look.photo && <Icon name="image" size={22} />}
            </span>
            <small>{busy ? 'Loading…' : 'Your photo'}</small>
          </button>
        </div>
        {look.wall !== 'photo' && (
          <>
            <h3 className="cx-look-sub">Pattern</h3>
            <div className="cx-look-seg" role="radiogroup" aria-label="Pattern">
              {PATTERNS.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={look.pattern === p.id} className={look.pattern === p.id ? 'is-on' : ''} onClick={() => saveAppearance({ pattern: p.id as Pattern })}>
                  {p.label}
                </button>
              ))}
            </div>
          </>
        )}
        <input ref={pickPhoto} type="file" accept="image/*" className="sr-only" onChange={(e) => (usePhoto(e.target.files?.[0]), (e.target.value = ''))} />
        {look.photo && (
          <div className="cx-look-photo-actions">
            <button type="button" className="btn btn-light btn-sm" onClick={() => pickPhoto.current?.click()}>
              Choose another photo
            </button>
            <button type="button" className="btn btn-sm cx-ln-delete" onClick={() => saveAppearance({ photo: null, wall: look.wall === 'photo' ? 'plain' : look.wall })}>
              Remove photo
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
