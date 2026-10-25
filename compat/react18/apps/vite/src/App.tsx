import { useState } from "react";
import { Button } from "./components/Button";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="ttc-main">
      <h1>Vite + React 18</h1>
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
