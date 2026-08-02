// Generates src/styles/tokens.css from design/tokens.json — the single
// parity source for colours, type scale, radii, and motion durations shared
// with the native apps. Do not hand-edit tokens.css; edit tokens.json and
// re-run `npm run tokens`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tokens = JSON.parse(readFileSync(path.join(root, 'design/tokens.json'), 'utf8'));

const COLOR_VAR_NAMES = {
  bg: '--bg',
  bgPanel: '--bg-panel',
  border: '--border',
  text: '--text',
  textDim: '--text-dim',
  accent: '--accent',
  allClear: '--all-clear',
  something: '--something',
  smells: '--smells',
  tastes: '--tastes',
  smokeshow: '--smokeshow',
};

function colorDecls(palette, keys, indent = '  ') {
  return keys.map((key) => `${indent}${COLOR_VAR_NAMES[key]}: ${palette[key]};`).join('\n');
}

// Dark is the app default (`color-scheme: dark`); light only overrides the
// values that actually change between themes — accent and the rating-scale
// colors are theme-invariant, same as the hand-written tokens.css this
// replaces.
const darkKeys = Object.keys(COLOR_VAR_NAMES);
const lightKeys = darkKeys.filter((key) => tokens.color.light[key] !== tokens.color.dark[key]);

const typeScaleDecls = Object.entries(tokens.typeScale)
  .map(([name, value]) => `  --font-size-${name}: ${value};`)
  .join('\n');

const radiusDecls = Object.entries(tokens.radius)
  .map(([name, value]) => `  --radius-${name}: ${value};`)
  .join('\n');

const motionDecls = Object.entries(tokens.motion)
  .flatMap(([name, { duration, easing }]) => [
    `  --duration-${name}: ${duration};`,
    `  --easing-${name}: ${easing};`,
  ])
  .join('\n');

const css = `:root {
  color-scheme: dark;
${colorDecls(tokens.color.dark, darkKeys)}

${typeScaleDecls}

${radiusDecls}

${motionDecls}
}

@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
${colorDecls(tokens.color.light, lightKeys, '    ')}
  }
}
`;

writeFileSync(path.join(root, 'src/styles/tokens.css'), css);
console.log('wrote src/styles/tokens.css from design/tokens.json');
