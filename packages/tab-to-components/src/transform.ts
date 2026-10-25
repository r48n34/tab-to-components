import * as babelParser from "@babel/parser";
import type { ParserPlugin } from "@babel/parser";
import * as babelTypes from "@babel/types";
import MagicString from "magic-string";
import path from "node:path";
import { MARKER_ATTR, NAME_ATTR } from "./types.js";

type ParseFunction = typeof babelParser.parse;
type AstNode = { type: string; start?: number | null; end?: number | null };

function getParse(): ParseFunction {
  const mod = babelParser as unknown as {
    parse?: ParseFunction;
    default?: { parse?: ParseFunction };
  };
  const parse = mod.parse ?? mod.default?.parse;
  if (typeof parse !== "function") {
    throw new TypeError(
      "tab-to-components: could not load @babel/parser (missing `parse` export).",
    );
  }
  return parse;
}

const VISITOR_KEYS = (babelTypes as unknown as {
  VISITOR_KEYS?: Record<string, string[]>;
}).VISITOR_KEYS;

function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  const keys = VISITOR_KEYS?.[node.type];
  if (!keys) return;
  const record = node as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof (child as AstNode).type === "string") {
          walk(child as AstNode, visit);
        }
      }
    } else if (value && typeof (value as AstNode).type === "string") {
      walk(value as AstNode, visit);
    }
  }
}

const BASE_PLUGINS: ParserPlugin[] = [
  "jsx",
  "decorators-legacy",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "classStaticBlock",
  "importAttributes",
  "explicitResourceManagement",
  "importMeta",
  "topLevelAwait",
];

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
/**
 * `.ts` / `.mts` / `.cts` cannot legally contain JSX, and enabling the `jsx`
 * plugin would reject valid angle-bracket type assertions (`<string>value`).
 */
const TS_NO_JSX_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);
/** Same plugin set as `BASE_PLUGINS` minus `jsx`. */
const BASE_PLUGINS_WITHOUT_JSX: ParserPlugin[] = BASE_PLUGINS.filter(
  (plugin) => plugin !== "jsx",
);
const JSX_EXTENSIONS = new Set([".jsx", ".tsx"]);

export interface TransformSourceOptions {
  /** Project-root-relative path used in the marker and in source maps. */
  relPath: string;
  /** Inject `data-ttc` / `data-ttc-name` props. */
  marker: boolean;
  /** Prepend `import "<virtual client id>";`. */
  overlayImport?: string;
}

interface JsxOpeningElement extends AstNode {
  type: "JSXOpeningElement";
  name: {
    type: string;
    start?: number | null;
    end?: number | null;
    name?: string;
  };
  attributes: Array<{ end?: number | null }>;
  /** `<Foo<string> />`: Babel 7 names it `typeParameters`, Babel 8 `typeArguments`. */
  typeParameters?: { end?: number | null } | null;
  typeArguments?: { end?: number | null } | null;
  loc?: { start: { line: number; column: number } } | null;
}

interface AstObjectProperty {
  type: string;
  start?: number | null;
  end?: number | null;
  key?: { type: string; name?: string; value?: string };
  value?: {
    type: string;
    value?: number | string;
    properties?: AstObjectProperty[];
  };
}

interface AstObjectExpression extends AstNode {
  type: "ObjectExpression";
  properties: AstObjectProperty[];
}

interface AstCallee extends AstNode {
  name?: string;
}

interface AstCallExpression extends AstNode {
  type: "CallExpression";
  callee?: AstCallee;
  arguments: AstNode[];
}

export function parseModule(
  code: string,
  filename: string,
): AstNode | undefined {
  const ext = path.extname(filename).toLowerCase();
  const parse = getParse();
  const pluginSets: ParserPlugin[][] = [];
  if (TS_NO_JSX_EXTENSIONS.has(ext)) {
    pluginSets.push([...BASE_PLUGINS_WITHOUT_JSX, "typescript"]);
  } else if (TS_EXTENSIONS.has(ext)) {
    pluginSets.push([...BASE_PLUGINS, "typescript"]);
  } else {
    pluginSets.push([...BASE_PLUGINS, "typescript"], [...BASE_PLUGINS, "flow"]);
  }
  const sourceTypes: Array<"module" | "unambiguous"> = JSX_EXTENSIONS.has(ext)
    ? ["module"]
    : ["module", "unambiguous"];

  for (const sourceType of sourceTypes) {
    for (const plugins of pluginSets) {
      try {
        return parse(code, {
          sourceType,
          plugins,
          allowReturnOutsideFunction: false,
          attachComment: false,
          errorRecovery: false,
        }) as unknown as AstNode;
      } catch {
        // try the next parser configuration
      }
    }
  }
  return undefined;
}

