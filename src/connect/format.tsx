'use client';
/* Message formatting, like WhatsApp:
   *bold*  _italic_  __underline__  ~strike~
   Lines starting "1." or "•" / "-" show as numbered or bullet lists, and the
   next number or bullet is added for you when you start a new line. */

import React from 'react';

const NUM = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const BUL = /^(\s*)[\u2022\-\u2013]\s+(.*)$/;

/* ---------- Showing a message ---------- */
type Mention = (text: string) => React.ReactNode;

// a marker counts when it hugs a word: *like this*, not "2 * 3 * 4"
const INLINE = /(__(?=\S)[^_\n]*?\S__|\*(?=\S)[^*\n]*?\S\*|\*\S\*|_(?=\S)[^_\n]*?\S_|_\S_|~(?=\S)[^~\n]*?\S~|~\S~)/g;

function inline(text: string, mention: Mention, key = ''): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    // markers only start at a word edge (so snake_case_words stay as they are)
    const before = text[at - 1];
    if (before && /[A-Za-z0-9]/.test(before)) continue;
    const after = text[at + m[0].length];
    if (after && /[A-Za-z0-9]/.test(after)) continue;
    if (at > last) out.push(<React.Fragment key={`${key}t${i++}`}>{mention(text.slice(last, at))}</React.Fragment>);
    const tok = m[0];
    const k = `${key}f${i++}`;
    if (tok.startsWith('__')) out.push(<u key={k}>{inline(tok.slice(2, -2), mention, k)}</u>);
    else if (tok[0] === '*') out.push(<strong key={k}>{inline(tok.slice(1, -1), mention, k)}</strong>);
    else if (tok[0] === '_') out.push(<em key={k}>{inline(tok.slice(1, -1), mention, k)}</em>);
    else out.push(<s key={k}>{inline(tok.slice(1, -1), mention, k)}</s>);
    last = at + tok.length;
  }
  if (last < text.length) out.push(<React.Fragment key={`${key}t${i++}`}>{mention(text.slice(last))}</React.Fragment>);
  return out;
}

