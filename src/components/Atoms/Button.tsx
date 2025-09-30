import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import cls from "../../styles/Button.module.css";

export type ButtonVariant =
    | "default"
    | "primary"
    | "outline"
    | "ghost"
    | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
    fullWidth?: boolean;
    asChild?: boolean; // reserved if later we integrate with Radix Slot
}

function cx(...classes: (string | false | null | undefined)[]) {
    return classes.filter(Boolean).join(" ");
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    function Button(
        {
            variant = "default",
            size = "md",
            loading = false,
            leftIcon,
            rightIcon,
            fullWidth,
            className,
            disabled,
            children,
            ...rest
        },
        ref,
    ) {
        const isDisabled = disabled || loading;
        // Map variant/size to class names if present in module
        const variantClass: string | undefined = variant !== "default"
            ? (cls as Record<string, string>)[variant]
            : undefined;
        const sizeClass: string | undefined = size !== "md"
            ? (cls as Record<string, string>)[size]
            : undefined;

        return (
            <button
                ref={ref}
                className={cx(
                    cls.root,
                    variantClass,
                    sizeClass,
                    loading && cls.loading,
                    fullWidth && cls.fullWidth,
                    className,
                )}
                disabled={isDisabled}
                {...rest}
            >
                {loading && (
                    <span
                        className={cx(cls.icon, cls.spin)}
                        aria-hidden="true"
                    />
                )}
                {!loading && leftIcon && (
                    <span className={cls.icon} aria-hidden="true">
                        {leftIcon}
                    </span>
                )}
                <span>{children}</span>
                {!loading && rightIcon && (
                    <span className={cls.icon} aria-hidden="true">
                        {rightIcon}
                    </span>
                )}
            </button>
        );
    },
);

export default Button;
