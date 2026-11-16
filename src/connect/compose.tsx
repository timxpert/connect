'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useConnect } from './context';
import { hasPaymentTalk, PAYMENT_NOTE } from './safety';
import { toEmbed } from './media';
import { Avatar, Icon, Media } from './ui';
import { play } from './sounds';

/* ------------------------------------------------------------------
   Post composer: opens over the page like LinkedIn's. Text first, then
   an optional photo, video file or video link from the toolbar.
   Any "Post" control opens it with openComposer().
------------------------------------------------------------------- */

const OPEN = 'cx:compose';
export const openComposer = () => window.dispatchEvent(new Event(OPEN));

const MAX_IMAGE = 20 * 1024 * 1024; // resized before upload, so phone photos are fine
const MAX_VIDEO = 50 * 1024 * 1024; // Supabase free plan's per-file limit

type Attach =
  | { type: 'none' }
  | { type: 'image' | 'video'; preview: string; url: string | null; progress: number }
  | { type: 'link'; url: string };

/** Events the feed listens to, so a post appears before the upload finishes */
export type PostingDetail = { preview: string | null; kind: 'image' | 'video' | 'text'; caption: string; community: boolean };
export const POST_START = 'cx:post-start';
export const POST_DONE = 'cx:post-done';
export const POST_FAIL = 'cx:post-fail';
export const POST_PROGRESS = 'cx:post-progress';

