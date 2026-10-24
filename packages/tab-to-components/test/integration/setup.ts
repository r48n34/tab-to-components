// Vitest worker threads do not inherit `--import` loader hooks, so the sandbox
// shim has to be pulled in from a setup file. On a normal machine the shim is
// a no-op for everything except Vite's Windows `net use` probe.
import "../../../../scripts/sandbox-shim.mjs";
