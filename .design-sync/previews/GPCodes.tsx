import * as React from 'react';
import { GPCodes } from 'nyxarium-site';

const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px', maxWidth: '560px' }}>
    {children}
  </div>
);

// GPCodes renders the current redemption-code list (code + reward + copy
// button); the list itself ships with the component.
export const Default = () => (
  <Panel>
    <GPCodes />
  </Panel>
);

export const Spacious = () => (
  <Panel>
    <GPCodes gap={18} />
  </Panel>
);
