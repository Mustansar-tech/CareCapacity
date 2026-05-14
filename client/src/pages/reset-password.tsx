import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Eye, EyeOff, KeyRound, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest } from "@/lib/queryClient";
import homeInsteadLogo from "@/assets/splash-logo.png";

const SUPABASE_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|<>?,./`~]).{8,}$/;

const resetSchema = z.object({
  newPassword: z.string().regex(
    SUPABASE_PASSWORD_REGEX,
    "Must be 8+ chars with uppercase, lowercase, number and special character"
  ),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine(d => d.newPassword === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type ResetForm = z.infer<typeof resetSchema>;

export default function ResetPasswordPage() {
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ResetForm>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const token = params.get("access_token");
    const type = params.get("type");

    if (!token) {
      setTokenError("No reset token found. Please request a new password reset link.");
      return;
    }
    if (type !== "recovery") {
      setTokenError("This link is not a password reset link. Please request a new one.");
      return;
    }
    setAccessToken(token);

    // Clean the token from the URL bar without a page reload
    history.replaceState(null, "", window.location.pathname);
  }, []);

  const onSubmit = async (data: ResetForm) => {
    if (!accessToken) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/auth/reset-password", {
        accessToken,
        newPassword: data.newPassword,
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-8"
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <img src={homeInsteadLogo} alt="Care Capacity" className="h-10 object-contain" />
        </div>

        {tokenError ? (
          /* Invalid / missing token */
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <AlertCircle className="h-12 w-12 text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Invalid reset link</h1>
            <p className="text-sm text-muted-foreground">{tokenError}</p>
            <Link href="/login">
              <Button variant="outline" className="gap-2 mt-2">
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Button>
            </Link>
          </div>
        ) : done ? (
          /* Success */
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center space-y-4"
          >
            <div className="flex justify-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Password updated</h1>
            <p className="text-sm text-muted-foreground">
              Your password has been changed successfully. You can now sign in with your new password.
            </p>
            <Link href="/login">
              <Button className="mt-2 bg-blue-600 hover:bg-blue-700 text-white gap-2">
                <ArrowLeft className="h-4 w-4" /> Go to sign in
              </Button>
            </Link>
          </motion.div>
        ) : (
          /* Reset form */
          <>
            <div className="mb-7">
              <div className="flex items-center gap-2 mb-1">
                <KeyRound className="h-5 w-5 text-blue-500" />
                <h1 className="text-xl font-bold text-foreground">Set a new password</h1>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                8+ chars · uppercase · lowercase · number · special character
              </p>
            </div>

            {error && (
              <div className="mb-5 p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="newPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold">New password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showNew ? "text" : "password"}
                          placeholder="Enter new password"
                          autoComplete="new-password"
                          className="h-11 pr-10 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 focus:border-blue-500"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowNew(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold">Confirm password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showConfirm ? "text" : "password"}
                          placeholder="Re-enter new password"
                          autoComplete="new-password"
                          className="h-11 pr-10 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 focus:border-blue-500"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowConfirm(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-11 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 transition-all"
                >
                  {isSubmitting ? (
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      <span>Updating…</span>
                    </div>
                  ) : "Update password"}
                </Button>
              </form>
            </Form>
          </>
        )}
      </motion.div>
    </div>
  );
}
