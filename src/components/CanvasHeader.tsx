"use client";

import { useState } from "react";
import { BrandLockup } from "./Brand";
import { PresenceStrip } from "./PresenceStrip";
import { Pill } from "./ui/Pill";
import { Button } from "./ui/Button";
import { Share2, RefreshCw, History, Check, Sun, Moon, PanelRightOpen } from "lucide-react";
import { PriorSessionsMenu } from "./PriorSessionsMenu";
import { toggleTheme } from "@/lib/theme";
import { useTheme } from "@/lib/use-theme";
import { useCanvas, type ConnState } from "@/lib/canvas-events";

export type { ConnState };

export function CanvasHeader({
  onNewSession,
  onLoadContext,
  chatHidden,
  onShowChat,
}: {
  onNewSession?: () => void;
  onLoadContext?: (threadId: number) => void;
  chatHidden?: boolean;
  onShowChat?: () => void;
}) {
  const { canvasId, me, users: presence, conn } = useCanvas();
  const [priorOpen, setPriorOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const theme = useTheme();

  const { tone, label } =
    conn === "live"
      ? { tone: "success" as const, label: "Live" }
      : conn === "connecting"
      ? { tone: "warn" as const, label: "Connecting…" }
      : { tone: "danger" as const, label: "Disconnected" };

  return (
    <header className="z-10 shrink-0 px-5 pt-4">
      <div className="neu-raised-sm flex items-center gap-4 rounded-[22px] px-5 py-2.5">
        <BrandLockup />
        <Pill tone={tone} dot pulsing>
          {label}
        </Pill>
        <div className="ml-auto flex items-center gap-2">
          <PresenceStrip users={presence} me={me} />
          {chatHidden && onShowChat ? (
            <Button variant="secondary" size="sm" onClick={onShowChat}>
              <PanelRightOpen className="h-3.5 w-3.5" />
              Chat
            </Button>
          ) : null}
          {onLoadContext ? (
            <div className="relative">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPriorOpen((v) => !v)}
              >
                <History className="h-3.5 w-3.5" />
                Load prior context
              </Button>
              <PriorSessionsMenu
                canvasId={canvasId}
                open={priorOpen}
                onClose={() => setPriorOpen(false)}
                onPick={(threadId) => onLoadContext(threadId)}
              />
            </div>
          ) : null}
          {onNewSession ? (
            <Button variant="secondary" size="sm" onClick={onNewSession}>
              <RefreshCw className="h-3.5 w-3.5" />
              New session
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (typeof window !== "undefined") {
                const url = `${window.location.origin}/canvas/${encodeURIComponent(canvasId)}`;
                const invite = `I'm in an agent canvas on Snowflake. Join me: ${url}`;
                void navigator.clipboard.writeText(invite);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }
            }}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Invite copied
              </>
            ) : (
              <>
                <Share2 className="h-3.5 w-3.5" />
                Invite others
              </>
            )}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              toggleTheme();
            }}
            aria-label={
              theme === "halloween"
                ? "Exit halloween mode"
                : theme === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
          >
            {theme === "halloween" ? (
              <span className="text-[14px] leading-none">🎃</span>
            ) : theme === "dark" ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
