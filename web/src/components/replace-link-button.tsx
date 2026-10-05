"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Link2, Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";

type Props =
  | { target: "inbox"; url: string; report?: never; compact?: boolean }
  | { target: "report"; report: string; url?: string; compact?: boolean };

// Swap a posting link for the employer's own URL. Plain file edit via
// /api/replace-link: no LLM, no tokens.
export function ReplaceLinkButton(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/replace-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          props.target === "inbox"
            ? { target: "inbox", url: props.url, newUrl: value.trim() }
            : { target: "report", report: props.report, newUrl: value.trim() },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not replace the link.");
        return;
      }
      setOpen(false);
      setValue("");
      // Offer a fresh live-check of the new link (VerifyLinkButton listens).
      if (props.target === "report") {
        window.dispatchEvent(new CustomEvent("co-link-replaced", { detail: { report: props.report } }));
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Replace with the employer's own posting link"
        className={cn(
          "inline-flex items-center justify-center gap-1 rounded-md text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-brand max-sm:min-h-[44px] max-sm:min-w-[44px]",
          props.compact ? "p-1" : "px-2 py-1",
        )}
      >
        <Link2 className="size-4" />
        {!props.compact && <span>Replace link</span>}
      </button>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1", props.compact ? "w-64 max-sm:w-full" : "w-full")}>
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim() && !busy) save();
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Paste the employer's posting URL…"
          aria-label="New posting URL"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface/60 px-2 py-1 text-xs outline-none focus:border-brand/50 max-sm:min-h-[44px]"
        />
        <button
          type="button"
          onClick={save}
          disabled={!value.trim() || busy}
          title="Save link"
          className="rounded-md p-1 text-brand transition-colors hover:bg-surface-hover disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          title="Cancel"
          className="rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
