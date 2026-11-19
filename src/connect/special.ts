/* Polls and live classes travel as group messages whose body is JSON. */

export type Poll = { q: string; o: string[]; multi?: boolean };
export type Live = { t: string; at: string; mins: number; link: string };

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
    return v && typeof v.t === 'string' && typeof v.at === 'string' && typeof v.link === 'string' ? v : null;
  } catch {
    return null;
  }
}
/** One line for previews and notifications, or null for ordinary messages */
export function specialLine(kind: string | null | undefined, body: string): string | null {
  if (kind === 'poll') return `📊 Poll: ${readPoll(body)?.q ?? ''}`;
  if (kind === 'live') return `🎥 Live class: ${readLive(body)?.t ?? ''}`;
  return null;
}
