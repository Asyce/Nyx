import * as React from 'react';
import { GPFav } from 'nyxarium-site';
import { SKIRK_ART } from '../ds-assets.mjs';

// Pinned-favourite character card — always pass `art` (the default art path
// only exists on the live site).
const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px', display: 'flex', gap: '22px', alignItems: 'flex-start' }}>
    {children}
  </div>
);

export const Portrait = () => (
  <Panel>
    <GPFav w={210} h={270} name="Skirk" art={SKIRK_ART} />
  </Panel>
);

export const Landscape = () => (
  <Panel>
    <GPFav w={340} h={200} land name="Skirk" art={SKIRK_ART} pos="center 22%" />
  </Panel>
);
