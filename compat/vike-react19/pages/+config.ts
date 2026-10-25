import type { Config } from "vike/types";
import vikeReact from "vike-react/config";

// Vike React settings live in this global config; `+Page.tsx` only needs a
// default-exported React component.
export default {
  extends: [vikeReact],
  title: "Vike + React 19 - tab-to-components",
  description: "Compatibility fixture for tab-to-components inside Vike.",
} satisfies Config;
