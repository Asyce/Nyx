import * as React from 'react';
import { GPSectionNavButton } from 'nyxarium-site';

// The live sidebar tools nav — exactly the section list pengo.gg renders.
const Panel = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ background: 'var(--nyx-color-canvas, #0b0817)', padding: '28px', maxWidth: '280px', fontFamily: 'var(--nyx-font-ui)' }}>
    {children}
  </div>
);

export const SideNav = () => (
  <Panel>
    <GPSectionNavButton label="Overview" active />
    <GPSectionNavButton label="Characters" />
    <GPSectionNavButton label="Database" />
    <GPSectionNavButton label="Wish Tracker" />
    <GPSectionNavButton label="Achievements" />
    <GPSectionNavButton label="Library" />
    <GPSectionNavButton label="Settings" />
  </Panel>
);

export const Single = () => (
  <Panel>
    <GPSectionNavButton label="Database" active />
  </Panel>
);

export const PlainNoArrow = () => (
  <Panel>
    <GPSectionNavButton label="Back to Overview" diamond={false} arrow={false} />
  </Panel>
);
