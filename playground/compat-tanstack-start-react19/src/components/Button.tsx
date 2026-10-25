import type { ReactNode } from "react";

export function Button({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="ttc-button" onClick={onClick}>
      {children}
    </button>
  );
}
