// Compatibility entry point retained for local callers. The all-game pipeline is
// intentionally one transaction so a failure cannot partly replace last-known-good data.
import { run } from './index.mjs';
await run();
