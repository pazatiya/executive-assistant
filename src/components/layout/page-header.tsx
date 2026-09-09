import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col items-start justify-between gap-4 px-4 pb-3 pt-7 sm:flex-row sm:items-center sm:px-7 sm:pb-4 sm:pt-9 lg:px-10">
      <div className="min-w-0">
        <span className="mb-3 block h-px w-8 bg-[#c79832]" />
        <h1 className="text-[1.65rem] font-bold leading-tight tracking-[-0.025em] sm:text-[1.9rem]">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">{children}</div>}
    </div>
  );
}

export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1480px] px-4 pb-10 pt-4 sm:px-7 sm:pt-5 lg:px-10", className)}>{children}</div>;
}
