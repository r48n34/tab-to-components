export { AUTO_EDITOR, DEFAULT_EDITOR, tabToComponents } from "./plugin.js";
export { VERSION } from "./version.js";
export { CLIENT_VIRTUAL_ID } from "./virtual.js";
export {
  CUSTOM_EDITOR_ENDPOINT,
  createEditorLauncher,
  editorNameOf,
  editorTargetExists,
  parseEditorTarget,
  presetEditorArgs,
  resolveEditorInvocation,
  splitCommandLine,
  type EditorCommand,
} from "./editor.js";
export {
  MARKER_ATTR,
  NAME_ATTR,
  type ClientConfig,
  type EditorCommandConfig,
  type EditorLauncher,
  type EditorOption,
  type EditorTarget,
  type InspectorKey,
  type TabToComponentsOpenMode,
  type TabToComponentsOptions,
} from "./types.js";
