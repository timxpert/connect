'use client';
/* Private voice and video calls, phone to phone (WebRTC).
   Ringing and connection details travel over Supabase Realtime; the call
   itself goes straight between the phones, or through Cloudflare's relay
   when a network blocks that. Only the caller writes the line in the chat. */

import React, { useEffect, useRef, useState } from 'react';
import { useConnect } from './context';
import type { CallSignal, Profile } from './types';
import { Avatar, Icon } from './ui';

type Peer = { id: string; name: string; avatar_url: string | null };
type State = {
  call: string;
  peer: Peer;
  conv: string;
  video: boolean;
  role: 'caller' | 'callee';
  phase: 'outgoing' | 'incoming' | 'connecting' | 'live';
  startedAt?: number;
  muted: boolean;
  camOff: boolean;
  /** which camera: front (mirrored) or back */
  facing?: 'user' | 'environment';
  /** switching a voice call to video: 'out' = I asked, 'in' = they asked */
  asking?: 'out' | 'in';
};

const START = 'cx:call';
/** Starts a call from anywhere (the chat header, "Call back") */
export function startCall(peer: Peer, conv: string, video: boolean) {
  window.dispatchEvent(new CustomEvent(START, { detail: { peer, conv, video } }));
}

/* Call sounds, made on the phone (nothing to download): a soft bell-like
   note with a quick fade, put together into short tunes. */
let audio: AudioContext | null = null;
const playing = new Set<OscillatorNode>();
type Note = [freq: number, at: number, dur: number, vol?: number];
function tune(notes: Note[]) {
  try {
    audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const t0 = audio.currentTime + 0.02;
    for (const [f, at, dur, vol = 0.22] of notes) {
      // the note and a quieter octave above it: rounder than a plain beep
      for (const [mult, share] of [
        [1, 1],
        [2, 0.18],
      ] as const) {
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = 'sine';
        o.frequency.value = f * mult;
        const t = t0 + at;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol * share, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(audio.destination);
        o.start(t);
        o.stop(t + dur + 0.05);
        playing.add(o);
        o.onended = () => playing.delete(o);
      }
    }
  } catch {
    /* no sound */
  }
}
/* Ringing: Marimba when someone calls you, a phone ring while you call
   someone. Each is a 3-second ring, looped; the phone vibrates on each
   incoming ring. Phones only let a page make sound after it has been tapped,
   so the first tap anywhere in Connect unlocks both. */
