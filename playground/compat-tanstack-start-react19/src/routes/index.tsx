import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "../components/Button";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [count, setCount] = useState(0);

  return (
    <main className="ttc-main">
      <h1>TanStack Start + React 19</h1>
      <p>
        Hold <kbd>Alt</kbd> and click the button. The JSX source of the
        component you clicked opens in your editor.
      </p>
      <Button onClick={() => setCount((value) => value + 1)}>
        count is {count}
      </Button>
    </main>
  );
}
