import * as React from 'react';
import { GPLogoBack } from 'nyxarium-site';

const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px', display: 'flex', gap: '20px', alignItems: 'center' }}>
    {children}
  </div>
);

export const Default = () => (
  <Panel>
    <GPLogoBack />
  </Panel>
);

export const Large = () => (
  <Panel>
    <GPLogoBack size={72} />
  </Panel>
);
