import * as React from 'react';
import { GPGameRail } from 'nyxarium-site';

// Vertical game rail: the Nyx eye on top, then every game medallion; the
// active game is highlighted in place.
const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '24px', display: 'inline-block' }}>
    {children}
  </div>
);

export const GenshinActive = () => (
  <Panel>
    <GPGameRail active="gi" />
  </Panel>
);

export const NyxActive = () => (
  <Panel>
    <GPGameRail active="nyx" />
  </Panel>
);
