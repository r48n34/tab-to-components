/**
 * The small line icons rendered before each overlay menu row's label.
 *
 * Every icon is a hand-authored 16×16 stroke drawing rendered as an inline
 * `<svg>` inside the overlay's shadow root, so it inherits `currentColor` (the
 * row's text color) and needs no icon font, sprite sheet or network request.
 * Icons are decorative: the row's text is its accessible name, so each `<svg>`
 * is `aria-hidden` and skipped by the accessibility tree.
 */

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Icon shown before one row of the component chain or source action picker. */
export type MenuIconName =
  | "open"
  | "copy-file"
  | "copy-path"
  | "copy-full-path"
  | "copy-location"
  | "component";

/**
 * `d` attribute values per icon, drawn on a 16×16 grid with 1.5px strokes.
 * Multiple entries are separate subpaths of the same drawing.
 */
export const MENU_ICON_PATHS: Record<MenuIconName, readonly string[]> = {
  // An arrow leaving a window: jump to the source in the editor.
  open: [
    "M9 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V8",
    "M8.5 7.5 14 2",
    "M10 2h4v4",
  ],
  // A page with a folded corner: the file whose name is copied.
  "copy-file": [
    "M8.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6z",
    "M8.5 1.5V6H13",
  ],
  // A folder: the project-relative path.
  "copy-path": [
    "M1.5 12.5v-8a1 1 0 0 1 1-1h3.2l1.6 2h5.2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1z",
  ],
  // A machine drive: the absolute path on the dev-server host.
  "copy-full-path": [
    "M2 5.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z",
    "M2 8h12",
    "M4.5 10.5h.01",
  ],
  // A map pin: the file:line:column location.
  "copy-location": [
    "M8 14.5s4.5-3.9 4.5-7.25a4.5 4.5 0 1 0-9 0C3.5 10.6 8 14.5 8 14.5z",
    "M9.5 7.25a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z",
  ],
  // A stacked box: a React component in the chain picker.
  component: ["M8 1.5 14 5v6l-6 3.5L2 11V5z", "M2 5l6 3.5L14 5", "M8 8.5V14.5"],
};

/**
 * Create one menu icon as an `<svg>` element. `data-icon` names the drawing so
 * tests and tooling can identify it without inspecting path data.
 */
export function createMenuIcon(doc: Document, name: MenuIconName): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NAMESPACE, "svg") as SVGSVGElement;
  svg.setAttribute("class", "ttc-menu-icon");
  svg.setAttribute("data-icon", name);
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of MENU_ICON_PATHS[name]) {
    const path = doc.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