function isHostElementName(nameNode: JsxOpeningElement["name"]): boolean {
  if (nameNode.type !== "JSXIdentifier") return false;
  const name = nameNode.name ?? "";
  return name.length > 0 && !/^[A-Z]/.test(name);
}

function jsxNameOf(
  code: string,
  nameNode: JsxOpeningElement["name"],
): string {
  if (
    nameNode.type === "JSXIdentifier" &&
    typeof nameNode.name === "string"
  ) {
    return nameNode.name;
  }
  if (nameNode.start == null || nameNode.end == null) return "";
  return code.slice(nameNode.start, nameNode.end);
}

/**
 * Rewrite a module so every JSX element carries its original source location,
 * and optionally add the client runtime import.
 *
 * Returns `undefined` when the module does not need (or cannot take) any
 * change, which lets Vite skip the update entirely.
 */
export function transformSource(
  code: string,
  filename: string,
  options: TransformSourceOptions,
): { code: string; map: ReturnType<MagicString["generateMap"]> } | undefined {
  const needsMarker = options.marker && !code.includes(MARKER_ATTR);
  const overlayImport = options.overlayImport;
  const needsOverlay =
    Boolean(overlayImport) && !code.includes(overlayImport as string);

  if (!needsMarker && !needsOverlay) return undefined;
  // Cheap bail-out: no JSX (raw or already compiled) and no overlay work.
  if (
    !needsOverlay &&
    !code.includes("<") &&
    !COMPILED_JSX_CALL_RE.test(code)
  ) {
    return undefined;
  }

  const ast = parseModule(code, filename);
  if (!ast) return undefined;

  const magic = new MagicString(code);
  let changed = false;
  let jsxElementCount = 0;

  if (needsMarker) {
    walk(ast, (node) => {
      if (node.type !== "JSXOpeningElement") return;
      jsxElementCount += 1;
      const element = node as JsxOpeningElement;
      const nameNode = element.name;
      if (!nameNode || nameNode.type === "JSXNamespacedName") return;
      const start = element.loc?.start;
      if (!start || nameNode.start == null || nameNode.end == null) return;

      const lastAttribute = element.attributes[element.attributes.length - 1];
      const insertAt =
        lastAttribute?.end ??
        element.typeParameters?.end ??
        element.typeArguments?.end ??
        nameNode.end;
      if (typeof insertAt !== "number") return;

      const location = `${options.relPath}:${start.line}:${start.column + 1}`;
      let attributes = ` ${MARKER_ATTR}={${JSON.stringify(location)}}`;
      if (!isHostElementName(nameNode)) {
        const name = jsxNameOf(code, nameNode);
        if (name) attributes += ` ${NAME_ATTR}={${JSON.stringify(name)}}`;
      }
      magic.appendLeft(insertAt, attributes);
      changed = true;
    });

    // Another `pre` plugin (`@vitejs/plugin-react`, a nested plugins array, …)
    // may have compiled this module before us. Babel and esbuild development
    // builds keep the JSX source object on every `jsxDEV(...)` call, so the
    // markers can still be injected into the compiled props object.
    if (jsxElementCount === 0) {
      changed = injectCompiledJsxMarkers(ast, code, magic, options.relPath) || changed;
    }
  }

  if (needsOverlay && overlayImport) {
    const program = (ast as unknown as {
      program?: {
        body: Array<{ start?: number | null }>;
        directives?: Array<{ end?: number | null }>;
      };
    }).program;
    if (program) {
      const firstStatement = program.body[0];
      let insertAt: number;
      let needsLineBreak = false;
      if (firstStatement?.start != null) {
        insertAt = firstStatement.start;
      } else {
        const lastDirective = program.directives?.[program.directives.length - 1];
        insertAt = lastDirective?.end ?? code.length;
        // Nothing follows: after a directive, a trailing line comment or a
        // shebang there is no statement boundary, so the import needs its own
        // line (ASI plus not being swallowed by a line comment).
        needsLineBreak = true;
      }
      const declaration = `import ${JSON.stringify(overlayImport)};\n`;
      if (insertAt <= 0) {
        magic.prepend(declaration);
      } else {
        magic.appendLeft(
          insertAt,
          needsLineBreak ? `\n${declaration}` : declaration,
        );
      }
      changed = true;
    }
  }

  if (!changed) return undefined;

  return {
    code: magic.toString(),
    // Absolute source paths keep Vite from warning about "missing source files"
    // while still letting it read the original file for the map.
    map: magic.generateMap({
      hires: true,
      source: filename,
      includeContent: false,
    }),
  };
}

