import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import splashLogo from "@/assets/splash-logo.png";

interface SplashScreenProps {
  onComplete: () => void;
  minimumDisplayTime?: number;
}

export function SplashScreen({ onComplete, minimumDisplayTime = 2000 }: SplashScreenProps) {
  const [progress, setProgress] = useState(0);
  const [loadingText, setLoadingText] = useState("Initializing...");

  useEffect(() => {
    const loadingMessages = [
      "Initializing...",
      "Loading modules...",
      "Preparing workspace...",
      "Almost ready...",
    ];

    let messageIndex = 0;
    const messageInterval = setInterval(() => {
      messageIndex = (messageIndex + 1) % loadingMessages.length;
      setLoadingText(loadingMessages[messageIndex]);
    }, 600);

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        return prev + Math.random() * 15 + 5;
      });
    }, 200);

    const timer = setTimeout(() => {
      clearInterval(messageInterval);
      clearInterval(progressInterval);
      setProgress(100);
      setTimeout(onComplete, 400);
    }, minimumDisplayTime);

    return () => {
      clearTimeout(timer);
      clearInterval(messageInterval);
      clearInterval(progressInterval);
    };
  }, [onComplete, minimumDisplayTime]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
        className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900" />
        
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 -left-32 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-3xl" />
        </div>

        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.4)_100%)]" />

        <div className="relative z-10 flex flex-col items-center gap-8 px-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="relative"
          >
            <div className="absolute inset-0 bg-white/20 rounded-3xl blur-xl scale-110" />
            <div className="relative bg-white/10 backdrop-blur-xl border border-white/20 rounded-full p-0 shadow-2xl overflow-hidden flex items-center justify-center w-64 h-64">
              <img
                src={splashLogo}
                alt="Care Capacity Dashboard"
                className="w-full h-full object-cover"
              />
            </div>
          </motion.div>

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
            className="text-center"
          >
            <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-white via-blue-100 to-white bg-clip-text text-transparent mb-2">
              Care Capacity Dashboard
            </h1>
            <p className="text-blue-200/80 text-sm md:text-base font-medium tracking-wide">
              Intelligent Workforce Management System
            </p>
          </motion.div>

          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
            className="w-64 md:w-80"
          >
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
              <motion.div
                className="h-full bg-gradient-to-r from-blue-400 via-emerald-400 to-blue-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(progress, 100)}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>
            <p className="text-blue-200/60 text-xs text-center mt-3 font-medium">
              {loadingText}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center"
          >
            <p className="text-white/40 text-xs font-medium tracking-wider uppercase">
              Powered by
            </p>
            <p className="text-white/60 text-sm font-semibold mt-1">
              Care Capacity Dashboard
            </p>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
