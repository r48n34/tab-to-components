import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

const css = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
}
.ttc-main { width: min(40rem, 100%); padding: 2rem; text-align: center; }
.ttc-main h1 { margin: 0 0 0.75rem; font-size: clamp(1.75rem, 4vw, 2.5rem); line-height: 1.1; }
.ttc-main p { margin: 0 0 1.25rem; color: #9ca3af; }
kbd {
  border: 1px solid #4b5563;
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 0.1rem 0.35rem;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.85em;
  color: #e5e7eb;
}
.ttc-button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  color: inherit;
  background-color: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.25s;
}
.ttc-button:hover { border-color: #646cff; }
`;

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:," />
        <title>React Router v7 + React 18</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
