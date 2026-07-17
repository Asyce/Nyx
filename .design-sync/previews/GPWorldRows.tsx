import * as React from 'react';
import { GPWorldRows } from 'nyxarium-site';

// Sidebar world list — medallion + game name for every game except the active one.
export const Default = () => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px', maxWidth: '320px', fontFamily: 'var(--nyx-font-ui)' }}>
    <GPWorldRows active="gi" />
  </div>
);
