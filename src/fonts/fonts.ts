// The game's two typefaces ship inside the build instead of loading from a
// font service: it runs offline, in a desktop build, and inside a page whose
// security rules block outside fonts. Each face is split into a basic Latin
// file and an extended one (accented letters such as ā, š, ő), and the browser
// reads the extended file only for text that needs it. Both are under the SIL
// Open Font License (see OFL.txt).
import cinzel600 from './cinzel-latin-600-normal.woff2?inline';
import cinzel600x from './cinzel-latin-ext-600-normal.woff2?inline';
import cinzel700 from './cinzel-latin-700-normal.woff2?inline';
import cinzel700x from './cinzel-latin-ext-700-normal.woff2?inline';
import garamond400 from './eb-garamond-latin-400-normal.woff2?inline';
import garamond400x from './eb-garamond-latin-ext-400-normal.woff2?inline';
import garamond400i from './eb-garamond-latin-400-italic.woff2?inline';
import garamond400ix from './eb-garamond-latin-ext-400-italic.woff2?inline';
import garamond500 from './eb-garamond-latin-500-normal.woff2?inline';
import garamond500x from './eb-garamond-latin-ext-500-normal.woff2?inline';
import garamond600 from './eb-garamond-latin-600-normal.woff2?inline';
import garamond600x from './eb-garamond-latin-ext-600-normal.woff2?inline';

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const FACES: [family: string, weight: number, style: string, latin: string, ext: string][] = [
  ['Cinzel', 600, 'normal', cinzel600, cinzel600x],
  ['Cinzel', 700, 'normal', cinzel700, cinzel700x],
  ['EB Garamond', 400, 'normal', garamond400, garamond400x],
  ['EB Garamond', 400, 'italic', garamond400i, garamond400ix],
  ['EB Garamond', 500, 'normal', garamond500, garamond500x],
  ['EB Garamond', 600, 'normal', garamond600, garamond600x],
];

const css = FACES.flatMap(([family, weight, style, latin, ext]) =>
  [
    [latin, LATIN],
    [ext, LATIN_EXT],
  ].map(([src, range]) => `@font-face { font-family: '${family}'; font-style: ${style}; font-weight: ${weight}; font-display: swap; src: url(${src}) format('woff2'); unicode-range: ${range}; }`),
).join('\n');

const style = document.createElement('style');
style.textContent = css;
document.head.prepend(style);
