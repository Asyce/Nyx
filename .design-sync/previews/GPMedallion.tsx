import * as React from 'react';
import { GPMedallion } from 'nyxarium-site';

// GP_GAMES ships with the bundle (icons embedded) — the same objects the site
// passes to GPMedallion.
const GAMES: any[] = (window as any).GP_GAMES ?? [];
const game = (key: string) => GAMES.find((g) => g.key === key);

const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px', display: 'flex', gap: '18px', alignItems: 'center' }}>
    {children}
  </div>
);

export const Default = () => (
  <Panel>
    <GPMedallion game={game('gi')} on />
  </Panel>
);

export const RailStates = () => (
  <Panel>
    <GPMedallion game={game('gi')} size="sm" on />
    <GPMedallion game={game('hsr')} size="sm" dim />
    <GPMedallion game={game('zzz')} size="sm" dim />
    <GPMedallion game={game('wuwa')} size="sm" dim />
  </Panel>
);
