import { Link } from "wouter";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export default function NotFound() {
  return (
    <AppShell>
      <section className="max-w-lg mx-auto px-6 py-24 text-center">
        <FileQuestion className="mx-auto h-10 w-10 text-muted-foreground mb-6" />
        <p className="text-sm text-muted-foreground mb-3">404 · Page not found</p>
        <h1 className="text-3xl font-semibold tracking-tight mb-4">That page isn’t here.</h1>
        <p className="text-sm text-muted-foreground leading-relaxed mb-8">The link may be out of date. Return to your overview to find machines, workspaces, and documentation.</p>
        <Link href="/platform" className="premium-btn gap-2"><ArrowLeft size={16} /> Back to overview</Link>
      </section>
    </AppShell>
  );
}