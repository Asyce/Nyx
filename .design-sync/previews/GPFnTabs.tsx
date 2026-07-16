import * as React from 'react';
import { GPFnTabs } from 'nyxarium-site';

const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px' }}>
    {children}
  </div>
);

export const Default = () => (
  <Panel>
    <GPFnTabs />
  </Panel>
);

export const Small = () => (
  <Panel>
    <GPFnTabs small />
  </Panel>
);
