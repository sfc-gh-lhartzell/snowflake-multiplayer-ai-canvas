import { Suspense } from "react";
import { CanvasShell } from "@/components/workspace/CanvasShell";
import { CocoLoading } from "@/components/coco/Coco";

export const dynamic = "force-dynamic";

export default async function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="min-h-screen bg-[color:var(--color-surface-base)]">
      <Suspense fallback={<div className="h-screen"><CocoLoading label="Sledding into the canvas…" /></div>}>
        <CanvasShell canvasId={id} />
      </Suspense>
    </main>
  );
}
