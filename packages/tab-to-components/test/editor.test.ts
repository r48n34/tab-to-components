import { describe, expect, it } from "vitest";
import {
  editorNameOf,
  parseEditorTarget,
  presetEditorArgs,
  resolveEditorInvocation,
  splitCommandLine,
  createEditorLauncher,
} from "../src/editor.js";
import type { EditorTarget } from "../src/types.js";

const TARGET: EditorTarget = {
  file: "D:/app/src/App.tsx",
  line: 12,
  column: 7,
};

describe("splitCommandLine", () => {
  it("splits plain commands", () => {
    expect(splitCommandLine("code --wait")).toEqual(["code", "--wait"]);
  });

  it("keeps double-quoted segments together", () => {
    expect(
      splitCommandLine('"C:\\Program Files\\My IDE\\ide.exe" --goto {file}'),
    ).toEqual(["C:\\Program Files\\My IDE\\ide.exe", "--goto", "{file}"]);
  });

  it("keeps single-quoted segments together", () => {
    expect(splitCommandLine("'my ide' --line {line}")).toEqual([
      "my ide",
      "--line",
      "{line}",
    ]);
  });

  it("collapses whitespace and ignores empty input", () => {
    expect(splitCommandLine("  code   --reuse-window ")).toEqual([
      "code",
      "--reuse-window",
    ]);
    expect(splitCommandLine("   ")).toEqual([]);
  });
});

describe("editorNameOf", () => {
  it("normalises executables and shims", () => {
    expect(editorNameOf("code")).toBe("code");
    expect(editorNameOf("code.cmd")).toBe("code");
    expect(editorNameOf("C:\\Program Files\\Microsoft VS Code\\Code.exe")).toBe(
      "code",
    );
    expect(editorNameOf("CURSOR")).toBe("cursor");
  });
});

describe("presetEditorArgs", () => {
  it("uses --goto for VS Code, Cursor, Trae and other VS Code family editors", () => {
    for (const editor of ["code", "code-insiders", "cursor", "trae", "codium"]) {
      expect(presetEditorArgs(editor, TARGET), editor).toEqual([
        "-r",
        "-g",
        "D:/app/src/App.tsx:12:7",
      ]);
    }
  });

  it("uses line/column flags for JetBrains editors", () => {
    expect(presetEditorArgs("webstorm", TARGET)).toEqual([
      "--line",
      "12",
      "--column",
      "7",
      "D:/app/src/App.tsx",
    ]);
    expect(presetEditorArgs("idea", TARGET)).toEqual([
      "--line",
      "12",
      "--column",
      "7",
      "D:/app/src/App.tsx",
    ]);
  });

  it("uses file:line:column for colon-style editors", () => {
    for (const editor of ["zed", "subl", "atom", "charm"]) {
      expect(presetEditorArgs(editor, TARGET), editor).toEqual([
        "D:/app/src/App.tsx:12:7",
      ]);
    }
  });

  it("uses editor-specific position flags for vim, emacs and notepad++", () => {
    expect(presetEditorArgs("vim", TARGET)).toEqual([
      "+call cursor(12, 7)",
      "D:/app/src/App.tsx",
    ]);
    expect(presetEditorArgs("emacs", TARGET)).toEqual([
      "+12:7",
      "D:/app/src/App.tsx",
    ]);
    expect(presetEditorArgs("notepad++", TARGET)).toEqual([
      "-n12",
      "-c7",
      "D:/app/src/App.tsx",
    ]);
  });

  it("returns undefined for unknown editors", () => {
    expect(presetEditorArgs("pi", TARGET)).toBeUndefined();
    expect(presetEditorArgs("my-ide", TARGET)).toBeUndefined();
  });
});

