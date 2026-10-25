import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = {
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ children, ...rest }: ButtonProps) {
  // Spread the props the inspector injects at the usage site, like a real
  // design-system button would, so the host element carries them in SSR HTML.
  return (
    <button type="button" className="ttc-button" {...rest}>
      {children}
    </button>
  );
}
