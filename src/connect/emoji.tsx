'use client';
/* Emoji picker for the message box. Built in (nothing to download):
   recently used first, then a few groups. Tapping one puts it where the
   cursor is. */

import React, { useState } from 'react';
import { Icon } from './ui';

const GROUPS: [string, string][] = [
  ['Smileys', '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫡 🤭 🫢 🤫 🤥 😶 😐 😑 😬 🫠 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 💀 👻 👽 🤖 💩 😺 😸 😹 😻 😼 😽 🙀 😿 😾'],
  ['Gestures', '👍 👎 👏 🙌 👐 🤲 🤝 🙏 ✌️ 🤞 🫰 🤟 🤘 👌 🤌 🤏 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤙 💪 🦾 🫶 ✍️ 🤳 💅 👀 👁️ 🧠 🫀 👂 👃 👄 🫦 💋 🦷'],
  ['Hearts', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💯 💢 💥 💫 💦 💨 🕳️ 💬 🗨️ 💭 💤'],
  ['Work', '🔥 ✨ ⭐ 🌟 ⚡ 🎉 🎊 🎈 🎁 🏆 🥇 🥈 🥉 🏅 🎖️ 🎯 🚀 💡 📌 📍 ✅ ☑️ ✔️ ❌ ❗ ❓ ⚠️ 🔔 📣 📢 🎬 🎥 📹 📷 📸 🖥️ 💻 ⌨️ 🖱️ 📱 🎨 🖌️ 🖍️ ✏️ 📝 📚 📖 🗂️ 📁 📅 ⏰ ⏳ 💰 💸 💳 🧾 📈 📉 🔗 🔒 🔑 🛠️ ⚙️ 🧩 🎧 🎵 🎶 🥋'],
  ['Nature', '🌞 🌝 🌚 🌙 ⭐ ☀️ 🌤️ ⛅ 🌧️ ⛈️ 🌈 ❄️ ☃️ 🌊 🌸 🌹 🌺 🌻 🌼 🌷 🌱 🌿 🍀 🍁 🍂 🌴 🌵 🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦅 🦋 🐝 🐢 🐍 🐙 🐠 🐬 🐳'],
  ['Food', '🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍍 🥭 🥥 🥑 🍅 🌶️ 🌽 🥕 🍞 🧀 🍳 🍗 🍖 🍔 🍟 🍕 🌭 🥪 🌮 🍝 🍜 🍲 🍛 🍚 🍤 🍦 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍿 ☕ 🍵 🥤 🧃 🍺 🥂 🍷'],
];
const KEY = 'cx-emoji-recent';
const recent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as string[];
  } catch {
    return [];
  }
};
const remember = (e: string) => {
  try {
    localStorage.setItem(KEY, JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 24)));
  } catch {
    /* storage blocked */
  }
};

/** The smiley button and its panel. Puts the emoji at the cursor in `box`. */
export function EmojiButton({ box, value, onValue }: { box: React.RefObject<HTMLTextAreaElement | null>; value: string; onValue: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(() => (recent().length ? 'Recent' : 'Smileys'));
  const put = (e: string) => {
    const el = box.current;
    const a = el?.selectionStart ?? value.length;
    const b = el?.selectionEnd ?? value.length;
    const next = value.slice(0, a) + e + value.slice(b);
    remember(e);
    onValue(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.setSelectionRange(a + e.length, a + e.length);
    });
  };
  const list = tab === 'Recent' ? recent() : (GROUPS.find(([n]) => n === tab)?.[1].split(' ') ?? []);
  const tabs = [...(recent().length ? ['Recent'] : []), ...GROUPS.map(([n]) => n)];
  return (
    <>
      <button type="button" className={open ? 'cx-icon-btn cx-icon-flat cx-emoji-btn is-on' : 'cx-icon-btn cx-icon-flat cx-emoji-btn'} aria-label={open ? 'Close emoji' : 'Emoji'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="smile" />
      </button>
      {open && (
        <div className="cx-emoji" role="dialog" aria-label="Emoji">
          <div className="cx-emoji-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="cx-emoji-grid" data-scroll>
            {list.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={e}
                // keep the keyboard and cursor where they are
                onPointerDown={(ev) => ev.preventDefault()}
                onClick={() => put(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Any emoji as a reaction (the + after the quick ones) */
export function EmojiSheet({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState(() => (recent().length ? 'Recent' : 'Smileys'));
  const list = tab === 'Recent' ? recent() : (GROUPS.find(([n]) => n === tab)?.[1].split(' ') ?? []);
  const tabs = [...(recent().length ? ['Recent'] : []), ...GROUPS.map(([n]) => n)];
  return (
    <div className="cx-sheet-wrap" onClick={onClose}>
      <div className="cx-sheet cx-emoji-sheet" role="dialog" aria-label="Pick a reaction" onClick={(e) => e.stopPropagation()}>
        <span className="cx-grab" aria-hidden="true" />
        <div className="cx-emoji" role="group" aria-label="Emoji">
          <div className="cx-emoji-tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="cx-emoji-grid" data-scroll>
            {list.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={e}
                onClick={() => {
                  remember(e);
                  onPick(e);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
