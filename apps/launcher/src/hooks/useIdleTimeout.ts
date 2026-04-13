import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const TOUCH_EVENTS = ['mousedown', 'mousemove', 'touchstart', 'touchmove', 'keydown', 'scroll'] as const;

/**
 * Reset to home route after `timeoutSeconds` of inactivity.
 */
export function useIdleTimeout(timeoutSeconds: number): void {
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      navigate('/', { replace: true });
    }, timeoutSeconds * 1000);
  }, [navigate, timeoutSeconds]);

  useEffect(() => {
    resetTimer();
    const handler = () => resetTimer();
    TOUCH_EVENTS.forEach((evt) => window.addEventListener(evt, handler, { passive: true }));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      TOUCH_EVENTS.forEach((evt) => window.removeEventListener(evt, handler));
    };
  }, [resetTimer]);
}
