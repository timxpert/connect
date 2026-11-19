'use client';
/* Keeping students on their lessons:
   - "Continue learning" at the top of the Feed
   - a gentle note in the group when no lesson has been opened for 3 days */

import React, { useEffect, useState } from 'react';
import { useConnect } from './context';
import { peek } from './cache';
import type { Lesson } from './types';
import { A, Icon } from './ui';

const LAST = 'cx-last-lesson';
const NUDGED = 'cx-study-nudge';
const DAY = 864e5;
const read = (k: string) => {
  try {
    return Number(localStorage.getItem(k) || 0);
  } catch {
    return 0;
  }
};
const write = (k: string, v: number) => {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* storage blocked */
  }
};
/** Called whenever a lesson is opened */
export const lessonOpened = () => write(LAST, Date.now());

/** The student's phase lessons: how many done and the next one */
function useNext() {
  const { api, me } = useConnect();
  const student = Boolean(me?.is_student && !me.is_sensei && !me.is_moderator && me.phase);
  const [list, setList] = useState<Lesson[] | null>(() => peek<Lesson[]>('listLessons') ?? null);
  useEffect(() => {
    if (student) api.listLessons().then(setList).catch(() => {});
  }, [api, student]);
  if (!student || !list) return null;
  const cur = me!.phase!;
  const lessons = list.filter((l) => l.published && l.phase >= cur);
  if (!lessons.length) return null;
  const done = lessons.filter((l) => l.done).length;
  return { done, total: lessons.length, next: lessons.find((l) => l.open && !l.done) ?? null, phase: cur };
}

/** Top of the Feed */
export function ContinueLearning() {
  const n = useNext();
  if (!n) return null;
  return (
    <A path={n.next ? `/learn/${n.next.id}` : '/learn'} className="cx-continue">
      <span className="cx-continue-text">
        <small>{n.next ? `Continue learning · Phase ${n.phase}` : `Phase ${n.phase} lessons done`}</small>
        <b>{n.next ? n.next.title : 'Hand in your assignment'}</b>
        <span className="cx-ln-bar" aria-hidden="true">
          <span style={{ width: `${(n.done / n.total) * 100}%` }} />
        </span>
        <small>
          {n.done} of {n.total} lessons done
        </small>
      </span>
      <span className="cx-continue-go" aria-hidden="true">
        <Icon name="play" size={20} filled />
      </span>
    </A>
  );
}

/** In the group: no lesson opened for 3 days (shown at most once a day) */
export function StudyNudge() {
  const n = useNext();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const last = read(LAST);
    // first time: start counting from now
    if (!last) return write(LAST, Date.now());
    setShow(Date.now() - last > 3 * DAY && Date.now() - read(NUDGED) > DAY);
  }, []);
  if (!show || !n?.next) return null;
  const close = () => {
    write(NUDGED, Date.now());
    setShow(false);
  };
  return (
    <div className="cx-nudge" role="status">
      <span>
        <b>No lesson in 3 days</b>
        <small>Next up: {n.next.title}</small>
      </span>
      <A path={`/learn/${n.next.id}`} className="btn btn-primary btn-sm" onClickCapture={close}>
        Resume
      </A>
      <button type="button" className="cx-icon-btn cx-icon-flat" aria-label="Not now" onClick={close}>
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
