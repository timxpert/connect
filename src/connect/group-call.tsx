'use client';
/* Group calls inside Connect. Everyone sends their sound (and video, if they
   choose) once to Cloudflare Realtime, which passes it on to everyone else in
   the call. Who's in the call travels over Supabase presence. */

import React, { useEffect, useRef, useState } from 'react';
import { useConnect } from './context';
import type { RoomPerson } from './types';
import { Avatar, Icon } from './ui';

type Tile = { person: RoomPerson; stream: MediaStream };
type SfuTrack = { mid?: string; trackName?: string; errorCode?: string };
type SfuReply = { sessionId?: string; sessionDescription?: RTCSessionDescriptionInit; requiresImmediateRenegotiation?: boolean; tracks?: SfuTrack[] };

const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];

function TileView({ t, self }: { t: Tile; self?: boolean }) {
  const v = useRef<HTMLVideoElement>(null);
  const a = useRef<HTMLAudioElement>(null);
  const hasVideo = t.stream.getVideoTracks().length > 0 && !t.person.camOff;
  useEffect(() => {
    if (v.current && v.current.srcObject !== t.stream) v.current.srcObject = t.stream;
    if (a.current && a.current.srcObject !== t.stream) a.current.srcObject = t.stream;
  });
  return (
    <div className={hasVideo ? 'cx-gc-tile has-video' : 'cx-gc-tile'}>
      {!self && <audio ref={a} autoPlay />}
      {hasVideo ? <video ref={v} autoPlay playsInline muted className={self ? 'is-self' : undefined} /> : <Avatar p={{ name: t.person.name, avatar_url: t.person.avatar_url, handle: '' } as never} size={72} />}
      <span className="cx-gc-name">
        {t.person.muted && <Icon name="mic" size={13} />}
        {self ? 'You' : t.person.name.split(' ')[0]}
      </span>
    </div>
  );
}