const COMPILED_JSX_CALL_RE = /jsxDEV\s*\(|\bjsxs?\s*\(/;

interface CompiledSourceLocation {
  line: number;
  column: number;
}

function readCompiledJsxSource(
  node: AstObjectExpression,
): CompiledSourceLocation | undefined {
  let line: number | undefined;
  let column: number | undefined;
  let hasFileName = false;
  for (const property of node.properties) {
    if (property.type !== "ObjectProperty") continue;
    const key = property.key;
    const value = property.value;
    if (!key || !value) continue;
    const keyName =
      key.type === "Identifier"
        ? key.name
        : key.type === "StringLiteral"
          ? key.value
          : undefined;
    if (keyName === "fileName") {
      hasFileName = true;
      continue;
    }
    if (keyName !== "lineNumber" && keyName !== "columnNumber") continue;
    if (value.type !== "NumericLiteral" || typeof value.value !== "number") {
      continue;
    }
    if (keyName === "lineNumber") line = value.value;
    else column = value.value;
  }
  if (!hasFileName || line === undefined || column === undefined) {
    return undefined;
  }
  return { line, column };
}

function compiledJsxTypeName(
  code: string,
  typeNode: AstNode | undefined,
): string | undefined {
  if (!typeNode) return undefined;
  if (typeNode.type === "StringLiteral") {
    return (typeNode as unknown as { value?: string }).value;
  }
  if (typeNode.type === "Identifier") {
    return (typeNode as unknown as { name?: string }).name;
  }
  if (
    typeNode.type === "MemberExpression" &&
    typeNode.start != null &&
    typeNode.end != null
  ) {
    return code.slice(typeNode.start, typeNode.end);
  }
  return undefined;
}

function isComponentName(name: string): boolean {
  if (name.includes(".")) return true;
  return /^[A-Z]/.test(name);
}

/**
 * Callees produced by a development JSX transform. The compiled-JSX fallback
 * must only rewrite these: matching any 5-argument call with a source-like
 * object would corrupt unrelated app code (analytics calls, prototypes, …).
 * Babel and esbuild emit `jsxDEV`/`jsxs`/`jsx`; a Babel import may be aliased
 * to `_jsxDEV` and friends.
 */
const COMPILED_JSX_CALLEES = new Set([
  "jsxDEV",
  "jsx",
  "jsxs",
  "_jsxDEV",
  "_jsx",
  "_jsxs",
]);

function compiledCalleeName(callee: AstCallee | undefined): string | undefined {
  if (!callee || callee.type !== "Identifier") return undefined;
  return callee.name;
}

/**
 * Inject the same source markers into already-compiled `jsxDEV(...)` calls.
 *
 * Babel's and esbuild's development JSX transforms emit
 * `jsxDEV(type, props, key, isStaticChildren, { fileName, lineNumber,
 * columnNumber }, self)`, so the original JSX position is still available even
 * when another plugin compiled the module first.
 */
function injectCompiledJsxMarkers(
  ast: AstNode,
  code: string,
  magic: MagicString,
  relPath: string,
): boolean {
  let changed = false;
  walk(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const call = node as AstCallExpression;
    if (!COMPILED_JSX_CALLEES.has(compiledCalleeName(call.callee) ?? "")) {
      return;
    }
    const args = call.arguments;
    if (args.length < 5) return;

    const sourceNode = args[4];
    if (!sourceNode || sourceNode.type !== "ObjectExpression") return;
    const location = readCompiledJsxSource(sourceNode as AstObjectExpression);
    if (!location) return;

    const propsNode = args[1];
    if (!propsNode) return;

    const markerValue = `${relPath}:${location.line}:${location.column}`;
    let properties = `"${MARKER_ATTR}": ${JSON.stringify(markerValue)}`;

    const typeName = compiledJsxTypeName(code, args[0]);
    if (typeName && isComponentName(typeName)) {
      properties += `, "${NAME_ATTR}": ${JSON.stringify(typeName)}`;
    }

    if (propsNode.type === "NullLiteral") {
      if (propsNode.start == null || propsNode.end == null) return;
      magic.overwrite(propsNode.start, propsNode.end, `{ ${properties} }`);
      changed = true;
      return;
    }
    if (propsNode.type !== "ObjectExpression") return;

    const objectNode = propsNode as AstObjectExpression;
    if (objectNode.properties.length === 0) {
      if (objectNode.start == null) return;
      magic.appendLeft(objectNode.start + 1, ` ${properties} `);
    } else {
      const lastProperty = objectNode.properties[objectNode.properties.length - 1];
      if (!lastProperty || typeof lastProperty.end !== "number") return;
      magic.appendLeft(lastProperty.end, `, ${properties}`);
    }
    changed = true;
  });
  return changed;
}
