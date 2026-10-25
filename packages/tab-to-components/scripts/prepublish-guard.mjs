// Release guard, run from `prepublishOnly` before the build.
//
// Published artifacts must be traceable to exactly one commit:
//   1. the working tree is clean (no uncommitted changes in tracked files),
//   2. HEAD carries the tag `v<package.json version>`.
//
// Both of those were missing for the 0.4.0 publish: npm recorded `gitHead`
// 533a634, whose package.json still said 0.3.0, and the version-bump commit
// landed after the publish. Set TTC_PUBLISH_ALLOW_UNSAFE=1 only for a
// deliberate emergency publish; never in CI.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
const tag = `v${String(manifest.version ?? "")}`;

function git(args) {
  return execFileSync("git", args, {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(`\ntab-to-components: refusing to publish.\n${message}\n`);
  process.exit(1);
}

if (process.env.TTC_PUBLISH_ALLOW_UNSAFE === "1") {
  console.warn(
    "tab-to-components: TTC_PUBLISH_ALLOW_UNSAFE=1 set, skipping the release guard. " +
      "The published artifact will not be traceable to a commit.",
  );
  process.exit(0);
}

try {
  git(["rev-parse", "--is-inside-work-tree"]);
} catch {
  fail(
    "Not inside a git checkout, so the npm artifact cannot be tied to a commit.\n" +
      "Publish from the repository (CI) or set TTC_PUBLISH_ALLOW_UNSAFE=1 deliberately.",
  );
}

const dirty = git(["status", "--porcelain", "--untracked-files=no"]);
if (dirty !== "") {
  fail(
    `The working tree has uncommitted changes:\n${dirty}\n` +
      "Commit them and tag the release first; a dirty-tree publish records the\n" +
      "previous commit as gitHead and cannot be reproduced from VCS.",
  );
}

const tagsAtHead = git(["tag", "--points-at", "HEAD"])
  .split(/\r?\n/)
  .filter(Boolean);
if (!tagsAtHead.includes(tag)) {
  fail(
    `HEAD is not tagged ${tag} (tags here: ${tagsAtHead.join(", ") || "none"}).\n` +
      `Tag the release commit with \`git tag -a ${tag} -m "${tag}"\` and push the tag; ` +
      "the release workflow publishes on tag pushes.",
  );
}

console.log(`tab-to-components: release guard passed (${tag}).`);
