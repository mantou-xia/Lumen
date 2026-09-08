import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import {
  CircleCheck,
  CircleX,
  Info,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { AppIcon } from "./AppIcon";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const statusIcons: Record<Tone, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
};

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  return <button className={classes("ui-button", `ui-button--${variant}`, className)} {...props} />;
}

export function IconButton({
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      className={classes("ui-icon-button", className)}
      title={props.title ?? label}
      {...props}
    />
  );
}

export function SurfaceCard({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={classes("ui-card", className)} {...props} />;
}

export function Badge({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: Tone;
}) {
  return <span className={classes("ui-badge", `ui-badge--${tone}`, className)}>{children}</span>;
}

export function StatusNotice({
  children,
  className,
  tone = "info",
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  return (
    <div
      className={classes("ui-status", `ui-status--${tone}`, className)}
      role={props.role ?? (tone === "danger" ? "alert" : "status")}
      {...props}
    >
      <AppIcon icon={statusIcons[tone]} size={17} />
      <span>{children}</span>
    </div>
  );
}

export function Field({
  className,
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={classes("ui-field", className)}>
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}

export function EmptyState({
  action,
  children,
  className,
  description,
  title,
}: {
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  description: ReactNode;
  title: ReactNode;
}) {
  return (
    <section className={classes("ui-empty-state", className)}>
      {children}
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}

export function OverlaySurface({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <aside className={classes("ui-overlay", className)} {...props} />;
}
