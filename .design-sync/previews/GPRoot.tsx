import * as React from 'react';
import { GPRoot, GPSec, GPHex } from 'nyxarium-site';

// GPRoot is the full game-page frame (canvas art, rotating pattern, vignette).
// It fills its nearest positioned ancestor, so previews give it a sized stage.
export const GamePage = () => (
  <div style={{ position: 'relative', height: '520px' }}>
    <GPRoot>
      <div style={{ padding: '48px 56px', display: 'grid', gap: '26px' }}>
        <GPSec title="Character Materials" />
        <div style={{ display: 'flex', gap: '14px' }}>
          <GPHex on><span className="dia"></span><span>Character Materials</span></GPHex>
          <GPHex><span className="dia"></span><span>Database</span></GPHex>
          <GPHex><span className="dia"></span><span>Wish Tracker</span></GPHex>
        </div>
      </div>
    </GPRoot>
  </div>
);
