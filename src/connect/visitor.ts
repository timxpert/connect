/* Remembers that someone chose "No, I'm not a member" so the welcome
   question isn't asked on every visit. Per browser only. */
const KEY = 'cx-visitor';
const EVENT = 'cx:visitor';

export function isVisitor() {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setVisitor(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, '1');
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private mode: the choice lasts for this page view */
  }
  (window as unknown as { __cxVisitor?: boolean }).__cxVisitor = on;
  window.dispatchEvent(new Event(EVENT));
}

export function onVisitorChange(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** Also true when storage is blocked but the choice was made on this page */
export const visitorChosen = () => isVisitor() || Boolean((window as unknown as { __cxVisitor?: boolean }).__cxVisitor);
