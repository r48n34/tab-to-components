// Stand-in "editor" for end-to-end runs. It is only useful on a machine where
// spawning the editor from the dev server is not sandboxed: set
//
//   LAUNCH_EDITOR="<node> <abs path to this file>"
//   TTC_EDITOR_LOG=<abs path to a log file>
//
// and every "open in editor" call appends the location it was asked to open
// (`<absolute file>:<line>:<column>` when the caller passes it that way) to the
// log. The e2e harness asserts on the browser-side `/__open-in-editor` request
// instead, because this repository's Windows sandbox blocks Vite's
// launch-editor spawn; this file remains here so the observable editor hop can
// be exercised on a normal machine.
import fs from "node:fs";
import path from "node:path";

const logFile = process.env.TTC_EDITOR_LOG;
const target = process.argv[2] ?? "";

if (logFile) {
  fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });
  fs.appendFileSync(logFile, `${target}\n`, "utf8");
}

console.log(`[fake-editor] open ${target}`);
