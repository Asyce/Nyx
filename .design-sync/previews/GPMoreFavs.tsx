import * as React from 'react';
import { GPMoreFavs } from 'nyxarium-site';

// Overflow favourites row — small circular character icons.
const icon = ((window as any).GP_GAMES ?? []).find((g: any) => g.key === 'gi')?.icon;

const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px' }}>
    {children}
  </div>
);

export const Default = () => (
  <Panel>
    <GPMoreFavs icon={icon} />
  </Panel>
);

export const Few = () => (
  <Panel>
    <GPMoreFavs count={4} icon={icon} />
  </Panel>
);
