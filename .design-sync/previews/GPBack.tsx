import * as React from 'react';
import { GPBack } from 'nyxarium-site';

const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px', display: 'flex', gap: '14px', alignItems: 'center' }}>
    {children}
  </div>
);

export const Default = () => (
  <Panel>
    <GPBack />
  </Panel>
);

export const Small = () => (
  <Panel>
    <GPBack small />
  </Panel>
);
