import { useState } from "react";
import { Star } from "lucide-react";

// Read-only star row used in Browse cards, the buy/detail view, and review
// lists. `value` may be fractional (e.g. an average like 4.3) — partial stars
// are rendered by clipping a filled star over an outline.
export function StarRating({
  value,
  size = 13,
  className,
}: {
  value: number;
  size?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(5, value));
  return (
    <div
      className={`inline-flex items-center gap-0.5 ${className ?? ""}`}
      aria-label={`${clamped.toFixed(1)} out of 5 stars`}
    >
      {Array.from({ length: 5 }).map((_, i) => {
        const fill = Math.max(0, Math.min(1, clamped - i));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star
              className="absolute inset-0 text-muted-foreground/40"
              style={{ width: size, height: size }}
              strokeWidth={1.5}
            />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill * 100}%` }}
            >
              <Star
                className="text-primary"
                style={{ width: size, height: size }}
                fill="currentColor"
                strokeWidth={1.5}
              />
            </span>
          </span>
        );
      })}
    </div>
  );
}

// Interactive 1–5 star picker used in the review form.
export function StarInput({
  value,
  onChange,
  size = 26,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  size?: number;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const active = hover || value;
  return (
    <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          onMouseEnter={() => !disabled && setHover(n)}
          onMouseLeave={() => setHover(0)}
          data-testid={`star-${n}`}
          aria-checked={value === n}
          role="radio"
          className="transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Star
            style={{ width: size, height: size }}
            className={n <= active ? "text-primary" : "text-muted-foreground/40"}
            fill={n <= active ? "currentColor" : "none"}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  );
}
