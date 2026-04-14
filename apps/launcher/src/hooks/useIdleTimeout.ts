import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const TOUCH_EVENTS = ['mousedown', 'mousemove', 'touchstart', 'touchmove', 'keydown', 'scroll'] as const;

/**
 * Reset to home route after `timeoutSeconds` of inactivity.
 * Pass `disabled: true` to pause the timer (e.g. while an iframe demo is active).
 */
export function useIdleTimeout(timeoutSeconds: number, disabled = false): void {
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (disabled) return;
    timerRef.current = setTimeout(() => {
      navigate('/', { replace: true });
    }, timeoutSeconds * 1000);
  }, [navigate, timeoutSeconds, disabled]);

  useEffect(() => {
    resetTimer();
    if (disabled) return;
    const handler = () => resetTimer();
    TOUCH_EVENTS.forEach((evt) => window.addEventListener(evt, handler, { passive: true }));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      TOUCH_EVENTS.forEach((evt) => window.removeEventListener(evt, handler));
    };
  }, [resetTimer, disabled]);
}
