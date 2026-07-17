// design-sync entry shim.
// The site's own build (Site/tools/build-site.mjs) concatenates sources and the
// components file publishes itself onto `window` instead of using ES exports.
// This shim imports that file for its side effect and re-exports the components
// so the design-sync converter can bundle them like a normal package entry.
// Only components the live pages actually render are exported (the rest of the
// file is the old "Genshin placeholder" set — see .design-sync/NOTES.md).
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
  if (typeof document !== 'undefined') {
    // The site's bootstrap adds this class when the app has mounted; without
    // it .gp (GPRoot) is invisible for 5s (the reveal-animation fallback).
    document.documentElement.classList.add('nyx-app-ready');
    // Keep the nyx logo reachable for compositions that need it.
    const style = document.createElement('style');
    style.textContent = `.gp-logo-btn img{content:url("${NYX_LOGO}")}`;
    document.head.appendChild(style);
  }
}

export const GPRoot = window.GPRoot;
export const GPSec = window.GPSec;
export const GPSectionNavButton = window.GPSectionNavButton;
export const GPMedallion = window.GPMedallion;
export const GPMedSim = window.GPMedSim;
export const GPGameRail = window.GPGameRail;
