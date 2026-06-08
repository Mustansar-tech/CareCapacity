import { useState } from "react";
import { Shield, FileText, Cookie, CheckSquare, Square, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { CURRENT_LEGAL_VERSION } from "@shared/schema";

interface LegalConsentModalProps {
  open: boolean;
}

export function LegalConsentModal({ open }: LegalConsentModalProps) {
  const [checked, setChecked] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const qc = useQueryClient();

  const handleAccept = async () => {
    if (!checked) return;
    setIsAccepting(true);
    try {
      await apiRequest("POST", "/api/auth/accept-legal", { version: CURRENT_LEGAL_VERSION });
      await qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch {
      setIsAccepting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-lg rounded-2xl border-0 shadow-2xl"
        onPointerDownOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
        hideCloseButton
      >
        <DialogHeader className="items-center text-center gap-3 pt-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
            <Shield className="w-7 h-7 text-blue-600 dark:text-blue-400" />
          </div>
          <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white">
            Legal Documents — Version {CURRENT_LEGAL_VERSION}
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-gray-600 dark:text-gray-400">
            Before you continue, please review and accept our updated legal documents. These cover how we handle your data and the terms of your access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 my-2">
          <a
            href="/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <Shield className="h-4 w-4 text-blue-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Privacy Policy</p>
                <p className="text-xs text-muted-foreground">How we handle personal data</p>
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </a>

          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-4 w-4 text-indigo-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Terms &amp; Conditions</p>
                <p className="text-xs text-muted-foreground">Your obligations and permitted use</p>
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </a>

          <a
            href="/cookies"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <Cookie className="h-4 w-4 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Cookie Policy</p>
                <p className="text-xs text-muted-foreground">How we use cookies and session data</p>
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </a>
        </div>

        <button
          type="button"
          onClick={() => setChecked(v => !v)}
          className="flex items-start gap-3 w-full text-left p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <div className="mt-0.5 shrink-0">
            {checked
              ? <CheckSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              : <Square className="h-4 w-4 text-muted-foreground" />
            }
          </div>
          <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
            I have read and agree to the Privacy Policy, Terms &amp; Conditions, and Cookie Policy (v{CURRENT_LEGAL_VERSION}, effective 8 June 2026).
          </p>
        </button>

        <Button
          onClick={handleAccept}
          disabled={!checked || isAccepting}
          className="w-full h-11 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isAccepting ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              <span>Saving…</span>
            </div>
          ) : (
            "Accept & Continue"
          )}
        </Button>

        <p className="text-center text-xs text-muted-foreground pb-1">
          You must accept to continue using the Care Capacity Dashboard.
        </p>
      </DialogContent>
    </Dialog>
  );
}
