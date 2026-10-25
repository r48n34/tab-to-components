import { Button } from "../../src/components/Button";

export default function Page() {
  return (
    <main className="ttc-main">
      <h1>Vike + React 19</h1>
      <p>
        Hold <kbd>Alt</kbd> and click the button: the JSX source of the clicked
        component opens in your editor.
      </p>
      <Button>Click me</Button>
    </main>
  );
}
