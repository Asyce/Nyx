import * as React from 'react';
import { GPSec } from 'nyxarium-site';

const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px', display: 'grid', gap: '22px' }}>
    {children}
  </div>
);

export const Default = () => (
  <Panel>
    <GPSec title="Character Materials" />
  </Panel>
);

export const Stacked = () => (
  <Panel>
    <GPSec title="Today's Farmable" />
    <GPSec title="Redemption Codes" />
    <GPSec title="Pinned Favourites" />
  </Panel>
);

export const LongTitle = () => (
  <Panel>
    <GPSec title="Weekly Boss Materials and Talent Books" />
  </Panel>
);
