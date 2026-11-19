/* The in-app camera: tap the shutter for a photo, hold it for a video.
   Flip between the back and front camera. If the browser can't open the
   camera here, the phone's own camera app opens instead. */
import { useEffect, useRef, useState } from 'react';
import { MAX_VIDEO_SECONDS } from './compress';
import { clock } from './chat';
import { Icon } from './ui';

const HOLD_MS = 300;

function recType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? null;
}

export function CameraScreen({ onShot, onClose, onFallback, onGallery }: { onShot: (f: File) => void; onClose: () => void; onFallback: () => void; onGallery: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [secs, setSecs] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [failed, setFailed] = useState(false);

  // open (or switch) the camera
  useEffect(() => {
    let live = true;
    (async () => {
      setReady(false);
      stream.current?.getTracks().forEach((t) => t.stop());
      if (!navigator.mediaDevices?.getUserMedia) return setFailed(true);
      const video0 = { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } };
      let s: MediaStream | null = null;
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: video0, audio: true });
      } catch {
        // no microphone (or not allowed): photos and silent videos still work
        s = await navigator.mediaDevices.getUserMedia({ video: video0 }).catch(() => null);
      }
      if (!live) return s?.getTracks().forEach((t) => t.stop());
      if (!s) return setFailed(true);
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
      }
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [facing]);

  // close the camera when leaving
  useEffect(
    () => () => {
      rec.current?.state === 'recording' && rec.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d')!;
    if (facing === 'user') {
      // the front camera shows a mirror; save it the way it looked
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 160);
    c.toBlob((b) => b && onShot(new File([b], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.9);
  };

  const startVideo = () => {
    const type = recType();
    if (!type || !stream.current) return;
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream.current, { mimeType: type, videoBitsPerSecond: 2_500_000 });
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const started = Date.now();
    const tick = window.setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setSecs(s);
      if (s >= MAX_VIDEO_SECONDS) r.stop();
    }, 250);
    r.onstop = () => {
      window.clearInterval(tick);
      setSecs(null);
      const mime = type.split(';')[0];
      const blob = new Blob(chunks, { type: mime });
      if (blob.size) onShot(new File([blob], `video-${Date.now()}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`, { type: mime }));
    };
    r.start(500);
    rec.current = r;
    setSecs(0);
  };

  const down = () => {
    if (!ready) return;
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = undefined;
      startVideo();
    }, HOLD_MS);
  };
  const up = () => {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = undefined;
      snap();
    } else if (rec.current?.state === 'recording') rec.current.stop();
  };

  const recording = secs !== null;
  return (
    <div className="cx-cam" role="dialog" aria-label="Camera">
      <video ref={video} className={facing === 'user' ? 'is-front' : ''} playsInline muted autoPlay />
      {flash && <span className="cx-cam-flash" aria-hidden="true" />}
      <div className="cx-cam-top">
        <button type="button" className="cx-cam-btn" onClick={onClose} aria-label="Close camera">
          <Icon name="close" />
        </button>
        {recording && (
          <span className="cx-cam-time">
            <i aria-hidden="true" /> {clock(secs)}
          </span>
        )}
        <span />
      </div>
      <div className="cx-cam-bottom">
        <button type="button" className="cx-cam-btn" onClick={onGallery} aria-label="Pick from your gallery" disabled={recording}>
          <Icon name="image" />
        </button>
        <button
          type="button"
          className={recording ? 'cx-cam-shutter is-rec' : 'cx-cam-shutter'}
          onPointerDown={down}
          onPointerUp={up}
          onPointerLeave={() => recording && up()}
          onContextMenu={(e) => e.preventDefault()}
          disabled={!ready}
          aria-label="Tap for a photo, hold for a video"
        />
        <button type="button" className="cx-cam-btn" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label="Switch camera" disabled={recording}>
          <Icon name="flip" />
        </button>
      </div>
      {failed && (
        <div className="cx-cam-failed">
          <p>Connect couldn’t open the camera. Allow camera access for this site, or use your phone’s camera app.</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={onFallback}>
            Open camera app
          </button>
        </div>
      )}
      <p className="cx-cam-hint">{recording ? 'Let go to stop' : 'Tap for photo, hold for video'}</p>
    </div>
  );
}
