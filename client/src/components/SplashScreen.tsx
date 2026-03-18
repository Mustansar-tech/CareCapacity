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
      "Initializing system...",
      "Loading workforce data...",
      "Preparing workspace...",
      "Finalizing setup...",
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
        {/* Premium gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900" />
        
        {/* Subtle animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 -left-96 w-[800px] h-[800px] bg-blue-600/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 -right-96 w-[800px] h-[800px] bg-emerald-600/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-blue-500/5 rounded-full blur-3xl" />
        </div>

        {/* Premium overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.5)_100%)]" />

        {/* Main content */}
        <div className="relative z-10 flex flex-col items-center justify-center gap-12 px-8 py-16 max-w-4xl">
          
          {/* Large Logo Section */}
          <motion.div
            initial={{ scale: 0.3, opacity: 0, y: -40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: "easeOut", type: "spring", stiffness: 100, damping: 15 }}
            className="relative"
          >
            {/* Subtle glow effect */}
            <motion.div
              className="absolute -inset-20 bg-gradient-to-r from-blue-600/30 via-emerald-500/30 to-blue-600/30 rounded-full blur-3xl"
              animate={{ 
                opacity: [0.3, 0.5, 0.3]
              }}
              transition={{ 
                duration: 5,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            />
            
            {/* Premium logo container */}
            <motion.div
              className="relative bg-gradient-to-b from-white/15 to-white/5 backdrop-blur-2xl border border-white/20 rounded-4xl p-12 shadow-2xl"
              style={{
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.1)"
              }}
              animate={{ 
                y: [0, -8, 0]
              }}
              transition={{ 
                duration: 6,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            >
              <motion.img
                src={splashLogo}
                alt="Care Capacity Dashboard"
                className="w-[280px] h-[280px] object-contain drop-shadow-2xl"
                animate={{ 
                  scale: [1, 1.03, 1]
                }}
                transition={{ 
                  duration: 5,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              />
            </motion.div>
          </motion.div>

          {/* Title and subtitle */}
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
            className="text-center space-y-3"
          >
            <h1 className="text-5xl md:text-6xl font-black bg-gradient-to-r from-white via-blue-100 to-emerald-100 bg-clip-text text-transparent">
              Care Capacity Dashboard
            </h1>
            <p className="text-lg md:text-xl text-blue-200/90 font-light tracking-wide">
              Enterprise Workforce Intelligence Platform
            </p>
          </motion.div>

          {/* Loading bar */}
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5, ease: "easeOut" }}
            className="w-full max-w-lg space-y-4"
          >
            <div className="h-2 bg-white/5 rounded-full overflow-hidden backdrop-blur-sm border border-white/10">
              <motion.div
                className="h-full bg-gradient-to-r from-blue-500 via-emerald-400 to-blue-500 rounded-full shadow-lg shadow-blue-500/50"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(progress, 100)}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
            <motion.p 
              className="text-sm text-blue-200/70 text-center font-medium tracking-wide"
              key={loadingText}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {loadingText}
            </motion.p>
          </motion.div>

          {/* Footer branding */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.8 }}
            className="text-center space-y-2 pt-4"
          >
            <p className="text-xs text-blue-200/50 font-semibold tracking-widest uppercase">
              Enterprise Edition
            </p>
            <div className="h-px w-12 mx-auto bg-gradient-to-r from-transparent via-blue-400 to-transparent" />
            <p className="text-xs text-blue-200/60 font-medium">
              Powering intelligent care workforce management
            </p>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
