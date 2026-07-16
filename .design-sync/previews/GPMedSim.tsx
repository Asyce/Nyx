import * as React from 'react';
import { GPMedSim } from 'nyxarium-site';

// The Nyx living eye — pure CSS art (gaze follows the mouse on the site).
const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px', display: 'flex', gap: '20px', alignItems: 'center' }}>
    {children}
  </div>
);

export const Active = () => (
  <Panel>
    <GPMedSim on />
  </Panel>
);

export const Idle = () => (
  <Panel>
    <GPMedSim />
  </Panel>
);
