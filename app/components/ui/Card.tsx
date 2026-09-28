/**
 * A sheet of paper with a hairline. Near-square, unlifted — in the Index
 * language elevation is not how hierarchy is expressed; rules and type are.
 */
export function Card({
  className = "",
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-pub-lg border border-pub-line bg-pub-sheet ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-pub-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="font-display text-pub-base font-extrabold tracking-[-0.01em] text-pub-ink">{title}</h2>
        {description && <p className="mt-1 text-pub-sm leading-pub-normal text-pub-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}
