/* Makes a video smaller before it's sent, like WhatsApp does.
   The phone plays the video once, quietly, into a 480p canvas and records it
   again at a lower bitrate. That takes about as long as the video itself.
   A 1-minute phone video (often 100+ MB) comes out at roughly 8 MB.
   If the browser can't do it, the original is sent (when it's under the limit). */

const LONG_SIDE = 854; // 480p
const VIDEO_BPS = 1_000_000;
const AUDIO_BPS = 64_000;
export const MAX_VIDEO_SECONDS = 3 * 60;
const SMALL_ENOUGH = 6 * 1024 * 1024; // already small: send as it is

function pickType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? null;
}

/** Length of a video file in seconds (0 if it can't be read) */
export function videoSeconds(file: File): Promise<number> {
  return new Promise((ok) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = URL.createObjectURL(file);
    const done = (s: number) => {
      URL.revokeObjectURL(v.src);
      ok(s);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : 0);
    v.onerror = () => done(0);
    window.setTimeout(() => done(0), 5000);
  });
}

export async function compressVideo(file: File, onProgress?: (share: number) => void): Promise<File> {
  const type = pickType();
  const canvasOk = typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
  if (file.size <= SMALL_ENOUGH || !type || !canvasOk) return file;

  const src = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.src = src;
  v.playsInline = true;
  v.preload = 'auto';
  // keep the sound for the recording, but don't play it out loud
  v.muted = false;
  v.volume = 1;

  try {
    await new Promise<void>((ok, bad) => {
      v.onloadedmetadata = () => ok();
      v.onerror = () => bad(new Error('video'));
      window.setTimeout(() => bad(new Error('timeout')), 8000);
    });
    const w0 = v.videoWidth;
    const h0 = v.videoHeight;
    const duration = v.duration;
    if (!w0 || !h0 || !Number.isFinite(duration)) return file;

    const scale = Math.min(1, LONG_SIDE / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((w0 * scale) / 2) * 2;
    canvas.height = Math.round((h0 * scale) / 2) * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    const stream = canvas.captureStream(30);
    // sound: route the video's audio into the recording only
    let audioCtx: AudioContext | null = null;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AC();
      const source = audioCtx.createMediaElementSource(v);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch {
      v.muted = true; // no sound track, but the picture still works
    }

    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((ok) => (rec.onstop = () => ok()));

    let raf = 0;
    const draw = () => {
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      onProgress?.(Math.min(0.99, v.currentTime / duration));
      if (!v.ended) raf = requestAnimationFrame(draw);
    };

    rec.start(1000);
    await audioCtx?.resume().catch(() => {});
    await v.play();
    draw();
    await new Promise<void>((ok) => {
      v.onended = () => ok();
      // safety net if "ended" never fires
      window.setTimeout(ok, (duration + 5) * 1000);
    });
    cancelAnimationFrame(raf);
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    audioCtx?.close().catch(() => {});

    const mime = type.split(';')[0];
    const out = new File(chunks, file.name.replace(/\.[^.]+$/, '') + (mime === 'video/mp4' ? '.mp4' : '.webm'), { type: mime });
    onProgress?.(1);
    // keep whichever is smaller
    return out.size > 0 && out.size < file.size ? out : file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(src);
    v.removeAttribute('src');
  }
}