const RING_SECS = 3;
const RING_BUZZ = [450, 150, 450];
type Ring = 'incoming' | 'calling';
const RING_FILES: Record<Ring, string> = { incoming: '/assets/sounds/ringtone.mp3', calling: '/assets/sounds/ringback.mp3' };
const ringEls: Partial<Record<Ring, HTMLAudioElement>> = {};
let ringOn = false;
function prepareRingtone() {
  if (ringEls.incoming || typeof window === 'undefined') return;
  for (const k of Object.keys(RING_FILES) as Ring[]) {
    const el = new Audio(RING_FILES[k]);
    el.loop = true;
    el.preload = 'auto';
    ringEls[k] = el;
  }
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    // the sound player for the short call sounds
    try {
      audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch {
      /* no sound */
    }
    // play each ring silently for a moment so the phone allows it later
    for (const el of Object.values(ringEls)) {
      if (!el || ringOn) continue;
      el.muted = true;
      el.play()
        .then(() => {
          if (ringOn) return;
          el.pause();
          el.currentTime = 0;
          el.muted = false;
        })
        .catch(() => {
          el.muted = false;
        });
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}
/** Starts a ring; calls back if the phone won't play it */
function startRingtone(kind: Ring, onBlocked: () => void) {
  const el = ringEls[kind];
  if (!el) return onBlocked();
  ringOn = true;
  el.muted = false;
  el.currentTime = 0;
  el.volume = kind === 'calling' ? 0.6 : 1;
  el.play().catch(onBlocked);
}
function stopRingtone() {
  ringOn = false;
  for (const el of Object.values(ringEls)) {
    if (!el) continue;
    el.pause();
    el.currentTime = 0;
  }
  navigator.vibrate?.(0);
}

const hush = () => {
  stopRingtone();
  playing.forEach((o) => {
    try {
      o.stop();
    } catch {
      /* already stopped */
    }
  });
  playing.clear();
};
const SOUNDS = {
  // incoming: a bright little run, played twice
  ring: [
    [659.25, 0, 0.5],
    [783.99, 0.16, 0.5],
    [987.77, 0.32, 0.5],
    [1318.5, 0.48, 0.9],
    [659.25, 1.1, 0.5],
    [783.99, 1.26, 0.5],
    [987.77, 1.42, 0.5],
    [1318.5, 1.58, 0.9],
  ] as Note[],
  // while calling: a calm two-note pulse
  ringback: [
    [523.25, 0, 1.1, 0.12],
    [659.25, 0.35, 1.1, 0.1],
  ] as Note[],
  connected: [
    [783.99, 0, 0.25, 0.18],
    [1046.5, 0.12, 0.45, 0.18],
  ] as Note[],
  ended: [
    [659.25, 0, 0.3, 0.18],
    [523.25, 0.16, 0.3, 0.18],
    [392, 0.32, 0.6, 0.18],
  ] as Note[],
  ask: [
    [880, 0, 0.3, 0.16],
    [1174.66, 0.14, 0.5, 0.16],
  ] as Note[],
};

/** A round call button with its label underneath */
const Btn = ({ label, className = 'cx-call-btn', onClick, on, children }: { label: string; className?: string; onClick: () => void; on?: boolean; children: React.ReactNode }) => (
  <div className="cx-call-act">
    <button type="button" className={on ? `${className} is-on` : className} onClick={onClick} aria-label={label} aria-pressed={on}>
      {children}
    </button>
    <small aria-hidden="true">{label}</small>
  </div>
);

const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function CallLayer() {
  const { api, me, toast } = useConnect();
  const [st, setSt] = useState<State | null>(null);
  const [now, setNow] = useState(Date.now());
  const s = useRef<State | null>(null);
  s.current = st;
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const timers = useRef<number[]>([]);
  const ring = useRef(0);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteStream = useRef<MediaStream | null>(null);

  const meAsPeer = (): Peer => ({ id: me!.id, name: me!.name, avatar_url: me!.avatar_url ?? null });
  const send = (type: CallSignal['type'], extra: Partial<CallSignal> = {}) => {
    const c = s.current;
    if (!c || !me) return;
    api.callSend(c.peer.id, { type, call: c.call, from: meAsPeer(), conv: c.conv, video: c.video, ...extra });
  };
  const stopTones = () => {
    window.clearInterval(ring.current);
    ring.current = 0;
    hush();
  };
  const cleanup = () => {
    stopTones();
    // every call that closes ends with the same short "call ended" sound
    if (s.current) tune(SOUNDS.ended);
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    pc.current?.close();
    pc.current = null;
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    remoteStream.current = null;
    pendingIce.current = [];
    setSt(null);
  };
  /** The caller writes the line in the chat */
  const log = (status: 'missed' | 'declined' | 'ended') => {
    const c = s.current;
    if (!c || c.role !== 'caller') return;
    const secs = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
    api.logCall(c.conv, { video: c.video, status, secs }).catch(() => {});
  };

  const media = async (video: boolean) => {
    const m = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
    });
    local.current = m;
    if (localVideo.current) localVideo.current.srcObject = m;
    return m;
  };
  const connect = async () => {
    const p = new RTCPeerConnection({ iceServers: await api.iceServers() });
    pc.current = p;
    local.current?.getTracks().forEach((t) => p.addTrack(t, local.current!));
    p.onicecandidate = (e) => e.candidate && send('ice', { ice: e.candidate.toJSON() });
    p.ontrack = (e) => {
      // a camera added mid-call joins the same stream; set it again so the picture starts
      const stream = e.streams[0] ?? remoteStream.current ?? new MediaStream();
      if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      remoteStream.current = stream;
      if (remoteVideo.current) {
        remoteVideo.current.srcObject = null;
        remoteVideo.current.srcObject = stream;
      }
      if (remoteAudio.current && remoteAudio.current.srcObject !== stream) remoteAudio.current.srcObject = stream;
    };
    p.onconnectionstatechange = () => {
      if (p.connectionState === 'connected' && s.current && s.current.phase !== 'live') {
        tune(SOUNDS.connected);
        setSt((c) => (c && c.phase !== 'live' ? { ...c, phase: 'live', startedAt: Date.now() } : c));
      }
      if (p.connectionState === 'failed') {
        toast('The call dropped. Check your connection and try again.');
        send('hangup');
        log(s.current?.startedAt ? 'ended' : 'missed');
        cleanup();
      }
    };
    return p;
  };
  const flushIce = async () => {
    const p = pc.current;
    if (!p?.remoteDescription) return;
    for (const c of pendingIce.current.splice(0)) await p.addIceCandidate(c).catch(() => {});
  };

  /** My camera into the call, on the video slot the other phone opened */
  const attachCamera = async (p: RTCPeerConnection) => {
    const vt = local.current?.getVideoTracks()[0];
    if (!vt || p.getSenders().some((x) => x.track === vt)) return;
    const slot = p.getTransceivers().find((t) => t.receiver.track.kind === 'video' && !t.sender.track);
    if (slot) {
      await slot.sender.replaceTrack(vt);
      slot.direction = 'sendrecv';
    } else p.addTrack(vt, local.current!);
  };
  /** Back to voice: my camera off and out of the call */
  const dropCamera = () => {
    const p = pc.current;
    local.current?.getVideoTracks().forEach((t) => {
      const sender = p?.getSenders().find((x) => x.track === t);
      if (sender) sender.replaceTrack(null).catch(() => {});
      t.stop();
      local.current?.removeTrack(t);
    });
    setSt((x) => (x ? { ...x, video: false, asking: undefined, camOff: false } : x));
  };
  const camera = (facing: 'user' | 'environment') =>
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } } }).then((m) => m.getVideoTracks()[0]);

  // get the ringtone ready before anyone calls
  useEffect(() => {
    prepareRingtone();
  }, []);

  /* placing a call */
  useEffect(() => {
    const onStart = async (e: Event) => {
      const { peer, conv, video } = (e as CustomEvent<{ peer: Peer; conv: string; video: boolean }>).detail;
      if (!me || s.current) return;
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') return toast('Calls don’t work in this browser.');
      const call = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const next: State = { call, peer, conv, video, role: 'caller', phase: 'outgoing', muted: false, camOff: false };
      s.current = next;
      setSt(next);
      try {
        await media(video);
      } catch {
        toast(video ? 'Allow the camera and microphone to make a video call.' : 'Allow the microphone to make a call.');
        cleanup();
        return;
      }
      // keep ringing until they answer (their phone may be just opening Connect)
      const ringOnce = () => api.callSend(peer.id, { type: 'ring', call, from: meAsPeer(), conv, video });
      ringOnce();
      api.ringPhone(conv, video).catch(() => {});
      // the phone ring while calling (the made-on-the-phone pulse only if the phone blocks it)
      let blocked = false;
      startRingtone('calling', () => {
        blocked = true;
        tune(SOUNDS.ringback);
      });
      ring.current = window.setInterval(() => {
        ringOnce();
        if (blocked) tune(SOUNDS.ringback);
      }, 3000);
      timers.current.push(
        window.setTimeout(() => {
          if (s.current?.call === call && s.current.phase === 'outgoing') {
            send('hangup');
            log('missed');
            toast(`${peer.name.split(' ')[0]} didn’t answer`);
            cleanup();
          }
        }, 45000),
      );
    };
    window.addEventListener(START, onStart);
    return () => window.removeEventListener(START, onStart);
  }, [me?.id]);

  /* signals from the other phone */
  useEffect(() => {
    if (!me) return;
    return api.callListen(async (sig) => {
      const c = s.current;
      if (sig.type === 'ring') {
        if (c && c.call !== sig.call) return api.callSend(sig.from.id, { type: 'busy', call: sig.call, from: meAsPeer(), conv: sig.conv });
        if (c) return; // already showing this call
        const next: State = { call: sig.call, peer: sig.from, conv: sig.conv, video: Boolean(sig.video), role: 'callee', phase: 'incoming', muted: false, camOff: false };
        s.current = next;
        setSt(next);
        // Marimba, looping; the phone buzzes in time with each ring.
        // If the phone won't play it, the made-on-the-phone tune rings instead.
        let blocked = false;
        startRingtone('incoming', () => {
          blocked = true;
          tune(SOUNDS.ring);
        });
        navigator.vibrate?.(RING_BUZZ);
        ring.current = window.setInterval(() => {
          if (blocked) tune(SOUNDS.ring);
          navigator.vibrate?.(RING_BUZZ);
        }, RING_SECS * 1000);
        // the caller stops after 45 s; tidy up if their hang-up never arrives
        timers.current.push(window.setTimeout(() => s.current?.call === sig.call && s.current?.phase === 'incoming' && cleanup(), 50000));
        return;
      }
      if (!c || sig.call !== c.call) return;
      if (sig.type === 'accept' && c.role === 'caller') {
        stopTones();
        setSt({ ...c, phase: 'connecting' });
        const p = await connect();
        const offer = await p.createOffer();
        await p.setLocalDescription(offer);
        send('offer', { sdp: offer });
      } else if (sig.type === 'offer' && sig.sdp) {
        // the first offer, or a new one when a voice call switches to video
        const p = pc.current ?? (await connect());
        await p.setRemoteDescription(sig.sdp);
        await attachCamera(p);
        const answer = await p.createAnswer();
        await p.setLocalDescription(answer);
        send('answer', { sdp: answer });
        await flushIce();
      } else if (sig.type === 'answer' && sig.sdp && pc.current) {
        await pc.current.setRemoteDescription(sig.sdp);
        await flushIce();
      } else if (sig.type === 'ice' && sig.ice) {
        if (pc.current?.remoteDescription) await pc.current.addIceCandidate(sig.ice).catch(() => {});
        else pendingIce.current.push(sig.ice);
      } else if (sig.type === 'upgrade') {
        tune(SOUNDS.ask);
        setSt({ ...c, asking: 'in' });
      } else if (sig.type === 'upgrade-ok' && pc.current) {
        setSt((x) => (x ? { ...x, asking: undefined } : x));
        const offer = await pc.current.createOffer();
        await pc.current.setLocalDescription(offer);
        send('offer', { sdp: offer });
      } else if (sig.type === 'upgrade-no') {
        dropCamera();
        toast(`${c.peer.name.split(' ')[0]} wants to stay on voice`);
      } else if (sig.type === 'decline') {
        log('declined');
        toast(`${c.peer.name.split(' ')[0]} can’t talk right now`);
        cleanup();
      } else if (sig.type === 'busy') {
        log('missed');
        toast(`${c.peer.name.split(' ')[0]} is on another call`);
        cleanup();
      } else if (sig.type === 'hangup') {
        if (c.phase === 'incoming') toast(`Missed call from ${c.peer.name.split(' ')[0]}`);
        log(c.startedAt ? 'ended' : 'missed');
        cleanup();
      }
    });
  }, [api, me?.id]);

  // call timer
  useEffect(() => {
    if (st?.phase !== 'live') return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [st?.phase]);
  // keep the video elements fed after re-renders
  useEffect(() => {
    if (localVideo.current && local.current && localVideo.current.srcObject !== local.current) localVideo.current.srcObject = local.current;
    if (remoteStream.current) {
      if (remoteVideo.current && remoteVideo.current.srcObject !== remoteStream.current) remoteVideo.current.srcObject = remoteStream.current;
      if (remoteAudio.current && remoteAudio.current.srcObject !== remoteStream.current) remoteAudio.current.srcObject = remoteStream.current;
    }
  });
  // closing the page mid-call hangs up
  useEffect(() => {
    const bye = () => s.current && send('hangup');
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, []);

  if (!st) return null;

  const accept = async () => {
    stopTones();
    try {
      await media(st.video);
    } catch {
      toast(st.video ? 'Allow the camera and microphone to answer.' : 'Allow the microphone to answer.');
      send('decline');
      cleanup();
      return;
    }
    setSt({ ...st, phase: 'connecting' });
    await connect();
    send('accept');
  };
  const decline = () => {
    send('decline');
    cleanup();
  };
  // front ↔ back camera
  const flip = async () => {
    const old = local.current?.getVideoTracks()[0];
    const next = st.facing === 'environment' ? 'user' : 'environment';
    old?.stop(); // many phones can't open both cameras at once
    try {
      const t = await camera(next);
      t.enabled = !st.camOff;
      if (old) local.current?.removeTrack(old);
      local.current?.addTrack(t);
      const sender = old ? pc.current?.getSenders().find((x) => x.track === old) : undefined;
      await sender?.replaceTrack(t);
      if (localVideo.current) {
        localVideo.current.srcObject = null;
        localVideo.current.srcObject = local.current;
      }
      setSt({ ...st, facing: next });
    } catch {
      toast('Couldn’t switch the camera.');
    }
  };
  // voice → video: ask the other person
  const askVideo = async () => {
    if (!pc.current || !local.current) return;
    try {
      const t = await camera('user');
      local.current.addTrack(t);
      pc.current.addTrack(t, local.current);
      setSt({ ...st, video: true, facing: 'user', camOff: false, asking: 'out' });
      send('upgrade');
    } catch {
      toast('Allow the camera to switch to video.');
    }
  };
  const answerVideo = async (yes: boolean) => {
    if (!yes) {
      setSt({ ...st, asking: undefined });
      send('upgrade-no');
      return;
    }
    try {
      const t = await camera('user');
      local.current?.addTrack(t);
      setSt({ ...st, video: true, facing: 'user', camOff: false, asking: undefined });
      send('upgrade-ok');
    } catch {
      toast('Allow the camera to switch to video.');
      setSt({ ...st, asking: undefined });
      send('upgrade-no');
    }
  };
  const end = () => {
    send('hangup');
    log(st.startedAt ? 'ended' : 'missed');
    cleanup();
  };
  const toggleMute = () => {
    local.current?.getAudioTracks().forEach((t) => (t.enabled = st.muted));
    setSt({ ...st, muted: !st.muted });
  };
  const toggleCam = () => {
    local.current?.getVideoTracks().forEach((t) => (t.enabled = st.camOff));
    setSt({ ...st, camOff: !st.camOff });
  };

  const status =
    st.phase === 'incoming'
      ? st.video
        ? 'Incoming video call'
        : 'Incoming voice call'
      : st.phase === 'outgoing'
        ? 'Ringing…'
        : st.phase === 'connecting'
          ? 'Connecting…'
          : clockOf(Math.max(0, Math.round((now - (st.startedAt ?? now)) / 1000)));
  const showVideo = st.video && (st.phase === 'live' || st.phase === 'connecting');
  const first = st.peer.name.split(' ')[0];
  const shownStatus = st.asking === 'out' ? `Asking ${first} to switch to video…` : status;
  return (
    <div className={showVideo ? 'cx-call is-video' : 'cx-call'} role="dialog" aria-label={`Call with ${st.peer.name}`}>
      <audio ref={remoteAudio} autoPlay />
      {st.video && <video ref={remoteVideo} className="cx-call-remote" autoPlay playsInline />}
      {st.video && <video ref={localVideo} className={['cx-call-self', st.camOff ? 'is-off' : '', st.facing === 'environment' ? 'is-back' : ''].join(' ').trim()} autoPlay playsInline muted />}
      <div className="cx-call-who">
        {!showVideo && <Avatar p={{ name: st.peer.name, avatar_url: st.peer.avatar_url, handle: '' } as Profile} size={112} />}
        <b>{st.peer.name}</b>
        <span>{shownStatus}</span>
      </div>
      {st.asking === 'in' && (
        <div className="cx-call-ask" role="alertdialog" aria-label="Switch to video">
          <p>{first} wants to switch to video</p>
          <div>
            <button type="button" className="cx-call-ask-no" onClick={() => answerVideo(false)}>
              Not now
            </button>
            <button type="button" className="cx-call-ask-yes" onClick={() => answerVideo(true)}>
              Switch
            </button>
          </div>
        </div>
      )}
      <div className="cx-call-btns">
        {st.phase === 'incoming' ? (
          <>
            <Btn label="Decline" className="cx-call-btn is-end" onClick={decline}>
              <Icon name="phone" size={26} />
            </Btn>
            <Btn label="Accept" className="cx-call-btn is-answer" onClick={accept}>
              <Icon name={st.video ? 'cam' : 'phone'} size={26} />
            </Btn>
          </>
        ) : (
          <>
            <Btn label={st.muted ? 'Unmute' : 'Mute'} onClick={toggleMute} on={st.muted}>
              <Icon name="mic" size={24} />
              {st.muted && <span className="cx-call-slash" aria-hidden="true" />}
            </Btn>
            {st.video ? (
              <>
                <Btn label={st.camOff ? 'Camera on' : 'Camera'} onClick={toggleCam} on={st.camOff}>
                  <Icon name="cam" size={24} />
                  {st.camOff && <span className="cx-call-slash" aria-hidden="true" />}
                </Btn>
                <Btn label="Flip" onClick={flip}>
                  <Icon name="flip" size={24} />
                </Btn>
              </>
            ) : (
              st.phase === 'live' && (
                <Btn label="Video" onClick={askVideo}>
                  <Icon name="cam" size={24} />
                </Btn>
              )
            )}
            <Btn label="End" className="cx-call-btn is-end" onClick={end}>
              <Icon name="phone" size={26} />
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}
