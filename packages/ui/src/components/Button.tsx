import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * A shared button. US-099.
 *
 * One component, three intents, and the class name is a detail the component
 * owns. A page says what it wants; the component says how it is styled. This is
 * what keeps `secondary-button` and `primary-button` from being copied as plain
 * strings into a new screen and drifting.
 *
 * The variants map to the theme's existing classes, so styles/theme.css needs
 * no change and an existing screen migrates without its look moving.
 *
 * `type` defaults to `button`. A button that submits a form says so, because
 * the native default is submit and a reusable button that silently submits is
 * how a form grows a second submit button nobody asked for.
 */
export function Button({
  variant = "secondary",
  className,
  type = "button",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "primary" | "secondary" | "compact";
  readonly children: ReactNode;
}) {
  const variantClass = {
    primary: "primary-button",
    secondary: "secondary-button",
    compact: "compact-button",
  }[variant];

  return (
    <button
      type={type}
      className={className ? `${variantClass} ${className}` : variantClass}
      {...rest}
    >
      {children}
    </button>
  );
}
