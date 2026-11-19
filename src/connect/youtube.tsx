/* Lesson videos hosted on YouTube (unlisted). YouTube's own buttons are
   hidden (controls=0) and a layer on top catches every tap, so students
   can't follow a link out to YouTube. Connect draws its own controls:
   play/pause, seek, speed and full screen. Full screen covers the whole
   player, so the name watermark stays on the video. */
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';

type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allow: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(r: number): void;
  destroy(): void;
};
type YTNamespace = { Player: new (el: HTMLElement, o: Record<string, unknown>) => YTPlayer };
type W = Window & { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };

let api: Promise<YTNamespace> | null = null;
function loadApi() {
  if (!api)
    api = new Promise((ok, bad) => {
      const w = window as W;
      if (w.YT?.Player) return ok(w.YT);
      const prev = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => {
        prev?.();
        ok(w.YT!);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => {
        api = null;
        bad(new Error('YouTube didn’t load. Check your connection.'));
      };
      document.head.appendChild(s);
    });
  return api;
}

export function youtubeId(url: string) {
  const m =
    /(?:youtube\.com\/(?:shorts|embed|live|v)\/|youtu\.be\/)([\w-]{11})/.exec(url) || (/youtube\.com\//.test(url) ? /[?&]v=([\w-]{11})/.exec(url) : null);
  return m ? m[1] : null;
}
export const isShort = (url: string) => /youtube\.com\/shorts\//.test(url);
export const ytThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Width/height from YouTube's public oEmbed (tall videos come back tall). Null if it can't tell. */
export async function ytRatio(id: string): Promise<number | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { width?: number; height?: number };
    return j.width && j.height ? j.width / j.height : null;
  } catch {
    return null;
  }
}

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

