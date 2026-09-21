import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

export function SectionBlock({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("section-block", className)}>
      <div className="section-header flex items-center justify-between">
        <div className="mono-label !text-foreground font-semibold">{title}</div>
        {subtitle && (
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            {subtitle}
          </div>
        )}
      </div>
      <div className="section-content space-y-4">{children}</div>
    </div>
  );
}

export function GridOptions({
  options,
  value,
  onChange,
  columns = 3,
  testIdPrefix,
}: {
  options: { id: string | number; label: string; hint?: string; disabled?: boolean }[];
  value: string | number;
  onChange: (id: any) => void;
  columns?: 2 | 3 | 4 | 5 | 6;
  testIdPrefix: string;
}) {
  const cols = {
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
    5: "grid-cols-5",
    6: "grid-cols-6",
  }[columns];

  return (
    <div className={cn("grid gap-2", cols)}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => !opt.disabled && onChange(opt.id)}
            disabled={opt.disabled}
             aria-pressed={active}
            data-testid={`${testIdPrefix}-${String(opt.id).toLowerCase().replace(/\s/g, "-")}`}
            className={cn(
              "btn-ghost min-w-0 font-mono text-left py-3 px-3 flex flex-col justify-center",
              active && "active",
              opt.disabled && "opacity-40 cursor-not-allowed"
            )}
          >
            <span className="text-[12px] font-bold leading-snug whitespace-normal break-words w-full">
              {opt.label}
            </span>
            {opt.hint && (
              <span className={cn("text-[10px] uppercase tracking-wide mt-1 whitespace-normal break-words w-full", active ? "opacity-90" : "opacity-60")}>
                {opt.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function InputRow({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  testId,
  error,
  hint,
  action,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  testId?: string;
  error?: string | boolean;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="mono-label text-[10px]">{label}</label>
        {hint && <span className="font-mono text-[9px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="flex gap-2">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          data-testid={testId}
          className={cn(
            "input-field flex-1 font-mono text-[12px] px-3 py-2 min-w-0",
            error && "border-destructive text-destructive"
          )}
        />
        {action}
      </div>
      {typeof error === "string" && error && (
        <p className="font-mono text-[10px] text-destructive mt-1.5">{error}</p>
      )}
    </div>
  );
}

export function StatusPill({
  status,
  labels,
  testId,
}: {
  status: string;
  labels: Record<string, { text: string; variant: "default" | "success" | "warning" | "error" }>;
  testId?: string;
}) {
  const config = labels[status] || { text: status, variant: "default" };
  const variants = {
    default: "text-muted-foreground bg-muted/50",
    success: "text-primary bg-primary/10 border border-primary/20",
    warning: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20",
    error: "text-destructive bg-destructive/10 border border-destructive/20",
  };

  return (
    <span
      data-testid={testId}
      className={cn(
        "font-mono text-[9px] tracking-widest uppercase px-2 py-0.5 rounded-sm",
        variants[config.variant]
      )}
    >
      {config.text}
    </span>
  );
}
