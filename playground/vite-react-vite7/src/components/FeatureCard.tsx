import type { ReactNode } from "react";
import { Badge } from "./Badge";

export function FeatureCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="ttc-card">
      <Badge>feature-card</Badge>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
