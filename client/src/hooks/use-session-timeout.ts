import { useState, useEffect, useRef, useCallback } from 'react';

const INACTIVE_TIMEOUT_MS = 30 * 60 * 1000;   // 30 minutes
const WARN_BEFORE_MS      =  5 * 60 * 1000;   // warn 5 minutes before auto-logout

const ACTIVITY_EVENTS = [
  'mousemove',
  'keydown',
  'mousedown',
  'touchstart',
  'scroll',
  'pointerdown',
  'wheel',
] as const;

interface UseSessionTimeoutOptions {
  onExpire: () => void;
}

export function useSessionTimeout({ onExpire }: UseSessionTimeoutOptions) {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  const warnTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expireTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdown    = useRef<ReturnType<typeof setInterval> | null>(null);
  const onExpireRef  = useRef(onExpire);

  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  const clearAllTimers = useCallback(() => {
    if (warnTimer.current)   clearTimeout(warnTimer.current);
    if (expireTimer.current) clearTimeout(expireTimer.current);
    if (countdown.current)   clearInterval(countdown.current);
    warnTimer.current   = null;
    expireTimer.current = null;
    countdown.current   = null;
  }, []);

  const startTimers = useCallback(() => {
    clearAllTimers();
    setSecondsRemaining(null);

    warnTimer.current = setTimeout(() => {
      const warnSecs = Math.floor(WARN_BEFORE_MS / 1000);
      setSecondsRemaining(warnSecs);

      countdown.current = setInterval(() => {
        setSecondsRemaining(prev => {
          if (prev === null || prev <= 1) {
            if (countdown.current) clearInterval(countdown.current);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    }, INACTIVE_TIMEOUT_MS - WARN_BEFORE_MS);

    expireTimer.current = setTimeout(() => {
      clearAllTimers();
      setSecondsRemaining(null);
      onExpireRef.current();
    }, INACTIVE_TIMEOUT_MS);
  }, [clearAllTimers]);

  const extend = useCallback(() => {
    startTimers();
  }, [startTimers]);

  useEffect(() => {
    // Only restart timers on activity when warning is NOT showing —
    // once the dialog is visible, the user must explicitly act.
    const handleActivity = () => {
      setSecondsRemaining(prev => {
        if (prev !== null) return prev; // warning is showing — ignore passive activity
        startTimers();
        return null;
      });
    };

    ACTIVITY_EVENTS.forEach(ev =>
      document.addEventListener(ev, handleActivity, { passive: true })
    );

    // Kick off the initial timer when the hook mounts
    startTimers();

    return () => {
      ACTIVITY_EVENTS.forEach(ev =>
        document.removeEventListener(ev, handleActivity)
      );
      clearAllTimers();
    };
  }, [startTimers, clearAllTimers]);

  return {
    showWarning: secondsRemaining !== null,
    secondsRemaining: secondsRemaining ?? 0,
    extend,
  };
}
