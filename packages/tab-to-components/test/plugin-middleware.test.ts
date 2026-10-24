import { fileURLToPath } from "node:url";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CUSTOM_EDITOR_ENDPOINT } from "../src/editor.js";
import { tabToComponents } from "../src/index.js";
import type { EditorTarget } from "../src/types.js";

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url))
  .replace(/\\/g, "/")
  .replace(/\/+$/, "");
const SOURCE_FILE = `${PACKAGE_DIR}/src/index.ts`;
const SOURCE_MARKER = `${SOURCE_FILE}:12:3`;

type AnyFn = (...args: any[]) => any;

interface TestPlugin {
  configResolved?: AnyFn;
  configureServer?: AnyFn;
}

interface FakeLogger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

interface Harness {
  targets: EditorTarget[];
  use: ReturnType<typeof vi.fn>;
  handler: AnyFn;
  logger: FakeLogger;
}

interface CallResult {
  status: number;
  body: string;
  next: boolean;
}

function fakeLogger(): FakeLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function resolvedConfig(logger: FakeLogger, base = "/"): never {
  return {
    root: PACKAGE_DIR,
    base,
    command: "serve",
    logger,
  } as never;
}

function fakeServer(logger: FakeLogger): {
  middlewares: { use: ReturnType<typeof vi.fn> };
  config: { logger: FakeLogger; root: string };
} {
  return {
    middlewares: { use: vi.fn() },
    config: { logger, root: PACKAGE_DIR },
  };
}

function createHarness(
  options: Parameters<typeof tabToComponents>[0] = {},
  resolved: { base?: string } = {},
): Harness {
  const targets: EditorTarget[] = [];
  const logger = fakeLogger();
  const plugin = tabToComponents({
    log: false,
    ...options,
    editor:
      options.editor ??
      ((target) => {
        targets.push(target);
      }),
  }) as unknown as TestPlugin;
  plugin.configResolved?.(resolvedConfig(logger, resolved.base));
  const server = fakeServer(logger);
  plugin.configureServer?.(server as never);
  const use = server.middlewares.use;
  const handler = use.mock.calls[0]?.[0] as AnyFn | undefined;
  if (!handler) throw new Error("editor middleware was not registered");
  return { targets, use, handler, logger };
}

function configureForLog(
  options: Parameters<typeof tabToComponents>[0] = {},
): { logger: FakeLogger; use: ReturnType<typeof vi.fn> } {
  const logger = fakeLogger();
  const plugin = tabToComponents(options) as unknown as TestPlugin;
  plugin.configResolved?.(resolvedConfig(logger));
  const server = fakeServer(logger);
  plugin.configureServer?.(server as never);
  return { logger, use: server.middlewares.use };
}

