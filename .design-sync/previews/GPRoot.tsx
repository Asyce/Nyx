import * as React from 'react';
import { GPRoot, GPSec, GPSectionNavButton } from 'nyxarium-site';

// GPRoot is the game-page frame (canvas art, rotating pattern, vignette).
// It fills its nearest positioned ancestor, so previews give it a sized stage.
// Composition mirrors the live page: side nav + main pane with a section header.
export const GamePage = () => (
  <div style={{ position: 'relative', height: '520px' }}>
    <GPRoot>
      <div style={{ display: 'flex', gap: '40px', padding: '48px 56px' }}>
        <nav style={{ width: '220px', flex: 'none' }}>
          <GPSectionNavButton label="Overview" active />
          <GPSectionNavButton label="Characters" />
          <GPSectionNavButton label="Database" />
          <GPSectionNavButton label="Wish Tracker" />
        </nav>
        <div style={{ flex: 1, display: 'grid', gap: '26px', alignContent: 'start' }}>
          <GPSec title="Character Materials" />
          <p style={{ margin: 0, color: 'var(--nyx-color-text-dim)', fontFamily: 'var(--nyx-font-ui)' }}>
            Today's farmable talent books and weapon ascension materials.
          </p>
        </div>
      </div>
    </GPRoot>
  </div>
);