export function Composer() {
  const { api, me, toast, ask } = useConnect();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [attach, setAttach] = useState<Attach>({ type: 'none' });
  const [feedback, setFeedback] = useState(false);
  const [err, setErr] = useState('');
  const [posting, setPosting] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const upload = useRef<Promise<string> | null>(null);
  const progress = useRef(0);

  const sensei = Boolean(me?.is_sensei);
  const canPost = Boolean(me?.is_student || me?.is_sensei);

  useEffect(() => {
    const on = () => {
      setErr('');
      setOpen(true);
    };
    window.addEventListener(OPEN, on);
    return () => window.removeEventListener(OPEN, on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => box.current?.focus(), 60);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [open]);

  if (!canPost) return null;

  const clearAttach = () => {
    if ((attach.type === 'image' || attach.type === 'video') && attach.preview.startsWith('blob:')) URL.revokeObjectURL(attach.preview);
    upload.current = null;
    setAttach({ type: 'none' });
  };

  const reset = () => {
    setText('');
    setAttach({ type: 'none' });
    upload.current = null;
    setFeedback(false);
    setErr('');
  };

  const close = async () => {
    const dirty = text.trim() || attach.type !== 'none';
    if (dirty) {
      const ok = await ask({ title: 'Discard this post?', body: 'What you’ve written will be lost.', confirm: 'Discard', danger: true });
      if (!ok) return;
      clearAttach();
    }
    reset();
    setOpen(false);
  };

  /** Shows the file at once and uploads it in the background */
  const pickFile = (file: File, kind: 'image' | 'video') => {
    setErr('');
    if (kind === 'image' && file.size > MAX_IMAGE) return setErr('Pick a photo under 20 MB.');
    if (kind === 'video' && file.size > MAX_VIDEO) return setErr('Pick a video under 50 MB, or add a YouTube link instead.');
    if (attach.type === 'image' || attach.type === 'video') URL.revokeObjectURL(attach.preview);
    const preview = URL.createObjectURL(file);
    progress.current = 0;
    setAttach({ type: kind, preview, url: null, progress: 0 });
    const job = api.uploadImage(file, kind === 'image' ? 'posts' : 'videos', (share) => {
      progress.current = share;
      setAttach((a) => (a.type === kind && a.preview === preview ? { ...a, progress: share } : a));
      window.dispatchEvent(new CustomEvent(POST_PROGRESS, { detail: share }));
    });
    upload.current = job;
    job.then(
      (url) => setAttach((a) => (a.type === kind && a.preview === preview ? { ...a, url, progress: 1 } : a)),
      (e) => {
        if (upload.current !== job) return;
        upload.current = null;
        setAttach((a) => (a.type === kind && a.preview === preview ? { type: 'none' } : a));
        setErr((e as Error).message);
      },
    );
  };

  const addLink = async () => {
    const v = await ask({ title: 'Add a video link', body: 'YouTube, Vimeo, Instagram or TikTok.', input: 'Paste the link', confirm: 'Add' });
    if (!v) return;
    if (!toEmbed(v)) return setErr('That link isn’t from YouTube, Vimeo, Instagram or TikTok.');
    setErr('');
    clearAttach();
    setAttach({ type: 'link', url: v.trim() });
  };

  const caption = text.trim();
  const blocked = hasPaymentTalk(text);
  const ready = !posting && !blocked && (caption.length > 0 || attach.type !== 'none');

  /** Closes straight away; the post finishes in the background and lands in the feed */
  const submit = async () => {
    if (!ready) return;
    const draft = { text, attach, feedback };
    const kind = attach.type === 'image' ? 'image' : attach.type === 'video' || attach.type === 'link' ? 'video' : 'text';
    const preview = attach.type === 'image' || attach.type === 'video' ? attach.preview : attach.type === 'link' ? attach.url : null;
    const job = upload.current;
    setPosting(true);
    setOpen(false);
    window.dispatchEvent(new CustomEvent<PostingDetail>(POST_START, { detail: { preview, kind, caption, community: sensei } }));
    if (job) window.dispatchEvent(new CustomEvent(POST_PROGRESS, { detail: progress.current }));
    try {
      const media_url = attach.type === 'image' || attach.type === 'video' ? attach.url ?? (await job!) : attach.type === 'link' ? attach.url : null;
      const p = await api.createPost({ kind, media_url, caption, tag: feedback && !sensei ? 'feedback' : 'sharing', community: sensei });
      play('post');
      toast(sensei ? 'Posted to Community' : 'Posted');
      window.dispatchEvent(new CustomEvent(POST_DONE, { detail: p }));
      reset();
    } catch (e) {
      window.dispatchEvent(new Event(POST_FAIL));
      setText(draft.text);
      setAttach(draft.attach);
      setFeedback(draft.feedback);
      setErr((e as Error).message || 'Posting failed. Try again.');
      setOpen(true);
    } finally {
      setPosting(false);
    }
  };

  if (!open) return null;

  const preview =
    attach.type === 'image' || attach.type === 'video' ? (
      <div className="cx-cmp-attach">
        {attach.type === 'image' ? (
          <img src={attach.preview} alt="" />
        ) : (
          <video src={`${attach.preview}#t=0.1`} controls playsInline muted preload="metadata" />
        )}
        {attach.progress < 1 && (
          <span className="cx-cmp-progress" role="progressbar" aria-label="Uploading" aria-valuenow={Math.round(attach.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ transform: `scaleX(${Math.max(0.04, attach.progress)})` }} />
          </span>
        )}
        <button type="button" className="cx-cmp-remove" onClick={clearAttach} aria-label="Remove">
          <Icon name="close" size={18} />
        </button>
      </div>
    ) : attach.type === 'link' ? (
      <div className="cx-cmp-attach">
        <Media post={{ kind: 'video', media_url: attach.url, caption: '' }} />
        <button type="button" className="cx-cmp-remove" onClick={clearAttach} aria-label="Remove">
          <Icon name="close" size={18} />
        </button>
      </div>
    ) : null;

  return (
    <div className="cx-cmp-wrap" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="cx-cmp" role="dialog" aria-modal="true" aria-label={sensei ? 'Post to the community' : 'Create a post'}>
        <header className="cx-cmp-head">
          <button type="button" className="cx-icon-btn cx-icon-flat" onClick={close} aria-label="Close">
            <Icon name="close" />
          </button>
          <div className="cx-cmp-who">
            {me && <Avatar p={me} size={40} />}
            <span>
              <strong>{me?.name}</strong>
              <small>{sensei ? 'Community feed · everyone is notified' : 'Visible to everyone on Connect'}</small>
            </span>
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={!ready} onClick={submit}>
            Post
          </button>
        </header>

        <div className="cx-cmp-body">
          <textarea
            ref={box}
            className="cx-cmp-text"
            maxLength={1000}
            value={text}
            placeholder={sensei ? 'What do you want to tell the dojo?' : 'What are you working on?'}
            onChange={(e) => setText(e.target.value)}
          />
          {preview}
          {blocked && (
            <p className="cx-safety" role="alert">
              {PAYMENT_NOTE}
            </p>
          )}
          {err && (
            <p className="cx-error" role="alert">
              {err}
            </p>
          )}
        </div>

        <footer className="cx-cmp-tools">
          <button type="button" onClick={() => photoInput.current?.click()}>
            <Icon name="image" />
            <span>Photo</span>
          </button>
          <button type="button" onClick={() => videoInput.current?.click()}>
            <Icon name="video" />
            <span>Video</span>
          </button>
          <button type="button" onClick={addLink}>
            <Icon name="link" />
            <span>Link</span>
          </button>
          {!sensei && (
            <button type="button" className={feedback ? 'cx-cmp-fb is-on' : 'cx-cmp-fb'} aria-pressed={feedback} onClick={() => setFeedback((f) => !f)}>
              <Icon name="comment" />
              <span>Ask for feedback</span>
            </button>
          )}
          <span className="cx-cmp-count" aria-hidden="true">
            {text.length > 800 ? 1000 - text.length : ''}
          </span>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) pickFile(f, 'image');
            }}
          />
          <input
            ref={videoInput}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) pickFile(f, 'video');
            }}
          />
        </footer>
      </div>
    </div>
  );
}
