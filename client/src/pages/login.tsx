import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, LogIn, Shield, AlertCircle, Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import homeInsteadLogo from "@/assets/splash-logo.png";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

const SLIDES = [
  {
    image: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=1400&q=85&auto=format&fit=crop",
    headline: "Intelligent Care Scheduling",
    sub: "Optimise every Care Pro's day with AI-powered workforce planning.",
  },
  {
    image: "https://images.unsplash.com/photo-1582213782179-e0d53f98f2ca?w=1400&q=85&auto=format&fit=crop",
    headline: "Empower Your Team",
    sub: "Give coordinators real-time visibility across every branch and shift.",
  },
  {
    image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1400&q=85&auto=format&fit=crop",
    headline: "Capacity at a Glance",
    sub: "Instantly see gaps, surpluses and opportunities — across the whole week.",
  },
];

function ImageCarousel() {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent(prev => (prev + 1) % SLIDES.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Slides */}
      <AnimatePresence mode="wait">
        <motion.div
          key={current}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.9, ease: "easeInOut" }}
          className="absolute inset-0"
        >
          <img
            src={SLIDES[current].image}
            alt={SLIDES[current].headline}
            className="w-full h-full object-cover"
          />
        </motion.div>
      </AnimatePresence>

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-blue-900/30 to-transparent" />

      {/* Bottom text + dots */}
      <div className="absolute bottom-0 left-0 right-0 p-10 z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={`text-${current}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <h2 className="text-3xl font-bold text-white leading-snug mb-2 drop-shadow-md">
              {SLIDES[current].headline}
            </h2>
            <p className="text-white/75 text-base leading-relaxed max-w-xs">
              {SLIDES[current].sub}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Progress dots */}
        <div className="flex items-center gap-2 mt-6">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`transition-all duration-300 rounded-full ${
                i === current
                  ? "w-8 h-2 bg-white"
                  : "w-2 h-2 bg-white/40 hover:bg-white/60"
              }`}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Forgot Password inline panel ─────────────────────────────────────────────

const forgotSchema = z.object({ email: z.string().email("Please enter a valid email address") });
type ForgotForm = z.infer<typeof forgotSchema>;

function ForgotPasswordPanel({ onBack }: { onBack: () => void }) {
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: ForgotForm) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/auth/forgot-password", { email: data.email });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message);
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </button>

      <div className="mb-7">
        <div className="flex items-center gap-2 mb-1">
          <Mail className="h-5 w-5 text-blue-500" />
          <h2 className="text-xl font-bold text-foreground">Reset your password</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Enter your email and we'll send you a reset link.
        </p>
      </div>

      {sent ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/50 flex items-start gap-3"
        >
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Check your inbox</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
              If that email is registered, a reset link has been sent. Check your spam folder if you don't see it within a minute.
            </p>
          </div>
        </motion.div>
      ) : (
        <>
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-semibold text-foreground">Email address</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder="you@homeinstead.com"
                      autoComplete="email"
                      className="h-11 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500/20 transition-all"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-11 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 transition-all duration-200"
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    <span>Sending…</span>
                  </div>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </form>
          </Form>
        </>
      )}
    </motion.div>
  );
}

// ─── Main login page ───────────────────────────────────────────────────────────

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (data: LoginForm) => {
    setIsSubmitting(true);
    setLoginError(null);
    try {
      await login(data.email, data.password);
      toast({ title: "Welcome back", description: "You have successfully signed in." });
      navigate("/");
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : "Invalid email or password. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel: login form ── */}
      <div className="flex items-center justify-center bg-white dark:bg-gray-950 p-8 relative overflow-hidden w-full lg:w-[380px] xl:w-[420px] flex-shrink-0 shadow-xl z-10">
        {/* Subtle background blobs */}
        <div className="absolute -top-32 -right-32 w-72 h-72 bg-blue-400/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 w-72 h-72 bg-emerald-400/8 rounded-full blur-3xl pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative w-full max-w-md"
        >
          {/* Logo & branding */}
          <div className="text-center mb-10">
            <div className="flex justify-center mb-5">
              <div className="relative">
                <div className="absolute inset-0 bg-blue-500/10 rounded-xl blur-lg" />
                <img
                  src={homeInsteadLogo}
                  alt="Care Capacity"
                  width={320}
                  height={64}
                  className="relative h-14 max-w-xs object-contain rounded-xl"
                />
              </div>
            </div>
            <h1 className="text-2xl font-display font-bold bg-gradient-to-r from-blue-600 via-emerald-600 to-blue-600 bg-clip-text text-transparent">
              Care Capacity Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1 font-medium">Workforce Intelligence Platform</p>
          </div>

          <AnimatePresence mode="wait">
            {showForgot ? (
              <ForgotPasswordPanel key="forgot" onBack={() => setShowForgot(false)} />
            ) : (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3 }}
              >
                {/* Sign-in divider */}
                <div className="flex items-center gap-3 mb-7">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                    Sign In
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Error banner */}
                {loginError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mb-5 p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 flex items-start gap-2"
                  >
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700 dark:text-red-400">{loginError}</p>
                  </motion.div>
                )}

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-foreground">Email address</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="email"
                              placeholder="you@homeinstead.com"
                              autoComplete="email"
                              className="h-11 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500/20 transition-all"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel className="text-sm font-semibold text-foreground">Password</FormLabel>
                            <button
                              type="button"
                              onClick={() => setShowForgot(true)}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              Forgot password?
                            </button>
                          </div>
                          <FormControl>
                            <div className="relative">
                              <Input
                                {...field}
                                type={showPassword ? "text" : "password"}
                                placeholder="Enter your password"
                                autoComplete="current-password"
                                className="h-11 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500/20 transition-all pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                tabIndex={-1}
                              >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      className="w-full h-11 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transition-all duration-200 mt-1"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          <span>Signing in...</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <LogIn className="h-4 w-4" />
                          <span>Sign in</span>
                        </div>
                      )}
                    </Button>
                  </form>
                </Form>

                {/* Footer */}
                <div className="mt-8 pt-6 border-t border-border text-center space-y-3">
                  <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                    <Shield className="h-3.5 w-3.5" />
                    <span>Enterprise authentication · Data encrypted in transit</span>
                  </div>
                  <div className="flex items-center justify-center gap-3 text-xs text-gray-400 dark:text-gray-600">
                    <Link href="/privacy" className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors">
                      Privacy Policy
                    </Link>
                    <span aria-hidden="true">·</span>
                    <Link href="/terms" className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors">
                      Terms &amp; Conditions
                    </Link>
                    <span aria-hidden="true">·</span>
                    <Link href="/cookies" className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors">
                      Cookie Policy
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* ── Right panel: image carousel (hidden on mobile) ── */}
      <div className="hidden lg:block flex-1 relative">
        <ImageCarousel />
      </div>
    </div>
  );
}
