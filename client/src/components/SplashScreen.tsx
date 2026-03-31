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
        {/* Modern mesh gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-emerald-950" />
        
        {/* Animated background pattern */}
        <svg className="absolute inset-0 w-full h-full opacity-20" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" opacity="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Animated orbs with improved physics */}
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            animate={{
              x: [0, 40, 0],
              y: [0, 60, 0],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute top-1/4 -left-32 w-96 h-96 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full blur-3xl opacity-20"
          />
          <motion.div
            animate={{
              x: [0, -40, 0],
              y: [0, -60, 0],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut",
              delay: 1,
            }}
            className="absolute bottom-1/4 -right-32 w-96 h-96 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full blur-3xl opacity-20"
          />
          <motion.div
            animate={{
              scale: [1, 1.1, 1],
              opacity: [0.1, 0.15, 0.1],
            }}
            transition={{
              duration: 6,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500 rounded-full blur-3xl"
          />
        </div>

        {/* Vignette overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.5)_100%)]" />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center gap-10 px-8 max-w-2xl">
          {/* Logo container with modern styling */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: -20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="relative"
          >
            {/* Glow effect */}
            <motion.div
              animate={{
                boxShadow: [
                  "0 0 40px rgba(59, 130, 246, 0.3)",
                  "0 0 60px rgba(59, 130, 246, 0.5)",
                  "0 0 40px rgba(59, 130, 246, 0.3)",
                ],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="absolute -inset-8 rounded-3xl"
            />

            {/* Logo background */}
            <div className="relative bg-gradient-to-br from-white/15 to-white/5 backdrop-blur-xl border border-white/20 rounded-2xl p-6 shadow-2xl flex items-center justify-center">
              <img
                src={splashLogo}
                alt="Care Capacity Dashboard"
                width={320}
                height={160}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          </motion.div>

          {/* Headline */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
            className="text-center space-y-3"
          >
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-200 via-cyan-200 to-emerald-200 bg-clip-text text-transparent">
              Care Capacity Dashboard
            </h1>
            <p className="text-blue-200/70 text-base md:text-lg font-medium tracking-wide">
              Intelligent Workforce Management System
            </p>
          </motion.div>

          {/* Loading indicator */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
            className="w-full max-w-sm space-y-4"
          >
            {/* Progress bar with modern design */}
            <div className="relative h-1.5 bg-white/5 rounded-full overflow-hidden backdrop-blur-sm border border-white/10">
              <motion.div
                className="h-full bg-gradient-to-r from-blue-400 via-cyan-400 via-emerald-400 to-blue-400 rounded-full shadow-lg shadow-blue-400/50"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(progress, 100)}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
              {/* Shimmer effect */}
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                animate={{
                  x: ["0%", "100%"],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
            </div>

            {/* Loading text with animation */}
            <motion.p
              key={loadingText}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.3 }}
              className="text-blue-200/60 text-sm text-center font-medium tracking-wide"
            >
              {loadingText}
            </motion.p>

            {/* Progress percentage */}
            <div className="flex items-center justify-center gap-2">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{
                      opacity: [0.4, 1, 0.4],
                      scale: [0.8, 1, 0.8],
                    }}
                    transition={{
                      duration: 1.5,
                      delay: i * 0.2,
                      repeat: Infinity,
                    }}
                    className="w-2 h-2 bg-blue-400 rounded-full"
                  />
                ))}
              </div>
              <span className="text-white/40 text-xs font-medium">{Math.round(progress)}%</span>
            </div>
          </motion.div>

          {/* Footer branding */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="absolute bottom-8 text-center"
          >
            <p className="text-white/30 text-xs font-medium tracking-widest uppercase">
              Powered by Home Instead Care
            </p>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
