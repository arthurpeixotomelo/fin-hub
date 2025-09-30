import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import headerStyles from "../../styles/Header.module.css";

interface HeadingProps {
    level?: 1 | 2 | 3 | 4 | 5 | 6;
    title: string;
    children?: ReactNode;
    className?: string;
}

export default function Heading(
    { level = 1, title, children, className }: HeadingProps,
) {
    const Tag = `h${level}` as const;
    const [container, setContainer] = useState<HTMLElement | null>(null);

    useEffect(() => {
        setContainer(document.getElementById("header-center"));
    }, []);

    const baseClass = className ? className + " " : "";
    const portalClass = container ? headerStyles.headerCenterContent : "";
    const inner = (
        <div className={baseClass + portalClass} data-heading-root>
            <Tag style={{ margin: 0 }}>{title}</Tag>
            {children && <div>{children}</div>}
        </div>
    );

    // Only attempt portal on client once container exists
    if (container) {
        return createPortal(inner, container);
    }
    // Fallback (SSR / initial render) - render inline; it will be replaced once mounted
    return inner;
}