describe("resolveEditorInvocation", () => {
  it("resolves preset names", () => {
    expect(resolveEditorInvocation("cursor", TARGET)).toEqual({
      command: "cursor",
      args: ["-r", "-g", "D:/app/src/App.tsx:12:7"],
    });
  });

  it("treats an unknown bare command generically", () => {
    expect(resolveEditorInvocation("pi", TARGET)).toEqual({
      command: "pi",
      args: ["D:/app/src/App.tsx:12:7"],
    });
  });

  it("expands command templates", () => {
    expect(
      resolveEditorInvocation("my-ide --goto {file}:{line}:{column}", TARGET),
    ).toEqual({
      command: "my-ide",
      args: ["--goto", "D:/app/src/App.tsx:12:7"],
    });
  });

  it("appends the target when a template has no placeholders", () => {
    expect(resolveEditorInvocation("my-ide --reuse", TARGET)).toEqual({
      command: "my-ide",
      args: ["--reuse", "D:/app/src/App.tsx:12:7"],
    });
  });

  it("expands the object form", () => {
    expect(
      resolveEditorInvocation(
        { command: "my-ide", args: ["--line", "{line}", "--column", "{column}", "{file}"] },
        TARGET,
      ),
    ).toEqual({
      command: "my-ide",
      args: ["--line", "12", "--column", "7", "D:/app/src/App.tsx"],
    });
  });

  it("appends the target to object args without placeholders", () => {
    expect(
      resolveEditorInvocation({ command: "my-ide", args: ["--goto"] }, TARGET),
    ).toEqual({
      command: "my-ide",
      args: ["--goto", "D:/app/src/App.tsx:12:7"],
    });
  });

  it("expands placeholders in the command itself", () => {
    expect(
      resolveEditorInvocation({ command: "{file}" }, TARGET),
    ).toEqual({
      command: "D:/app/src/App.tsx",
      args: ["D:/app/src/App.tsx:12:7"],
    });
  });

  it("rejects empty editor strings and empty commands", () => {
    expect(() => resolveEditorInvocation("  ", TARGET)).toThrow();
    expect(() => resolveEditorInvocation({ command: "" }, TARGET)).toThrow();
  });
});

describe("parseEditorTarget", () => {
  const root = "D:/Github/app";

  it("parses an absolute file with line and column", () => {
    expect(parseEditorTarget("D:/Github/app/app/routes/home.tsx:20:9", root)).toEqual({
      file: "D:/Github/app/app/routes/home.tsx",
      line: 20,
      column: 9,
    });
  });

  it("defaults the column to 1", () => {
    expect(
      parseEditorTarget("D:/Github/app/app/routes/home.tsx:20", root),
    ).toEqual({
      file: "D:/Github/app/app/routes/home.tsx",
      line: 20,
      column: 1,
    });
  });

  it("resolves project-relative paths", () => {
    expect(parseEditorTarget("app/routes/home.tsx:3:4", root)).toEqual({
      file: "D:/Github/app/app/routes/home.tsx",
      line: 3,
      column: 4,
    });
  });

  it("rejects paths outside the project root", () => {
    expect(parseEditorTarget("D:/other/app.tsx:1:2", root)).toBeUndefined();
    expect(parseEditorTarget("../outside.tsx:1:2", root)).toBeUndefined();
  });

  it("rejects missing or invalid positions", () => {
    expect(parseEditorTarget("D:/Github/app/app.tsx", root)).toBeUndefined();
    expect(parseEditorTarget("D:/Github/app/app.tsx:0:1", root)).toBeUndefined();
    expect(parseEditorTarget("D:/Github/app/app.tsx:1:0", root)).toBeUndefined();
    expect(parseEditorTarget("", root)).toBeUndefined();
  });

  it("accepts file:// URLs", () => {
    const target = parseEditorTarget(
      "file:///D:/Github/app/app/routes/home.tsx:5:6",
      root,
    );
    expect(target?.line).toBe(5);
    expect(target?.column).toBe(6);
  });
});

describe("createEditorLauncher", () => {
  it("calls a custom launcher function with the target", async () => {
    const calls: EditorTarget[] = [];
    const launcher = createEditorLauncher((target) => {
      calls.push(target);
    });
    await launcher(TARGET);
    expect(calls).toEqual([TARGET]);
  });

  it("awaits async custom launchers", async () => {
    let finished = false;
    const launcher = createEditorLauncher(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    });
    await launcher(TARGET);
    expect(finished).toBe(true);
  });

  it("reports custom launcher failures through onError instead of throwing", async () => {
    const errors: string[] = [];
    const launcher = createEditorLauncher(
      () => {
        throw new Error("launcher exploded");
      },
      { onError: (message) => errors.push(message) },
    );
    await expect(launcher(TARGET)).resolves.toBeUndefined();
    expect(errors[0]).toContain("launcher exploded");
  });

  it("reports invalid editor definitions through onError", async () => {
    const errors: string[] = [];
    const launcher = createEditorLauncher("", {
      onError: (message) => errors.push(message),
    });
    await launcher(TARGET);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Could not resolve the editor command");
  });
});