export function GroupCall({ room, title, onClose }: { room: string; title: string; onClose: () => void }) {
  const { api, me, toast } = useConnect();
  const [step, setStep] = useState<'choose' | 'joining' | 'in'>('choose');
  const [people, setPeople] = useState<RoomPerson[]>([]);
  const [tiles, setTiles] = useState<Record<string, Tile>>({});
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const session = useRef('');
  const roomRef = useRef<ReturnType<typeof api.callRoom> | null>(null);
  const mine = useRef<RoomPerson | null>(null);
  // which incoming media slot (mid) belongs to whom, and what we've already asked for
  const midOwner = useRef(new Map<string, string>());
  const pulled = useRef(new Set<string>());
  const queue = useRef(Promise.resolve());

  // see who's already in the call before joining
  useEffect(() => {
    const r = api.callRoom(room, (list) => setPeople(list));
    roomRef.current = r;
    return () => r.leave();
  }, [api, room]);

  const leave = () => {
    pc.current?.close();
    pc.current = null;
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    onClose();
  };
  useEffect(() => () => {
    pc.current?.close();
    local.current?.getTracks().forEach((t) => t.stop());
  }, []);

  /** Pulls each new person's sound and video, one request at a time */
  const pull = (list: RoomPerson[]) => {
    queue.current = queue.current.then(async () => {
      const p = pc.current;
      if (!p || !me) return;
      const want = list.filter((x) => x.id !== me.id && x.session).flatMap((x) => x.tracks.map((t) => ({ x, t }))).filter(({ x, t }) => !pulled.current.has(`${x.session}/${t.name}`));
      if (!want.length) return;
      want.forEach(({ x, t }) => pulled.current.add(`${x.session}/${t.name}`));
      const r = await api.sfu<SfuReply>(`sessions/${session.current}/tracks/new`, 'POST', {
        tracks: want.map(({ x, t }) => ({ location: 'remote', sessionId: x.session, trackName: t.name })),
      });
      (r.tracks ?? []).forEach((t, i) => t.mid && midOwner.current.set(t.mid, want[i]?.x.id ?? ''));
      if (r.requiresImmediateRenegotiation && r.sessionDescription) {
        await p.setRemoteDescription(r.sessionDescription);
        await p.setLocalDescription(await p.createAnswer());
        await api.sfu(`sessions/${session.current}/renegotiate`, 'PUT', { sessionDescription: { type: 'answer', sdp: p.localDescription!.sdp } });
      }
    }).catch(() => {});
  };
  useEffect(() => {
    if (step === 'in') pull(people);
    // drop tiles of people who left
    setTiles((ts) => {
      const here = new Set(people.map((x) => x.id));
      const next: Record<string, Tile> = {};
      for (const [id, t] of Object.entries(ts)) if (here.has(id) || id === me?.id) next[id] = { ...t, person: people.find((x) => x.id === id) ?? t.person };
      return next;
    });
  }, [people, step]);

  const join = async (video: boolean) => {
    if (!me) return;
    setStep('joining');
    try {
      const m = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: video ? { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15 } } : false });
      local.current = m;
      const p = new RTCPeerConnection({ iceServers: STUN, bundlePolicy: 'max-bundle' });
      pc.current = p;
      p.ontrack = (e) => {
        const owner = midOwner.current.get(e.transceiver.mid ?? '');
        const who = people.find((x) => x.id === owner);
        if (!owner) return;
        setTiles((ts) => {
          const cur = ts[owner];
          const stream = cur?.stream ?? new MediaStream();
          stream.addTrack(e.track);
          return { ...ts, [owner]: { person: who ?? cur?.person ?? ({ id: owner, name: 'Member', avatar_url: null } as RoomPerson), stream } };
        });
      };
      const sends = m.getTracks().map((t) => p.addTransceiver(t, { direction: 'sendonly' }));
      await p.setLocalDescription(await p.createOffer());
      const s = await api.sfu<SfuReply>('sessions/new', 'POST', { sessionDescription: { type: 'offer', sdp: p.localDescription!.sdp } });
      session.current = s.sessionId ?? '';
      await p.setRemoteDescription(s.sessionDescription!);
      await new Promise<void>((res, rej) => {
        if (p.iceConnectionState === 'connected') return res();
        const t = window.setTimeout(() => rej(new Error('The call couldn’t connect. Check your connection.')), 12000);
        p.addEventListener('iceconnectionstatechange', () => {
          if (p.iceConnectionState === 'connected' || p.iceConnectionState === 'completed') {
            window.clearTimeout(t);
            res();
          }
        });
      });
      // share my sound and video
      await p.setLocalDescription(await p.createOffer());
      const tracks = sends.map((x) => ({ location: 'local', mid: x.mid, trackName: x.sender.track!.id }));
      const r = await api.sfu<SfuReply>(`sessions/${session.current}/tracks/new`, 'POST', { sessionDescription: { type: 'offer', sdp: p.localDescription!.sdp }, tracks });
      await p.setRemoteDescription(r.sessionDescription!);
      const meP: RoomPerson = {
        id: me.id,
        name: me.name,
        avatar_url: me.avatar_url ?? null,
        session: session.current,
        tracks: sends.map((x) => ({ name: x.sender.track!.id, kind: x.sender.track!.kind as 'audio' | 'video' })),
        muted: false,
        camOff: !video,
      };
      mine.current = meP;
      setCamOff(!video);
      setTiles((ts) => ({ ...ts, [me.id]: { person: meP, stream: m } }));
      roomRef.current?.share(meP);
      setStep('in');
    } catch (e) {
      toast((e as Error).message || 'Couldn’t join the call.');
      leave();
    }
  };
  const update = (patch: Partial<RoomPerson>) => {
    if (!mine.current || !me) return;
    mine.current = { ...mine.current, ...patch };
    roomRef.current?.share(mine.current);
    setTiles((ts) => (ts[me.id] ? { ...ts, [me.id]: { ...ts[me.id], person: mine.current! } } : ts));
  };
  const toggleMute = () => {
    local.current?.getAudioTracks().forEach((t) => (t.enabled = muted));
    update({ muted: !muted });
    setMuted(!muted);
  };
  const toggleCam = () => {
    local.current?.getVideoTracks().forEach((t) => (t.enabled = camOff));
    update({ camOff: !camOff });
    setCamOff(!camOff);
  };

  const list = Object.values(tiles);
  const hasCam = Boolean(local.current?.getVideoTracks().length);
  return (
    <div className="cx-call cx-gc" role="dialog" aria-label={title}>
      <div className="cx-gc-top">
        <b>{title}</b>
        {people.length > 0 && <span>{people.length === 1 ? '1 person in the call' : `${people.length} people in the call`}</span>}
      </div>
      {step === 'in' ? (
        <div className={`cx-gc-grid n${Math.min(list.length, 6)}`}>
          {list.map((t) => (
            <TileView key={t.person.id} t={t} self={t.person.id === me?.id} />
          ))}
        </div>
      ) : (
        <div className="cx-gc-choose">
          <div className="cx-gc-faces">
            {people.slice(0, 5).map((x) => (
              <Avatar key={x.id} p={{ name: x.name, avatar_url: x.avatar_url, handle: '' } as never} size={48} />
            ))}
          </div>
          <p>{people.length ? `${people.map((x) => x.name.split(' ')[0]).slice(0, 3).join(', ')}${people.length > 3 ? ` and ${people.length - 3} more` : ''} ${people.length === 1 ? 'is' : 'are'} in the call` : 'No one is in the call yet'}</p>
          <div className="cx-gc-join">
            <button type="button" className="btn btn-primary" disabled={step === 'joining'} onClick={() => join(false)}>
              {step === 'joining' ? 'Joining…' : 'Join with sound only'}
            </button>
            <button type="button" className="btn btn-light" disabled={step === 'joining'} onClick={() => join(true)}>
              Join with camera
            </button>
          </div>
          <small>Sound only uses much less data.</small>
        </div>
      )}
      <div className="cx-call-btns">
        {step === 'in' && (
          <>
            <button type="button" className={muted ? 'cx-call-btn is-on' : 'cx-call-btn'} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}>
              <Icon name="mic" size={24} />
              {muted && <span className="cx-call-slash" aria-hidden="true" />}
            </button>
            {hasCam && (
              <button type="button" className={camOff ? 'cx-call-btn is-on' : 'cx-call-btn'} onClick={toggleCam} aria-label={camOff ? 'Turn camera on' : 'Turn camera off'} aria-pressed={camOff}>
                <Icon name="cam" size={24} />
                {camOff && <span className="cx-call-slash" aria-hidden="true" />}
              </button>
            )}
          </>
        )}
        {step === 'in' ? (
          <button type="button" className="cx-call-btn is-end" onClick={leave} aria-label="Leave the call">
            <Icon name="phone" size={26} />
          </button>
        ) : (
          <button type="button" className="cx-call-btn" onClick={leave} aria-label="Close">
            <Icon name="close" size={24} />
          </button>
        )}
      </div>
    </div>
  );
}
