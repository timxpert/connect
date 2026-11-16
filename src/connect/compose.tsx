'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useConnect } from './context';
import { hasPaymentTalk, PAYMENT_NOTE } from './safety';
import { navigate } from './router';
import { toEmbed } from './media';
import { Avatar, Icon, Media } from './ui';

/* ------------------------------------------------------------------
   Post composer: opens over the page like LinkedIn's. Text first, then
   an optional photo, video file or video link from the toolbar.
   Any "Post" control opens it with openComposer().
------------------------------------------------------------------- */

const OPEN = 'cx:compose';
export const openComposer = () => window.dispatchEvent(new Event(OPEN));

const MAX_IMAGE = 15 * 1024 * 1024; // resized before upload, so phone photos are fine
const MAX_VIDEO = 50 * 1024 * 1024; // Supabase free plan's per-file limit

type Attach =
  | { type: 'none' }
  | { type: 'uploading'; label: string }
  | { type: 'image'; url: string }
  | { type: 'video'; url: string }
  | { type: 'link'; url: string };

export function Composer() {
  const { api, me, toast, ask } = useConnect();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [attach, setAttach] = useState<Attach>({ type: 'none' });
  const [feedback, setFeedback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

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

  if (!open || !canPost) return null;

  const reset = () => {
    setText('');
    setAttach({ type: 'none' });
    setFeedback(false);
    setErr('');
  };

  const close = async () => {
    if (busy) return;
    const dirty = text.trim() || attach.type !== 'none';
    if (dirty) {
      const ok = await ask({ title: 'Discard this post?', body: 'What you’ve written will be lost.', confirm: 'Discard', danger: true });
      if (!ok) return;
    }
    reset();
    setOpen(false);
  };

  const upload = async (file: File, kind: 'image' | 'video') => {
    setErr('');
    if (kind === 'image' && file.size > MAX_IMAGE) return setErr('Pick a photo under 15 MB.');
    if (kind === 'video' && file.size > MAX_VIDEO) return setErr('Pick a video under 50 MB, or add a YouTube link instead.');
    setAttach({ type: 'uploading', label: kind === 'image' ? 'Adding photo…' : 'Uploading video…' });
    try {
      const url = await api.uploadImage(file, kind === 'image' ? 'posts' : 'videos');
      setAttach({ type: kind, url });
    } catch (e) {
      setAttach({ type: 'none' });
      setErr((e as Error).message);
    }
  };

  const addLink = async () => {
    const v = await ask({ title: 'Add a video link', body: 'YouTube, Vimeo, Instagram or TikTok.', input: 'Paste the link', confirm: 'Add' });
    if (!v) return;
    if (!toEmbed(v)) return setErr('That link isn’t from YouTube, Vimeo, Instagram or TikTok.');
    setErr('');
    setAttach({ type: 'link', url: v.trim() });
  };

  const caption = text.trim();
  const blocked = hasPaymentTalk(text);
  const ready = !busy && !blocked && attach.type !== 'uploading' && (caption.length > 0 || attach.type === 'image' || attach.type === 'video' || attach.type === 'link');

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setErr('');
    try {
      const media =
        attach.type === 'image'
          ? { kind: 'image' as const, media_url: attach.url }
          : attach.type === 'video' || attach.type === 'link'
            ? { kind: 'video' as const, media_url: attach.url }
            : { kind: 'text' as const, media_url: null };
      const p = await api.createPost({ ...media, caption, tag: feedback && !sensei ? 'feedback' : 'sharing', community: sensei });
      toast(sensei ? 'Posted to the Community feed. Every student has been notified.' : 'Posted.');
      reset();
      setOpen(false);
      navigate(`/p/${p.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const preview =
    attach.type === 'image' || attach.type === 'video' || attach.type === 'link' ? (
      <div className="cx-cmp-attach">
        <Media post={{ kind: attach.type === 'image' ? 'image' : 'video', media_url: attach.url, caption: '' }} />
        <button type="button" className="cx-cmp-remove" onClick={() => setAttach({ type: 'none' })} aria-label="Remove">
          <Icon name="close" size={18} />
        </button>
      </div>
    ) : attach.type === 'uploading' ? (
      <p className="cx-cmp-uploading" role="status">
        <span className="cx-spinner" aria-hidden="true" />
        {attach.label}
      </p>
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
              <small>{sensei ? 'Community feed · every student is notified' : 'Visible to everyone on Connect'}</small>
            </span>
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={!ready} onClick={submit}>
            {busy ? 'Posting…' : 'Post'}
          </button>
        </header>

        <div className="cx-cmp-body">
          <textarea
            ref={box}
            className="cx-cmp-text"
            maxLength={1000}
            value={text}
            placeholder={sensei ? 'What do you want to tell the Ninjas?' : 'What are you working on?'}
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
          <button type="button" onClick={() => photoInput.current?.click()} disabled={attach.type === 'uploading'}>
            <Icon name="image" />
            <span>Photo</span>
          </button>
          <button type="button" onClick={() => videoInput.current?.click()} disabled={attach.type === 'uploading'}>
            <Icon name="video" />
            <span>Video</span>
          </button>
          <button type="button" onClick={addLink} disabled={attach.type === 'uploading'}>
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
              if (f) upload(f, 'image');
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
              if (f) upload(f, 'video');
            }}
          />
        </footer>
      </div>
    </div>
  );
}
