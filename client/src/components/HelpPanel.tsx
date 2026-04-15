import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { HelpCircle, Mail, Copy, Check, Bug, ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useBranch } from "@/contexts/BranchContext";

const SUPPORT_EMAIL = "support@homeinstead.co.uk";

const bugReportSchema = z.object({
  title: z.string().min(1, "Please enter a title").max(200),
  description: z.string().min(1, "Please describe the issue").max(5000),
  stepsToReproduce: z.string().max(5000).optional(),
});

type BugReportForm = z.infer<typeof bugReportSchema>;

type PanelView = "main" | "bug";

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

export function HelpPanel({ open, onClose }: HelpPanelProps) {
  const [view, setView] = useState<PanelView>("main");
  const [copied, setCopied] = useState(false);
  const { selectedBranchId } = useBranch();
  const { toast } = useToast();

  const form = useForm<BugReportForm>({
    resolver: zodResolver(bugReportSchema),
    defaultValues: { title: "", description: "", stepsToReproduce: "" },
  });

  const mutation = useMutation({
    mutationFn: async (data: BugReportForm) => {
      const res = await apiRequest("POST", "/api/feedback", {
        type: "bug",
        title: data.title,
        description: data.description,
        stepsToReproduce: data.stepsToReproduce || null,
        branchId: selectedBranchId || null,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to submit report");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Report submitted",
        description: "Thank you — your bug report has been sent to the team.",
      });
      form.reset();
      setView("main");
      onClose();
    },
    onError: (err: Error) => {
      toast({
        variant: "destructive",
        title: "Submission failed",
        description: err.message,
      });
    },
  });

  function handleCopy() {
    navigator.clipboard.writeText(SUPPORT_EMAIL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleEmailSupport() {
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Support request")}`;
  }

  function handleClose() {
    setView("main");
    form.reset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={open => !open && handleClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl border-0 shadow-2xl">
        {view === "main" && (
          <>
            <DialogHeader className="items-center text-center gap-2 pt-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <HelpCircle className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <DialogTitle className="text-lg font-bold text-gray-900 dark:text-white">
                Help &amp; Support
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-500 dark:text-gray-400">
                Get in touch or report a problem with the dashboard.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 mt-2">
              {/* Support email */}
              <div
                className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl p-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                onClick={handleEmailSupport}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Mail className="h-4 w-4 text-blue-500" />
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                    Contact Support
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-gray-900 dark:text-white break-all">
                    {SUPPORT_EMAIL}
                  </p>
                  <button
                    onClick={handleCopy}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors flex-shrink-0"
                    title="Copy email address"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                  For access issues, data questions, or urgent scheduling problems, email the support team directly.
                </p>
              </div>

              {/* Report a bug */}
              <button
                onClick={() => setView("bug")}
                className="w-full flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0">
                  <Bug className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Report a Bug</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Something not working as expected? Let us know.
                  </p>
                </div>
              </button>
            </div>
          </>
        )}

        {view === "bug" && (
          <>
            <DialogHeader className="gap-2 pt-2">
              <button
                onClick={() => { setView("main"); form.reset(); }}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors mb-1 self-start"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                  <Bug className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-gray-900 dark:text-white">
                    Report a Bug
                  </DialogTitle>
                  <DialogDescription className="text-xs text-gray-500 dark:text-gray-400">
                    Describe what went wrong and we'll look into it.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="space-y-4 mt-1">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Title <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Map not loading after upload"
                          className="h-9 text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Description <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="What happened? What did you expect to happen?"
                          className="min-h-[90px] text-sm resize-none"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="stepsToReproduce"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Steps to reproduce{" "}
                        <span className="text-gray-400 font-normal">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="1. Go to...&#10;2. Click on...&#10;3. See error"
                          className="min-h-[70px] text-sm resize-none"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setView("main"); form.reset(); }}
                    className="flex-1 rounded-xl h-9"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={mutation.isPending}
                    className="flex-1 rounded-xl h-9 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold shadow-md"
                  >
                    {mutation.isPending ? (
                      <div className="flex items-center gap-2">
                        <div className="h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Sending...
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Send className="h-3.5 w-3.5" />
                        Send Report
                      </div>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
