import { useEffect, useState } from 'react';

export function useDelayed(key: string | null): boolean {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    setReady(null);
    if (!key) return;
    const timer = window.setTimeout(() => setReady(key), 300);
    return () => window.clearTimeout(timer);
  }, [key]);
  return key !== null && key === ready;
}
