/* Live updates often come in bursts (ten people open the group, a reaction
   lands while a message is sent). Reloading for each one made chats slow.
   coalesce() folds a burst into one run, and never runs two at once: a call
   while one is running just asks for one more run when it finishes. */

export function coalesce(fn: () => Promise<unknown> | unknown, wait = 300) {
  let timer = 0;
  let running = false;
  let again = false;
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await fn();
    } catch {
      /* the next update or the slow check tries again */
    } finally {
      running = false;
      if (again) {
        again = false;
        kick();
      }
    }
  };
  const kick = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, wait);
  };
  const stop = () => {
    stopped = true;
    window.clearTimeout(timer);
  };
  return Object.assign(kick, { stop });
}
