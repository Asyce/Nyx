import * as React from 'react';
import { GPSwitcher } from 'nyxarium-site';

// Horizontal strip of the other games' medallions (the active one is omitted).
const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px' }}>
    {children}
  </div>
);

export const Default = () => (
  <Panel>
    <GPSwitcher active="gi" />
  </Panel>
);

export const Compact = () => (
  <Panel>
    <GPSwitcher active="gi" size="sm" gap={8} />
  </Panel>
);
