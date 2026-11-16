import React from 'react';
import { ConnectApp } from '@/connect/ConnectApp';

/** Every path (/, /students, /u/ada, /messages/…) is handled by Connect's own router. */
export default function ConnectPage() {
  return <ConnectApp />;
}
