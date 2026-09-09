import type {
  HTMLAttributes,
  ReactNode,
} from "react";
import {
  Alert as MuiAlert,
  Badge as MuiBadge,
  Button as MuiButton,
  Card as MuiCard,
  IconButton as MuiIconButton,
  Paper,
  TextField as MuiTextField,
  type ButtonProps as MuiButtonProps,
  type AlertProps as MuiAlertProps,
  type IconButtonProps as MuiIconButtonProps,
  type TextFieldProps as MuiTextFieldProps,
} from "@mui/material";
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
}: Omit<MuiButtonProps, "variant"> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const muiVariant = variant === "primary" ? "contained" : variant === "secondary" ? "outlined" : "text";
  return (
    <MuiButton
      className={classes("ui-button", `ui-button--${variant}`, className)}
      variant={muiVariant}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className,
  ...props
}: MuiIconButtonProps & { label: string }) {
  return (
    <MuiIconButton
      aria-label={label}
      className={classes("ui-icon-button", className)}
      size="small"
      title={props.title ?? label}
      {...props}
    />
  );
}

export function SurfaceCard({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <MuiCard component="section" className={classes("ui-card", className)} {...props} />;
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
  return (
    <MuiBadge className={classes("ui-badge", `ui-badge--${tone}`, className)} badgeContent={children}>
      <span aria-hidden="true" />
    </MuiBadge>
  );
}

export function StatusNotice({
  children,
  className,
  tone = "info",
  ...props
}: Omit<MuiAlertProps, "severity"> & { tone?: Tone }) {
  return (
    <MuiAlert
      className={classes("ui-status", `ui-status--${tone}`, className)}
      icon={<AppIcon icon={statusIcons[tone]} size={17} />}
      severity={tone === "neutral" ? "info" : tone === "danger" ? "error" : tone}
      variant="outlined"
      role={props.role ?? (tone === "danger" ? "alert" : "status")}
      {...props}
    >
      {children}
    </MuiAlert>
  );
}

export function Field({
  className,
  label,
  ...props
}: Omit<MuiTextFieldProps, "label"> & { label: string }) {
  return (
    <MuiTextField className={classes("ui-field", className)} label={label} size="small" {...props} />
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
    <Paper component="section" elevation={0} className={classes("ui-empty-state", className)}>
      {children}
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </Paper>
  );
}

export function OverlaySurface({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <Paper component="aside" elevation={8} className={classes("ui-overlay", className)} {...props} />;
}

export {
  ButtonBase,
  InputAdornment,
  InputBase,
  MenuItem,
  OutlinedInput,
  Select,
  Slider,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
