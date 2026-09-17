import { useState, type ReactNode } from "react";

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const [error, setError] = useState("");
  return (
    <>
      <a
        href={href}
        className={className}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          if (window.otto) {
            event.preventDefault();
            void window.otto
              .openExternal(href)
              .catch(() => setError("Unable to open the link."));
          }
        }}
      >
        {children}
      </a>
      {error && (
        <span className="link-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
