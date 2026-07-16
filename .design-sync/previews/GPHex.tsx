import * as React from 'react';
import { GPHex } from 'nyxarium-site';

// The components are designed for the site's dark pages — every story sits on
// the canvas color so the hex chrome reads the way it does in production.
const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px', display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
    {children}
  </div>
);

export const Default = () => (
  <Panel>
    <GPHex><span className="dia"></span><span>Character Materials</span></GPHex>
  </Panel>
);

export const Active = () => (
  <Panel>
    <GPHex on><span className="dia"></span><span>Database</span></GPHex>
    <GPHex><span className="dia"></span><span>Wish Tracker</span></GPHex>
  </Panel>
);

export const Small = () => (
  <Panel>
    <GPHex small><span className="dia"></span><span>Timeline</span></GPHex>
    <GPHex small on><span className="dia"></span><span>Library</span></GPHex>
  </Panel>
);

export const Disabled = () => (
  <Panel>
    <GPHex disabled><span className="dia"></span><span>Coming Soon</span></GPHex>
  </Panel>
);
