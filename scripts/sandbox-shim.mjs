// Development-only shim for the locked-down Windows sandbox this repo was built
// in. It is never published and is not imported by the plugin itself, and it
// switches itself off everywhere the problem does not exist.
//
// The sandbox denies `child_process.spawn` with EPERM. Vite probes Windows
// network drives by shelling out to `net use` the first time it needs a safe
// realpath; the synchronous EPERM aborts config loading. Vite already has a
// fallback for that probe (it catches an EISDIR error and switches to the plain
// `fs.realpathSync`), so we make the single probe call produce it.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";

/** Can this process start a child process whose stdio is piped? */
function spawnIsBlocked() {
  try {
    // Deliberately piped: `stdio: "ignore"` spawns do work in this sandbox, but
    // anything that captures output (ans probably Vite's `net use` probe) fails.
    const result = cp.spawnSync(process.execPath, ["-e", "0"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.error) {
      const code = String(result.error.code ?? "");
      return code === "EPERM" || code === "EACCES";
    }
    return false;
  } catch (error) {
    const code = String(error?.code ?? "");
    return code === "EPERM" || code === "EACCES";
  }
}

const isWindows = process.platform === "win32";
const sandboxed = isWindows && spawnIsBlocked();

globalThis.__DSH_SANDBOX_SHIM__ = { active: sandboxed };

if (sandboxed) {
  const cwd = path.resolve(process.cwd());
  const nativeRealpath = fs.realpathSync.native?.bind(fs.realpathSync);

  if (nativeRealpath) {
    fs.realpathSync.native = function realpathSyncNativeShim(target, ...rest) {
      let isProbe = false;
      try {
        isProbe = path.resolve(String(target)) === cwd;
      } catch {
        isProbe = false;
      }
      if (isProbe) {
        const error = new Error(
          "EISDIR: illegal operation on a directory, realpath (sandbox shim)",
        );
        error.code = "EISDIR";
        throw error;
      }
      return nativeRealpath(target, ...rest);
    };
  }

  const inertChild = {
    on() {
      return this;
    },
    once() {
      return this;
    },
    unref() {
      return this;
    },
    kill() {
      return true;
    },
    stdout: null,
    stderr: null,
    stdin: null,
    pid: -1,
  };

  function rejectSpawn(command, options, callback) {
    const done = typeof options === "function" ? options : callback;
    if (typeof done === "function") {
      process.nextTick(() => {
        done(
          new Error(
            `[sandbox-shim] child process spawn is blocked in this environment: ${String(command)}`,
          ),
          "",
          "",
        );
      });
    }
    return inertChild;
  }

  cp.exec = rejectSpawn;
  cp.execFile = rejectSpawn;
}
