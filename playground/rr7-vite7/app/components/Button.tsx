import type { ReactNode } from "react";

export function Button({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button className="ttc-button" type="button" onClick={onClick}>
      {children}
    </button>
  );
}
