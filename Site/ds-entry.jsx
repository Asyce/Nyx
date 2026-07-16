// design-sync entry shim.
// The site's own build (Site/tools/build-site.mjs) concatenates sources and the
// components file publishes itself onto `window` instead of using ES exports.
// This shim imports that file for its side effect and re-exports the components
// so the design-sync converter can bundle them like a normal package entry.
import React from 'react';
import './src/components/game-page-components.jsx';
import { GP_ICONS, NYX_LOGO } from '../.design-sync/ds-assets.mjs';

// The components reference `React` as a global at render time (the site build
// provides it the same way); make sure it exists in the preview environment.
if (typeof window !== 'undefined') {
  if (!window.React) window.React = React;
  // The game icons live at site-relative paths ('../assets/icon/…') that only
  // exist on pengo.gg — swap in embedded 96px copies of the same art.
  if (Array.isArray(window.GP_GAMES)) {
    for (const g of window.GP_GAMES) if (GP_ICONS[g.key]) g.icon = GP_ICONS[g.key];
  }
  // GPLogoBack hardcodes its <img src> — replace the image via CSS `content`.
  if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = `.gp-logo-btn img{content:url("${NYX_LOGO}")}`;
    document.head.appendChild(style);
    // The site's bootstrap adds this class when the app has mounted; without
    // it .gp stays invisible for 5s (the reveal animation fallback). This
    // bundle IS the app here, so mark ready immediately.
    document.documentElement.classList.add('nyx-app-ready');
  }
}

export const GPRoot = window.GPRoot;
export const GPSec = window.GPSec;
export const GPHex = window.GPHex;
export const GPBack = window.GPBack;
export const GPLogoBack = window.GPLogoBack;
export const GPMedallion = window.GPMedallion;
export const GPMedSim = window.GPMedSim;
export const GPSwitcher = window.GPSwitcher;
export const GPGameRail = window.GPGameRail;
export const GPWorldRows = window.GPWorldRows;
export const GPFnRows = window.GPFnRows;
export const GPFnTabs = window.GPFnTabs;
export const GPFav = window.GPFav;
export const GPMoreFavs = window.GPMoreFavs;
export const GPCodes = window.GPCodes;
