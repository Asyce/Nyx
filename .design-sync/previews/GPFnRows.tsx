import * as React from 'react';
import { GPFnRows } from 'nyxarium-site';

// Sidebar function list (Character Materials / Database / Wish Tracker).
export const Default = () => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px', maxWidth: '320px', fontFamily: 'var(--nyx-font-ui)' }}>
    <GPFnRows />
  </div>
);
