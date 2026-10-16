// Which kind of build this is. `vite build --mode release` (npm run
// build:release) makes the build players get: no debug overlay, no URL
// switches for jumping to areas or scenes, no benchmark and no script hooks.
// Development and the playtest build keep them for testing.
declare const __RELEASE__: boolean | undefined;

export const RELEASE = typeof __RELEASE__ === 'boolean' && __RELEASE__;
