import { useEffect, useState } from 'react';

/** Follows the system "reduce motion" setting. */
export function useSystemMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const setting = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!setting) return;
    const update = () => setReduced(setting.matches);
    setting.addEventListener('change', update);
    return () => setting.removeEventListener('change', update);
  }, []);
  return reduced;
}
