/* Polls and live classes travel as group messages whose body is JSON. */

export type Poll = { q: string; o: string[]; multi?: boolean };
/** call: a group call starting now (not a class) */
export type Live = { t: string; at: string; mins: number; link: string; call?: boolean; room?: boolean };

export function readPoll(body: string): Poll | null {
  try {
    const v = JSON.parse(body) as Poll;
    return v && typeof v.q === 'string' && Array.isArray(v.o) ? v : null;
  } catch {
    return null;
  }
}
export function readLive(body: string): Live | null {
  try {
    const v = JSON.parse(body) as Live;
    return v && typeof v.t === 'string' && typeof v.at === 'string' && (typeof v.link === 'string' || v.room) ? v : null;
  } catch {
    return null;
  }
}
export type CallLog = { video: boolean; status: 'missed' | 'declined' | 'ended'; secs: number };
export function readCall(body: string): CallLog | null {
  try {
    const v = JSON.parse(body) as CallLog;
    return v && typeof v.status === 'string' ? v : null;
  } catch {
    return null;
  }
}
export function callLine(c: CallLog | null, mine: boolean) {
  if (!c) return 'Call';
  const what = c.video ? 'video call' : 'voice call';
  if (c.status === 'missed') return mine ? `No answer · ${what}` : `Missed ${what}`;
  if (c.status === 'declined') return mine ? `Declined ${what}` : `You declined a ${what}`;
  const m = Math.round(c.secs / 60);
  return `${c.video ? 'Video call' : 'Voice call'} · ${c.secs < 60 ? `${c.secs} sec` : `${m} min`}`;
}
/** One line for previews and notifications, or null for ordinary messages */
export function specialLine(kind: string | null | undefined, body: string): string | null {
  if (kind === 'call') return `📞 ${callLine(readCall(body), false)}`;
  if (kind === 'poll') return `📊 Poll: ${readPoll(body)?.q ?? ''}`;
  if (kind === 'live') return readLive(body)?.call ? '📞 Group call started' : `🎥 Live class: ${readLive(body)?.t ?? ''}`;
  return null;
}
