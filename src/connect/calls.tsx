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
};

const START = 'cx:call';
/** Starts a call from anywhere (the chat header, "Call back") */
export function startCall(peer: Peer, conv: string, video: boolean) {
  window.dispatchEvent(new CustomEvent(START, { detail: { peer, conv, video } }));
}

/* soft ring tones, made on the phone (nothing to download) */
let audio: AudioContext | null = null;
function tone(freqs: number[], dur: number) {
  try {
    audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const t = audio.currentTime;
    for (const f of freqs) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
      g.gain.setValueAtTime(0.12, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  } catch {
    /* no sound */
  }
}

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
  };
  const cleanup = () => {
    stopTones();
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
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      remoteStream.current = stream;
      if (remoteVideo.current) remoteVideo.current.srcObject = stream;
      if (remoteAudio.current) remoteAudio.current.srcObject = stream;
    };
    p.onconnectionstatechange = () => {
      if (p.connectionState === 'connected') setSt((c) => (c && c.phase !== 'live' ? { ...c, phase: 'live', startedAt: Date.now() } : c));
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
      tone([440, 480], 1.2);
      ring.current = window.setInterval(() => {
        ringOnce();
        tone([440, 480], 1.2);
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
        tone([660, 880], 0.35);
        ring.current = window.setInterval(() => {
          tone([660, 880], 0.35);
          window.setTimeout(() => tone([660, 880], 0.35), 450);
        }, 2200);
        navigator.vibrate?.([400, 200, 400]);
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
      } else if (sig.type === 'offer' && c.role === 'callee' && sig.sdp) {
        const p = pc.current ?? (await connect());
        await p.setRemoteDescription(sig.sdp);
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
  return (
    <div className={showVideo ? 'cx-call is-video' : 'cx-call'} role="dialog" aria-label={`Call with ${st.peer.name}`}>
      <audio ref={remoteAudio} autoPlay />
      {st.video && <video ref={remoteVideo} className="cx-call-remote" autoPlay playsInline />}
      {st.video && <video ref={localVideo} className={st.camOff ? 'cx-call-self is-off' : 'cx-call-self'} autoPlay playsInline muted />}
      <div className="cx-call-who">
        {!showVideo && <Avatar p={{ name: st.peer.name, avatar_url: st.peer.avatar_url, handle: '' } as Profile} size={112} />}
        <b>{st.peer.name}</b>
        <span>{status}</span>
      </div>
      <div className="cx-call-btns">
        {st.phase === 'incoming' ? (
          <>
            <button type="button" className="cx-call-btn is-end" onClick={decline} aria-label="Decline">
              <Icon name="phone" size={26} />
            </button>
            <button type="button" className="cx-call-btn is-answer" onClick={accept} aria-label="Answer">
              <Icon name={st.video ? 'video' : 'phone'} size={26} />
            </button>
          </>
        ) : (
          <>
            <button type="button" className={st.muted ? 'cx-call-btn is-on' : 'cx-call-btn'} onClick={toggleMute} aria-label={st.muted ? 'Unmute' : 'Mute'} aria-pressed={st.muted}>
              <Icon name="mic" size={24} />
              {st.muted && <span className="cx-call-slash" aria-hidden="true" />}
            </button>
            {st.video && (
              <button type="button" className={st.camOff ? 'cx-call-btn is-on' : 'cx-call-btn'} onClick={toggleCam} aria-label={st.camOff ? 'Turn camera on' : 'Turn camera off'} aria-pressed={st.camOff}>
                <Icon name="video" size={24} />
                {st.camOff && <span className="cx-call-slash" aria-hidden="true" />}
              </button>
            )}
            <button type="button" className="cx-call-btn is-end" onClick={end} aria-label="End call">
              <Icon name="phone" size={26} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
