/* Forward a message to other chats and the Dojo group.
   Up to 5 at once. It arrives with a "Forwarded" label. Photos, videos and
   files are sent again from this phone (from the saved copy when there is one,
   so nothing is downloaded twice). */
import { useEffect, useMemo, useState } from 'react';
import { useConnect } from './context';
import { useDragToClose } from './drag';
import { fileNameFor, keptFile } from './chat';
import { GroupPhoto } from './group';
import type { Attachment, Message, Profile } from './types';
import { Avatar, Icon } from './ui';

const MAX = 5;
type Target = { key: string; name: string; sub?: string; group?: boolean; photo?: string | null; person?: Profile; conversationId?: string };

async function blobOf(m: Message) {
  const kept = await keptFile(m.id).catch(() => null);
  if (kept) return kept;
  if (!m.media_url) throw new Error('This file isn’t available any more.');
  const res = await fetch(m.media_url);
  if (!res.ok) throw new Error('Couldn’t get the file. Check your connection.');
  return res.blob();
}

export function ForwardSheet({ m, onClose }: { m: Message; onClose: () => void }) {
  const { api, me, toast } = useConnect();
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const sheet = useDragToClose<HTMLDivElement>(onClose, !busy);

  useEffect(() => {
    let live = true;
    (async () => {
      const [convs, status, group, members] = await Promise.all([
        api.listConversations().catch(() => []),
        api.groupStatus().catch(() => 'none' as const),
        api.groupPreview().catch(() => null),
        api.groupMembers().catch(() => [] as Profile[]),
      ]);
      const list: Target[] = [];
      if (status === 'member') list.push({ key: 'group', name: group?.name || 'Dojo group', group: true, photo: group?.photo_url ?? null });
      const inChats = new Set<string>();
      for (const c of convs) {
        inChats.add(c.other.id);
        list.push({ key: `c:${c.id}`, name: c.other.name, person: c.other, conversationId: c.id });
      }
      for (const p of members) if (p.id !== me?.id && !inChats.has(p.id)) list.push({ key: `p:${p.id}`, name: p.name, person: p });
      if (live) setTargets(list);
    })();
    return () => {
      live = false;
    };
  }, [api, me]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (targets ?? []).filter((t) => !s || t.name.toLowerCase().includes(s));
  }, [targets, q]);

  const toggle = (key: string) =>
    setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : c.length >= MAX ? (toast(`You can forward to ${MAX} chats at a time.`), c) : [...c, key]));

  const send = async () => {
    if (!targets || !chosen.length) return;
    setBusy(true);
    try {
      const picked = chosen.map((k) => targets.find((t) => t.key === k)!).filter(Boolean);
      let a: Attachment | null = null;
      const kind = m.kind ?? 'text';
      if (kind !== 'text') {
        const blob = await blobOf(m);
        const file = new File([blob], m.file_name || fileNameFor(m, blob.type), { type: blob.type });
        a = { file, kind, ...(m.duration ? { duration: m.duration } : {}), ...(m.thumb ? { thumb: m.thumb } : {}) };
      }
      let failed = 0;
      for (const t of picked) {
        try {
          if (t.group) {
            if (a) await api.sendGroupAttachment(a, m.body, null, undefined, true);
            else await api.sendGroupMessage(m.body, null, true);
          } else {
            const id = t.conversationId ?? (await api.openConversation(t.person!.id));
            if (a) await api.sendAttachment(id, a, m.body, undefined, true);
            else await api.sendMessage(id, m.body, null, true);
          }
        } catch {
          failed++;
        }
      }
      window.dispatchEvent(new Event('cx:counts'));
      toast(failed ? `Couldn’t forward to ${failed} of ${picked.length}.` : picked.length === 1 ? `Forwarded to ${picked[0].name}` : `Forwarded to ${picked.length} chats`);
      onClose();
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  };

  const names = chosen.map((k) => targets?.find((t) => t.key === k)?.name.split(' ')[0]).filter(Boolean);

  return (
    <div className="cx-sheet-wrap" onClick={() => !busy && onClose()}>
      <div className="cx-sheet cx-drag cx-fwd" role="dialog" aria-label="Forward to" ref={sheet} onClick={(e) => e.stopPropagation()}>
        <span className="cx-grab" aria-hidden="true" />
        <h2 className="cx-fwd-title">Forward to</h2>
        <label className="cx-search">
          <Icon name="search" size={20} />
          <span className="sr-only">Search chats</span>
          <input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <ul className="cx-fwd-list" data-scroll>
          {!targets && <li className="cx-fwd-note">Loading chats…</li>}
          {targets && !shown.length && <li className="cx-fwd-note">No one matches “{q}”.</li>}
          {shown.map((t) => {
            const on = chosen.includes(t.key);
            return (
              <li key={t.key}>
                <button type="button" className={on ? 'cx-fwd-row is-on' : 'cx-fwd-row'} onClick={() => toggle(t.key)} aria-pressed={on}>
                  {t.group ? <GroupPhoto url={t.photo} size={42} /> : <Avatar p={t.person!} size={42} />}
                  <span className="cx-fwd-name">{t.name}</span>
                  <span className="cx-fwd-check" aria-hidden="true">
                    {on && <Icon name="check" size={16} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="cx-fwd-bar">
          <span>{names.length ? names.join(', ') : 'Choose up to 5 chats'}</span>
          <button type="button" className="cx-send" disabled={!chosen.length || busy} onClick={send} aria-label="Forward">
            {busy ? <Icon name="clock" size={20} /> : <Icon name="send" size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
}
