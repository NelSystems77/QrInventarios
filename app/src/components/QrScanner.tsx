import { useEffect, useRef, useState } from 'react';

// Escáner de QR con la API BarcodeDetector (Chrome/Edge/Android — el target de
// piso de bodega). Donde no exista, el componente se muestra deshabilitado y la
// pantalla de conteo ofrece la búsqueda manual como alternativa.

interface Props {
  onDetectado: (texto: string) => void;
  activo: boolean;
}

type DetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

export function soportaBarcodeDetector(): boolean {
  return typeof (globalThis as Record<string, unknown>).BarcodeDetector !== 'undefined';
}

export function QrScanner({ onDetectado, activo }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const ultimo = useRef<{ valor: string; t: number }>({ valor: '', t: 0 });

  useEffect(() => {
    if (!activo) return;
    if (!soportaBarcodeDetector()) {
      setError('Este navegador no soporta escaneo de cámara. Usa la búsqueda manual.');
      return;
    }
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelado = false;

    const Detector = (globalThis as Record<string, unknown>).BarcodeDetector as {
      new (opts: { formats: string[] }): DetectorLike;
    };
    const detector = new Detector({ formats: ['qr_code'] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelado) return;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        const tick = async () => {
          if (cancelado) return;
          try {
            const codes = await detector.detect(v);
            if (codes[0]) {
              const valor = codes[0].rawValue;
              const now = Date.now();
              if (valor !== ultimo.current.valor || now - ultimo.current.t > 2500) {
                ultimo.current = { valor, t: now };
                onDetectado(valor);
              }
            }
          } catch {
            /* frame sin código */
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setError('No se pudo acceder a la cámara. Revisa los permisos.');
      }
    })();

    return () => {
      cancelado = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [activo, onDetectado]);

  if (error) return <p className="badge warn" style={{ display: 'block' }}>{error}</p>;

  return (
    <div style={{ position: 'relative', maxWidth: 360 }}>
      <video
        ref={videoRef}
        style={{
          width: '100%',
          borderRadius: 8,
          background: '#000',
          aspectRatio: '4/3',
          objectFit: 'cover',
        }}
        muted
        playsInline
      />
      <div
        style={{
          position: 'absolute',
          inset: '18% 18%',
          border: '2px solid rgba(255,255,255,.85)',
          borderRadius: 8,
        }}
      />
    </div>
  );
}
