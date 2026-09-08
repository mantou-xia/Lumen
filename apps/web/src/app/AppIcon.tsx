import type { LucideIcon } from "lucide-react";

export function AppIcon({
  className,
  icon: Icon,
  size = 18,
}: {
  className?: string | undefined;
  icon: LucideIcon;
  size?: number;
}) {
  return (
    <Icon
      aria-hidden="true"
      className={`app-icon${className === undefined ? "" : ` ${className}`}`}
      focusable="false"
      size={size}
      strokeWidth={1.75}
    />
  );
}