export function YouTubePlayer({ id, className, style, watermark, onEnded }: { id: string; className: string; style: React.CSSProperties; watermark: React.ReactNode; onEnded?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const [state, setState] = useState(-1); // -1 not started, 0 ended, 1 playing, 2 paused, 3 buffering
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [bar, setBar] = useState(true);
  const [full, setFull] = useState(false);
  const [needTap, setNeedTap] = useState(false);
  const [error, setError] = useState('');
  const [jump, setJump] = useState('');

  useEffect(() => {
    let live = true;
    loadApi()
      .then((YT) => {
        if (!live || !host.current) return;
        player.current = new YT.Player(host.current, {
          videoId: id,
          host: 'https://www.youtube-nocookie.com',
          playerVars: { origin: window.location.origin, autoplay: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, disablekb: 1, fs: 0, cc_load_policy: 0 },
          events: {
            onReady: (e: { target: YTPlayer }) => {
              e.target.playVideo();
              setLength(e.target.getDuration());
              // some phones won't start without a tap on the video itself
              window.setTimeout(() => live && player.current && player.current.getPlayerState() !== 1 && setNeedTap(true), 2500);
            },
            onStateChange: (e: { data: number }) => {
              setState(e.data);
              if (e.data === 1) setNeedTap(false);
              if (e.data === 0) onEnded?.();
            },
            onError: () => setError('This video can’t play. Check it’s Unlisted (not Private) on YouTube.'),
          },
        });
      })
      .catch((e: Error) => setError(e.message));
    const tick = window.setInterval(() => {
      const p = player.current;
      if (!p?.getCurrentTime) return;
      setTime(p.getCurrentTime());
      const d = p.getDuration();
      if (d) setLength(d);
    }, 500);
    const onFs = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      live = false;
      window.clearInterval(tick);
      document.removeEventListener('fullscreenchange', onFs);
      player.current?.destroy?.();
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const showBar = () => {
    setBar(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setBar(false), 3000);
  };
  const playing = state === 1 || state === 3;
  const skip = (by: number) => {
    const p = player.current;
    if (!p) return;
    const to = Math.max(0, Math.min((p.getDuration() || length) - 1, p.getCurrentTime() + by));
    p.seekTo(to, true);
    setTime(to);
    setJump(by > 0 ? '+10s' : '−10s');
    window.setTimeout(() => setJump(''), 600);
    showBar();
  };
  // one tap shows or hides the controls; two quick taps on the left or right
  // jump back or forward 10 seconds (like YouTube)
  const lastTap = useRef(0);
  const tapTimer = useRef<number | undefined>(undefined);
  const tapVideo = (e: React.MouseEvent<HTMLButtonElement>) => {
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const side = e.clientX - rect.left < rect.width / 2 ? -10 : 10;
    if (now - lastTap.current < 300) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = 0;
      skip(side);
      return;
    }
    lastTap.current = now;
    tapTimer.current = window.setTimeout(() => {
      if (!playing) return toggle();
      if (bar) {
        setBar(false);
        window.clearTimeout(hideTimer.current);
      } else showBar();
    }, 260);
  };
  const toggle = () => {
    const p = player.current;
    if (!p) return;
    if (playing) p.pauseVideo();
    else {
      if (state === 0) p.seekTo(0, true);
      p.playVideo();
    }
    showBar();
  };
  const seek = (s: number) => {
    player.current?.seekTo(s, true);
    setTime(s);
    showBar();
  };
  const nextSpeed = () => {
    const s = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    player.current?.setPlaybackRate(s);
    setSpeed(s);
    showBar();
  };
  const toggleFull = async () => {
    const el = box.current;
    if (!el) return;
    if (full) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      setFull(false);
      return;
    }
    try {
      await el.requestFullscreen();
      const wide = Number((style as Record<string, string>)['--ar'] ?? 1.78) > 1;
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (wide) await o.lock?.('landscape').catch(() => {});
    } catch {
      setFull(true); // no full-screen support (iPhone): fill the window instead
    }
    showBar();
  };

  return (
    <div ref={box} className={`${className} cx-yt${full ? ' is-full' : ''}`} style={style} onContextMenu={(e) => e.preventDefault()}>
      <div className="cx-yt-frame">
        <div ref={host} />
      </div>
      {/* catches every tap so nothing reaches YouTube's links */}
      {!needTap && <button type="button" className="cx-yt-tap" aria-label="Show controls" onClick={tapVideo} onMouseMove={showBar} />}
      {/* the end: cover YouTube's suggestions with our own screen */}
      {state === 0 && (
        <div className="cx-yt-end">
          <img src={ytThumb(id)} alt="" />
          <button type="button" className="btn btn-light btn-sm" onClick={toggle}>
            Watch again
          </button>
        </div>
      )}
      {watermark}
      {jump && <span className={`cx-yt-jump${jump.startsWith('+') ? ' is-fwd' : ''}`}>{jump}</span>}
      {error && <p className="cx-yt-error">{error}</p>}
      {!needTap && !error && state !== 0 && (bar || !playing) && (
        <button type="button" className="cx-player-play cx-yt-big" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={28} filled={!playing} />
        </button>
      )}
      <div className={`cx-yt-bar${bar || !playing ? ' is-on' : ''}`}>
        <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={20} filled={!playing} />
        </button>
        <button type="button" onClick={() => skip(-10)} aria-label="Back 10 seconds">
          <Icon name="rewind" size={18} />
        </button>
        <button type="button" onClick={() => skip(10)} aria-label="Forward 10 seconds">
          <Icon name="ffwd" size={18} />
        </button>
        <span className="cx-yt-time">{clock(time)}</span>
        <input type="range" min={0} max={Math.max(1, length)} step={1} value={Math.min(time, length || time)} onChange={(e) => seek(Number(e.target.value))} aria-label="Seek" />
        <span className="cx-yt-time">{clock(length)}</span>
        <button type="button" className="cx-yt-speed" onClick={nextSpeed} aria-label="Playback speed">
          {speed}×
        </button>
        <button type="button" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          <Icon name={full ? 'close' : 'expand'} size={20} />
        </button>
      </div>
    </div>
  );
}
