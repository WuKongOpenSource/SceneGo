import { useEffect, useState } from 'react';

export function useCancellationSeconds(deadline?: number): number {
  const remaining = () => Math.max(0, Math.ceil(((deadline || 0) * 1000 - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(remaining);
  useEffect(() => {
    setSeconds(remaining());
    if (!deadline || deadline * 1000 <= Date.now()) return;
    const timer = setInterval(() => {
      const value = remaining();
      setSeconds(value);
      if (!value) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [deadline]);
  return seconds;
}