/** A message body with lists and bold/italic/underline/strike */
export function Rich({ text, mention }: { text: string; mention: Mention }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let list: { kind: 'ol' | 'ul'; start: number; items: string[] } | null = null;
  const flushPara = () => {
    if (!para.length) return;
    const k = `p${blocks.length}`;
    blocks.push(
      <p key={k}>
        {para.map((l, i) => (
          <React.Fragment key={i}>
            {i > 0 && '\n'}
            {inline(l, mention, `${k}l${i}`)}
          </React.Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${blocks.length}`;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, mention, `${k}i${i}`)}</li>);
    blocks.push(
      list.kind === 'ol' ? (
        <ol key={k} className="cx-rich-ol" start={list.start}>
          {items}
        </ol>
      ) : (
        <ul key={k} className="cx-rich-ul">
          {items}
        </ul>
      ),
    );
    list = null;
  };
  for (const line of lines) {
    const n = NUM.exec(line);
    const b = n ? null : BUL.exec(line);
    if (n) {
      flushPara();
      if (!list || list.kind !== 'ol') {
        flushList();
        list = { kind: 'ol', start: Number(n[2]), items: [] };
      }
      list.items.push(n[3]);
    } else if (b) {
      flushPara();
      if (!list || list.kind !== 'ul') {
        flushList();
        list = { kind: 'ul', start: 1, items: [] };
      }
      list.items.push(b[2]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="cx-rich">{blocks}</div>;
}

/** The text without formatting marks (for previews and notifications) */
export function plainText(text: string) {
  return text.replace(INLINE, (t) => (t.startsWith('__') ? t.slice(2, -2) : t.slice(1, -1)));
}

/* ---------- Writing a message ---------- */
/**
 * Called on every change. When a new line was just started under a list
 * line, adds the next number or a bullet. A new line under an empty item
 * ends the list instead.
 */
export function continueList(prev: string, next: string, caret: number): { value: string; caret: number } | null {
  if (next.length !== prev.length + 1 || next[caret - 1] !== '\n') return null;
  if (next.slice(0, caret - 1) + next.slice(caret) !== prev) return null;
  const before = next.slice(0, caret - 1);
  const lineStart = before.lastIndexOf('\n') + 1;
  const line = before.slice(lineStart);
  const n = NUM.exec(line);
  const b = n ? null : BUL.exec(line);
  if (!n && !b) return null;
  const empty = !(n ? n[3] : b![2]).trim();
  if (empty) {
    // "2. " then Enter: stop the list
    const value = next.slice(0, lineStart) + next.slice(caret);
    return { value, caret: lineStart };
  }
  const marker = n ? `${n[1]}${Number(n[2]) + 1}. ` : `${b![1]}• `;
  const value = next.slice(0, caret) + marker + next.slice(caret);
  return { value, caret: caret + marker.length };
}

/** "- " typed at the start of a line becomes "• " */
export function bulletize(next: string, caret: number): { value: string; caret: number } | null {
  const lineStart = next.lastIndexOf('\n', caret - 1) + 1;
  if (caret - lineStart === 2 && next.slice(lineStart, caret) === '- ') {
    return { value: next.slice(0, lineStart) + '• ' + next.slice(caret), caret };
  }
  return null;
}

/** Wraps the selected text in a formatting mark */
export function wrapSelection(value: string, start: number, end: number, mark: string): { value: string; start: number; end: number } {
  const sel = value.slice(start, end);
  // already wrapped: take the marks off
  if (value.slice(start - mark.length, start) === mark && value.slice(end, end + mark.length) === mark) {
    return { value: value.slice(0, start - mark.length) + sel + value.slice(end + mark.length), start: start - mark.length, end: end - mark.length };
  }
  // keep spaces outside the marks
  const lead = sel.length - sel.trimStart().length;
  const trail = sel.length - sel.trimEnd().length;
  const inner = sel.trim();
  const wrapped = `${sel.slice(0, lead)}${mark}${inner}${mark}${sel.slice(sel.length - trail)}`;
  return { value: value.slice(0, start) + wrapped + value.slice(end), start: start + lead + mark.length, end: start + lead + mark.length + inner.length };
}

const MARKS: [string, string, string][] = [
  ['*', 'B', 'Bold'],
  ['_', 'I', 'Italic'],
  ['__', 'U', 'Underline'],
  ['~', 'S', 'Strikethrough'],
];

/** Bold / italic / underline / strike buttons, shown while text is selected */
export function FormatBar({ box, value, onChange }: { box: React.RefObject<HTMLTextAreaElement | null>; value: string; onChange: (v: string) => void }) {
  const [sel, setSel] = React.useState(null as [number, number] | null);
  React.useEffect(() => {
    const check = () => {
      const el = box.current;
      if (!el || document.activeElement !== el) return setSel(null);
      setSel(el.selectionEnd > el.selectionStart ? [el.selectionStart, el.selectionEnd] : null);
    };
    document.addEventListener('selectionchange', check);
    return () => document.removeEventListener('selectionchange', check);
  }, [box]);
  if (!sel) return null;
  const apply = (mark: string) => {
    const el = box.current;
    if (!el) return;
    const r = wrapSelection(value, sel[0], sel[1], mark);
    onChange(r.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  };
  return (
    <div className="cx-fmt" role="toolbar" aria-label="Format text">
      {MARKS.map(([mark, label, name]) => (
        <button
          key={name}
          type="button"
          aria-label={name}
          className={`cx-fmt-${label.toLowerCase()}`}
          // keep the text selected
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => apply(mark)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** onChange for a message box: lists keep going by themselves */
// what each box held after its last change (state can lag behind fast typing)
const seen = new WeakMap<HTMLTextAreaElement, string>();
export function smartChange(prevState: string, el: HTMLTextAreaElement, set: (v: string) => void) {
  const prev = seen.get(el) ?? prevState;
  const next = el.value;
  const caret = el.selectionStart ?? next.length;
  const r = continueList(prev, next, caret) ?? bulletize(next, caret);
  seen.set(el, r ? r.value : next);
  if (!r) return set(next);
  // change the box itself first so the cursor lands in the right place straight away
  el.value = r.value;
  el.setSelectionRange(r.caret, r.caret);
  set(r.value);
}

/* ---------- Formatting shown while typing ---------- */
/** The draft with its marks kept (dimmed) and the styles applied, drawn over the box */
function marked(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    const before = text[at - 1];
    const after = text[at + m[0].length];
    if ((before && /[A-Za-z0-9]/.test(before)) || (after && /[A-Za-z0-9]/.test(after))) continue;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    const w = tok.startsWith('__') ? 2 : 1;
    const mark = tok.slice(0, w);
    const inner = marked(tok.slice(w, -w));
    const cls = w === 2 ? 'cx-mu' : tok[0] === '*' ? 'cx-mb' : tok[0] === '_' ? 'cx-mi' : 'cx-ms';
    out.push(
      <span key={i++}>
        <span className="cx-mk">{mark}</span>
        <span className={cls}>{inner}</span>
        <span className="cx-mk">{mark}</span>
      </span>,
    );
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'textIndent', 'tabSize'] as const;

/** A message box that shows bold, italic, underline and strike as you type */
export function MessageField({
  box,
  value,
  ...rest
}: { box: React.RefObject<HTMLTextAreaElement | null>; value: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const mirror: React.RefObject<HTMLDivElement | null> = React.useRef(null);
  INLINE.lastIndex = 0;
  const rich = /[*_~]/.test(value) && INLINE.test(value);
  INLINE.lastIndex = 0;
  React.useLayoutEffect(() => {
    const el = box.current;
    const mi = mirror.current;
    if (!el || !mi) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      for (const k of COPY) (mi.style as unknown as Record<string, string>)[k] = cs[k];
      mi.style.top = `${el.offsetTop}px`;
      mi.style.left = `${el.offsetLeft}px`;
      mi.style.width = `${el.offsetWidth}px`;
      mi.style.height = `${el.offsetHeight}px`;
      mi.scrollTop = el.scrollTop;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const sync = () => (mi.scrollTop = el.scrollTop);
    el.addEventListener('scroll', sync);
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', sync);
    };
  }, [rich, value, box]);
  return (
    <span className="cx-field">
      <textarea ref={box as React.RefObject<HTMLTextAreaElement>} value={value} className={rich ? 'is-rich' : undefined} {...rest} />
      {rich && (
        <div ref={mirror} className="cx-mirror" aria-hidden="true">
          {marked(value)}
          {/* keeps the last empty line's height */}
          {'​'}
        </div>
      )}
    </span>
  );
}

/* ---------- Drafts ---------- */
const DRAFT = 'cx-draft-';
export function loadDraft(chat: string): string {
  try {
    return localStorage.getItem(DRAFT + chat) ?? '';
  } catch {
    return '';
  }
}
export function saveDraft(chat: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(DRAFT + chat, text.slice(0, 4000));
    else localStorage.removeItem(DRAFT + chat);
  } catch {
    /* storage full or blocked */
  }
}
/** Keeps what you typed in a chat until you send it, like WhatsApp */
export function useDraft(chat: string): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [draft, setDraft] = React.useState(() => loadDraft(chat));
  React.useEffect(() => {
    const t = window.setTimeout(() => saveDraft(chat, draft), 300);
    return () => window.clearTimeout(t);
  }, [chat, draft]);
  return [draft, setDraft];
}
