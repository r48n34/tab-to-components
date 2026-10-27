import { useState } from "react";
import { Button } from "./components/Button";
import { FeatureCard } from "./components/FeatureCard";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="ttc-main">
      <h1>Vite 5 + React 18</h1>
      <p>
        Hold <kbd>Alt</kbd> and click the button. The JSX source of the
        component you clicked opens in your editor.
      </p>
      <FeatureCard title="Nested component chain">
        <p>
          App &rarr; FeatureCard &rarr; Button. Alt+clicking the button opens{" "}
          <code>src/App.tsx</code>.
        </p>
        <Button onClick={() => setCount((value) => value + 1)}>
          count is {count}
        </Button>
      </FeatureCard>
    </main>
  );
}