async function invoke(
  handler: AnyFn,
  url: string,
  method = "GET",
): Promise<CallResult> {
  const result: CallResult = { status: 0, body: "", next: false };
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`middleware did not finish for ${url}`)),
      3_000,
    );
  });

  const response = {
    statusCode: 200,
    body: "",
    writableEnded: false,
    end(chunk?: unknown) {
      if (chunk !== undefined) response.body += String(chunk);
      response.writableEnded = true;
      finish();
    },
  };

  handler.call(
    {},
    { method, url, headers: {} },
    response,
    () => {
      result.next = true;
      finish();
    },
  );

  try {
    await Promise.race([done, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  result.status = response.statusCode;
  result.body = response.body;
  return result;
}

function editorUrl(file: string, path = `/${CUSTOM_EDITOR_ENDPOINT}`): string {
  return `${path}?file=${encodeURIComponent(file)}`;
}

let previousLaunchEditor: string | undefined;

beforeEach(() => {
  previousLaunchEditor = process.env.LAUNCH_EDITOR;
  delete process.env.LAUNCH_EDITOR;
});

afterEach(() => {
  if (previousLaunchEditor === undefined) delete process.env.LAUNCH_EDITOR;
  else process.env.LAUNCH_EDITOR = previousLaunchEditor;
});

describe("dev server banner", () => {
  it("logs the keyboard and the dev-only hint for the default editor", () => {
    const { logger, use } = configureForLog();

    expect(use).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(String(logger.info.mock.calls[0]?.[0])).toContain("ALT");
    expect(String(logger.info.mock.calls[0]?.[0])).toContain("dev only");
    expect(String(logger.info.mock.calls[1]?.[0])).toContain("editor: code (default)");
  });

  it("honours a custom keyboard and an explicit editor", () => {
    const { logger } = configureForLog({
      keyboard: ["ctrl", "shift"],
      editor: "cursor",
    });

    expect(String(logger.info.mock.calls[0]?.[0])).toContain("CTRL+SHIFT");
    expect(String(logger.info.mock.calls[1]?.[0])).toContain("editor: cursor");
    expect(String(logger.info.mock.calls[1]?.[0])).not.toContain("(default)");
  });

  it("describes editor: 'auto' as Vite detection and registers no endpoint", () => {
    const { logger, use } = configureForLog({ editor: "auto" });

    expect(use).not.toHaveBeenCalled();
    expect(String(logger.info.mock.calls[1]?.[0])).toContain(
      "editor: auto (Vite / launch-editor detection)",
    );
  });

  it("stays quiet with log: false but still registers the endpoint", () => {
    const { logger, use } = configureForLog({ log: false });

    expect(logger.info).not.toHaveBeenCalled();
    expect(use).toHaveBeenCalledTimes(1);
  });

  it("explains that LAUNCH_EDITOR needs editor: 'auto'", () => {
    process.env.LAUNCH_EDITOR = "cursor";
    const { logger } = configureForLog();

    expect(logger.info).toHaveBeenCalledTimes(3);
    expect(String(logger.info.mock.calls[2]?.[0])).toContain("LAUNCH_EDITOR");
    expect(String(logger.info.mock.calls[2]?.[0])).toContain('editor: "auto"');
  });
});

describe("custom editor endpoint", () => {
  it("passes unrelated requests to the next middleware", async () => {
    const { handler } = createHarness();

    const result = await invoke(handler, "/src/App.tsx");

    expect(result.next).toBe(true);
    expect(result.status).toBe(200);
  });

  it("ignores request urls that are not absolute", async () => {
    const { handler } = createHarness();

    const result = await invoke(handler, "relative/path?file=x");

    expect(result.next).toBe(true);
  });

  it("does not intercept lookalike endpoint paths", async () => {
    const { handler } = createHarness();

    const result = await invoke(
      handler,
      editorUrl(SOURCE_MARKER, `/${CUSTOM_EDITOR_ENDPOINT}-extra`),
    );

    expect(result.next).toBe(true);
  });

  it("parses an absolute target from a GET request and launches the editor", async () => {
    const { handler, targets } = createHarness();

    const result = await invoke(handler, editorUrl(SOURCE_MARKER));

    expect(result.next).toBe(false);
    expect(result.status).toBe(200);
    expect(targets).toEqual([{ file: SOURCE_FILE, line: 12, column: 3 }]);
  });

  it("accepts POST requests too", async () => {
    const { handler, targets } = createHarness();

    const result = await invoke(handler, editorUrl(SOURCE_MARKER), "POST");

    expect(result.status).toBe(200);
    expect(targets).toHaveLength(1);
  });

  it("resolves project-relative targets against the Vite root", async () => {
    const { handler, targets } = createHarness();

    const result = await invoke(handler, editorUrl("src/index.ts:1:1"));

    expect(result.status).toBe(200);
    expect(targets[0]).toEqual({
      file: `${PACKAGE_DIR}/src/index.ts`,
      line: 1,
      column: 1,
    });
  });

  it("accepts extra query parameters around `file`", async () => {
    const { handler, targets } = createHarness();

    const result = await invoke(
      handler,
      `/${CUSTOM_EDITOR_ENDPOINT}?cache=0&file=${encodeURIComponent(SOURCE_MARKER)}&other=1`,
    );

    expect(result.status).toBe(200);
    expect(targets).toHaveLength(1);
  });

  it("rejects unsupported methods", async () => {
    const { handler, targets } = createHarness();

    for (const method of ["PUT", "DELETE", "PATCH", "HEAD"]) {
      const result = await invoke(handler, editorUrl(SOURCE_MARKER), method);
      expect(result.status, method).toBe(405);
      expect(result.body).toContain("method not allowed");
    }
    expect(targets).toHaveLength(0);
  });

  it("rejects requests without a file parameter", async () => {
    const { handler } = createHarness();

    const result = await invoke(handler, `/${CUSTOM_EDITOR_ENDPOINT}`);

    expect(result.status).toBe(400);
    expect(result.body).toContain("invalid `file` parameter");
  });

  it("rejects files outside the project root", async () => {
    const { handler } = createHarness();

    const result = await invoke(handler, editorUrl("D:/outside/file.tsx:1:1"));

    expect(result.status).toBe(400);
  });

  it("rejects traversal that escapes the project root", async () => {
    const { handler } = createHarness();

    const result = await invoke(handler, editorUrl("../../outside.tsx:1:1"));

    expect(result.status).toBe(400);
  });

  it("rejects targets that do not exist", async () => {
    const { handler } = createHarness();

    const result = await invoke(
      handler,
      editorUrl(`${PACKAGE_DIR}/src/does-not-exist.ts:1:1`),
    );

    expect(result.status).toBe(400);
  });

  it("rejects directories", async () => {
    const { handler } = createHarness();

    const result = await invoke(handler, editorUrl(`${PACKAGE_DIR}/src:1:1`));

    expect(result.status).toBe(400);
  });

  it("rejects missing and invalid positions", async () => {
    const { handler } = createHarness();

    for (const file of [
      SOURCE_FILE,
      `${SOURCE_FILE}:0:1`,
      `${SOURCE_FILE}:1:0`,
      `${SOURCE_FILE}:x:1`,
      `${SOURCE_FILE}:1:x`,
    ]) {
      const result = await invoke(handler, editorUrl(file));
      expect(result.status, file).toBe(400);
    }
  });

  it("strips the Vite base before matching the endpoint", async () => {
    const { handler, targets } = createHarness({}, { base: "/app/" });

    const result = await invoke(
      handler,
      editorUrl(SOURCE_MARKER, `/app/${CUSTOM_EDITOR_ENDPOINT}`),
    );

    expect(result.status).toBe(200);
    expect(targets).toHaveLength(1);
  });

  it("matches a custom editorEndpoint under the Vite base only", async () => {
    const { handler, targets } = createHarness(
      { editorEndpoint: "/custom-open" },
      { base: "/app/" },
    );

    const matched = await invoke(
      handler,
      editorUrl(SOURCE_MARKER, "/app/custom-open"),
    );
    expect(matched.status).toBe(200);

    const defaultPath = await invoke(handler, editorUrl(SOURCE_MARKER));
    expect(defaultPath.next).toBe(true);
    expect(targets).toHaveLength(1);
  });

  it("reports launcher failures through the terminal but still acknowledges the request", async () => {
    const { handler, logger } = createHarness({
      editor: () => {
        throw new Error("editor exploded");
      },
    });

    const result = await invoke(handler, editorUrl(SOURCE_MARKER));

    expect(result.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0]?.[0] ?? "")).toContain(
      "editor exploded",
    );
  });

  it("awaits asynchronous custom launchers before responding", async () => {
    let resolvedLauncher = false;
    const { handler } = createHarness({
      editor: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        resolvedLauncher = true;
      },
    });

    const result = await invoke(handler, editorUrl(SOURCE_MARKER));

    expect(result.status).toBe(200);
    expect(resolvedLauncher).toBe(true);
  });
});
