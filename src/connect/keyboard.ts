'use client';
/* The keyboard shrinks the window and the chat fits the space that's left
   (see the keyboard-fit effect in ConnectApp). We tried letting the keyboard
   slide over the page in the installed app, but on Android the space Chrome
   reports for the keyboard didn't match where it's drawn: a white band showed
   and the message box was hidden. So the page always resizes, like in a
   browser tab. */

/** Height the keyboard covers on top of the page: always 0 now (the window shrinks instead) */
export const keyboardOver = () => 0;

export function useKeyboardOverlay() {
  // nothing to do: kept so callers don't change
}
