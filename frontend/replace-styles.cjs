const fs = require('fs');
const cssPath = 'g:/4D-print/frontend/src/index.css';

let css = fs.readFileSync(cssPath, 'utf8');

const radiusMap = {
  '4px': 'var(--radius-sm)',
  '6px': 'var(--radius-sm)',
  '8px': 'var(--radius-sm)',
  '10px': 'var(--radius-md)',
  '12px': 'var(--radius-md)',
  '14px': 'var(--radius-md)',
  '16px': 'var(--radius-lg)',
  '18px': 'var(--radius-lg)',
  '20px': 'var(--radius-xl)',
  '22px': 'var(--radius-xl)',
  '24px': 'var(--radius-2xl)',
  '32px': 'var(--radius-2xl)'
};

const fontMap = {
  '12px': 'var(--text-xs)',
  '0.75rem': 'var(--text-xs)',
  '0.7rem': 'var(--text-xs)',
  '0.72rem': 'var(--text-xs)',
  '0.8rem': 'var(--text-xs)',
  '14px': 'var(--text-sm)',
  '0.85rem': 'var(--text-sm)',
  '0.875rem': 'var(--text-sm)',
  '0.9rem': 'var(--text-sm)',
  '0.95rem': 'var(--text-sm)',
  '16px': 'var(--text-base)',
  '1rem': 'var(--text-base)',
  '18px': 'var(--text-lg)',
  '1.1rem': 'var(--text-lg)',
  '1.15rem': 'var(--text-lg)',
  '20px': 'var(--text-xl)',
  '1.2rem': 'var(--text-xl)',
  '1.25rem': 'var(--text-xl)',
  '24px': 'var(--text-2xl)',
  '1.5rem': 'var(--text-2xl)',
  '30px': 'var(--text-3xl)',
  '32px': 'var(--text-3xl)',
  '1.875rem': 'var(--text-3xl)',
  '2rem': 'var(--text-3xl)'
};

// Replace border-radius
css = css.replace(/border-radius:\s*([a-zA-Z0-9\.]+)(;?)/g, (match, val, semi) => {
  if (radiusMap[val]) {
    return `border-radius: ${radiusMap[val]}${semi}`;
  }
  return match; // keep original if no match (e.g., 50%, var(--radius-full))
});

// Replace font-size
css = css.replace(/font-size:\s*([a-zA-Z0-9\.]+)(;?)/g, (match, val, semi) => {
  if (fontMap[val]) {
    return `font-size: ${fontMap[val]}${semi}`;
  }
  return match;
});

// Special replacement: border-radius: var(--makerworld-card-radius) to var(--radius-xl)
css = css.replace(/var\(--makerworld-card-radius\)/g, 'var(--radius-xl)');

// Fix specific styles in components
// .btn default radius should probably be var(--radius-full) if we want capsule style globally
css = css.replace(/\.btn\s*\{[^}]*\}/g, (match) => {
  return match.replace(/border-radius:[^;]+;/, 'border-radius: var(--radius-full);');
});

// Write it back
fs.writeFileSync(cssPath, css);
console.log('Replaced hardcoded styles with tokens');
