'use client';
/* Crop a photo before it's uploaded: drag to move, pinch or slide to zoom.
   Profile photos crop to a circle (saved square), covers to 3:1. */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  file: File;
  /** width ÷ height of the result */
  aspect: number;
  round?: boolean;
  /** size of the saved picture */
  outWidth: number;
  title: string;
  onDone: (f: File) => void;
  onCancel: () => void;
};

export function CropSheet({ file, aspect, round = false, outWidth, title, onDone, onCancel }: Props) {
  const [src] = useState(() => URL.createObjectURL(file));
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [frameW, setFrameW] = useState(320);
  const frameH = frameW / aspect;
  // zoom 1 = the photo just covers the frame
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => URL.revokeObjectURL(src), [src]);
  useEffect(() => {
    const fit = () => setFrameW(Math.min(360, window.innerWidth - 48));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const base = nat ? Math.max(frameW / nat.w, frameH / nat.h) : 1;
  const s = base * zoom;
  const imgW = nat ? nat.w * s : 0;
  const imgH = nat ? nat.h * s : 0;
  // keep the photo covering the frame
  const clamp = (p: { x: number; y: number }, w = imgW, h = imgH) => ({
    x: Math.min(0, Math.max(frameW - w, p.x)),
    y: Math.min(0, Math.max(frameH - h, p.y)),
  });

  // centred when the photo loads
  useEffect(() => {
    if (!nat) return;
    const b = Math.max(frameW / nat.w, frameH / nat.h);
    setPos({ x: (frameW - nat.w * b) / 2, y: (frameH - nat.h * b) / 2 });
    setZoom(1);
  }, [nat, frameW, frameH]);

  const setZoomAround = (z: number) => {
    if (!nat) return;
    const nz = Math.min(4, Math.max(1, z));
    const ns = base * nz;
    // zoom around the middle of the frame
    const cx = (frameW / 2 - pos.x) / s;
    const cy = (frameH / 2 - pos.y) / s;
    const next = { x: frameW / 2 - cx * ns, y: frameH / 2 - cy * ns };
    setZoom(nz);
    setPos(clamp(next, nat.w * ns, nat.h * ns));
  };

  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom };
    }
  };
  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoomAround((pinch.current.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d);
      return;
    }
    setPos((p) => clamp({ x: p.x + e.clientX - prev.x, y: p.y + e.clientY - prev.y }));
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const done = async () => {
    if (!nat) return;
    setBusy(true);
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const outH = Math.round(outWidth / aspect);
      const c = document.createElement('canvas');
      c.width = outWidth;
      c.height = outH;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, -pos.x / s, -pos.y / s, frameW / s, frameH / s, 0, 0, outWidth, outH);
      const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('crop'))), 'image/jpeg', 0.9));
      onDone(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
    } catch {
      onDone(file);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="cx-crop" role="dialog" aria-modal="true" aria-label={title}>
      <p className="cx-crop-title">{title}</p>
      <div
        className={round ? 'cx-crop-frame is-round' : 'cx-crop-frame'}
        style={{ width: frameW, height: frameH }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{ width: imgW || undefined, height: imgH || undefined, transform: `translate(${pos.x}px, ${pos.y}px)` }}
        />
        <span className="cx-crop-mask" aria-hidden="true" />
      </div>
      <label className="cx-crop-zoom">
        <span className="sr-only">Zoom</span>
        <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoomAround(Number(e.target.value))} />
      </label>
      <p className="cx-crop-hint">Drag to move · pinch or slide to zoom</p>
      <div className="cx-crop-btns">
        <button type="button" className="btn btn-light" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!nat || busy} onClick={done}>
          {busy ? 'Saving…' : 'Use photo'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
