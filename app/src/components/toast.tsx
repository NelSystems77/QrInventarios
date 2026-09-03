import { useEffect, useState } from 'react';

let setter: ((msg: string | null) => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string) {
  setter?.(msg);
  clearTimeout(timer);
  timer = setTimeout(() => setter?.(null), 4000);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setter = setMsg;
    return () => {
      setter = null;
    };
  }, []);
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}
