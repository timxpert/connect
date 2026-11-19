/* Small interface sounds, made with the Web Audio API (no audio files to
   download). Short and quiet on purpose. People can turn them off in the
   account menu; the choice is remembered per browser. */

type Sound = 'like' | 'comment' | 'post' | 'send' | 'message' | 'incoming';

const KEY = 'cx-sound';
let ctx: AudioContext | null = null;

export function soundOn() {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** One soft note with a quick attack and exponential fade */
function note(a: AudioContext, freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, glideTo?: number) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(a.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

export function play(s: Sound) {
  if (typeof window === 'undefined' || !soundOn()) return;
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.005;
  switch (s) {
    case 'like': // bright two-step pop
      note(a, 620, t, 0.09, 'sine', 0.14, 900);
      note(a, 1240, t + 0.06, 0.12, 'sine', 0.08);
      break;
    case 'comment': // soft blip
      note(a, 880, t, 0.1, 'triangle', 0.1, 1180);
      break;
    case 'message': // new message somewhere else in the app: clear two-note ding
      note(a, 784, t, 0.16, 'sine', 0.28);
      note(a, 1175, t + 0.11, 0.26, 'sine', 0.24);
      break;
    case 'incoming': // new message in the chat you're reading: soft pop
      note(a, 660, t, 0.08, 'sine', 0.16, 990);
      break;
    case 'send': // short tick for messages
      note(a, 1046, t, 0.07, 'triangle', 0.08);
      break;
    case 'post': // rising three-note chime
      note(a, 523.25, t, 0.22, 'sine', 0.11);
      note(a, 659.25, t + 0.08, 0.24, 'sine', 0.1);
      note(a, 987.77, t + 0.16, 0.38, 'sine', 0.09);
      break;
  }
  // A tiny buzz on phones that support it
  try {
    navigator.vibrate?.(s === 'post' ? [12, 40, 12] : 10);
  } catch {
    /* ignore */
  }
}
