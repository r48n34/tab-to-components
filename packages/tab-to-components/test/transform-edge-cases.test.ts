import { describe, expect, it } from "vitest";
import { transformSource } from "../src/transform.js";

const FILE = "D:/proj/app/App.tsx";
const REL = "app/App.tsx";

function run(code: string, filename = FILE, relPath = REL) {
  return transformSource(code, filename, { relPath, marker: true });
}

/** Build the marker the transform must emit for the first `needle` occurrence. */
function expectedAt(code: string, needle: string, relPath = REL): string {
  const lines = code.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const column = (lines[index] ?? "").indexOf(needle);
    if (column !== -1) return `${relPath}:${index + 1}:${column + 1}`;
  }
  throw new Error(`needle ${JSON.stringify(needle)} not found`);
}

describe("line endings and encoding", () => {
  it("preserves CRLF endings and reports the right line", () => {
    const code = "const a = 1;\r\nconst b = <div />;\r\n";
    const result = run(code);
    expect(result?.code).toContain("\r\n");
    expect(result?.code).toContain(expectedAt(code, "<div"));
  });

  it("handles a UTF-8 BOM", () => {
    const code = "\uFEFFconst a = <div />;\n";
    const result = run(code);
    expect(result?.code.startsWith("\uFEFF")).toBe(true);
    expect(result?.code).toContain(expectedAt(code, "<div"));
  });

  it("computes columns in characters, not bytes, with unicode content", () => {
    const code = "const a = <p>日本語 → テスト</p>;\n";
    expect(run(code)?.code).toContain(expectedAt(code, "<p>"));
  });

  it("handles very long lines", () => {
    const padding = "x".repeat(500);
    const code = `const a = <div data-padding="${padding}" />;\n`;
    expect(run(code)?.code).toContain(expectedAt(code, "<div"));
  });
});

describe("JSX shapes", () => {
  it("query JSX namespaced elements are not annotated but do not crash", () => {
    const code = 'const a = <svg:rect x="1" />;\n';
    // Either untouched or annotated - what matters is that parsing/rewriting
    // never produces invalid syntax for namespaced names.
    const result = run(code);
    expect(result === undefined || !result.code.includes("data-ttc")).toBe(true);
  });

  it("annotates several elements on the same line", () => {
    const code = "const a = <div><span /></div>;\n";
    const result = run(code)!.code;
    expect(result).toContain(expectedAt(code, "<div"));
    expect(result).toContain(expectedAt(code, "<span"));
  });

  it("annotates JSX rendered from a .map callback", () => {
    const code = [
      "export function List({ rows }) {",
      "  return rows.map((row) => <Row key={row.id} active={row.active} />);",
      "}",
      "",
    ].join("\n");
    const result = run(code)!.code;
    expect(result).toContain(expectedAt(code, "<Row"));
    expect(result).toContain('data-ttc-name={"Row"}');
  });

  it("annotates JSX in ternaries and logical expressions", () => {
    const code = "const a = ok ? <Yes /> : <No />;\n";
    const result = run(code)!.code;
    expect(result).toContain(expectedAt(code, "<Yes"));
    expect(result).toContain(expectedAt(code, "<No"));
  });

  it("ignores JSX-looking text in strings, comments and regexes", () => {
    const code = [
      'const a = "<div />";',
      "// <span /> in a comment",
      "const re = /<b>/;",
      "const b = 1;",
      "",
    ].join("\n");
    expect(run(code)).toBeUndefined();
  });

  it("handles boolean, key and ref attributes", () => {
    const code = "const a = <input disabled key=\"k\" ref={ref} />;\n";
    const result = run(code)!.code;
    expect(result).toContain('ref={ref} data-ttc={');
    expect(result).toContain(expectedAt(code, "<input"));
  });

  it("annotates children of a keyed fragment", () => {
    const code = "const a = <Fragment key=\"k\"><span /></Fragment>;\n";
    const result = run(code)!.code;
    expect(result).toContain(expectedAt(code, "<span"));
    expect(result).toContain('data-ttc-name={"Fragment"}');
  });

  it("does not annotate the closing tag", () => {
    const result = run("const a = <div></div>;\n")!.code;
    expect(result.match(/data-ttc/g)?.length).toBe(1);
  });
});

describe("file types and syntax", () => {
  it("works for .jsx files", () => {
    const code = "export const A = () => <div />;\n";
    expect(
      run(code, "D:/proj/app/A.jsx", "app/A.jsx")?.code,
    ).toContain(expectedAt(code, "<div", "app/A.jsx"));
  });

  it("returns undefined for .ts files without JSX", () => {
    expect(run("export const value: number = 1;\n", "D:/proj/app/a.ts", "app/a.ts")).toBeUndefined();
  });

  it("parses Flow-only syntax in .js files", () => {
    const code = [
      "// @flow",
      "type Props = { title: string };",
      "export const Card = (props: Props) => <section>{props.title}</section>;",
      "",
    ].join("\n");
    const result = run(code, "D:/proj/app/Card.js", "app/Card.js");
    expect(result?.code).toContain(expectedAt(code, "<section", "app/Card.js"));
  });

  it("supports class components and decorators", () => {
    const code = [
      "function observer(target: unknown) { return target; }",
      "@observer",
      "export class View extends React.Component {",
      "  render() {",
      "    return <div className=\"view\" />;",
      "  }",
      "}",
      "",
    ].join("\n");
    expect(run(code)?.code).toContain(expectedAt(code, "<div"));
  });

  it("supports generics, satisfies and non-null assertions", () => {
    const code = [
      "const config = { a: 1 } satisfies Record<string, number>;",
      "export const Cell = <T,>(props: { value?: T | null }) => (",
      "  <span>{String(props.value!)}</span>",
      ");",
      "",
    ].join("\n");
    expect(run(code)?.code).toContain(expectedAt(code, "<span"));
  });

  it("returns undefined for code that does not parse", () => {
    expect(run("const a = <div ;\n")).toBeUndefined();
    expect(run("class {")).toBeUndefined();
  });
});
