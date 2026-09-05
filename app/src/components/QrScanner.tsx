import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

// Escáner de QR con la cámara. Vía rápida: la API BarcodeDetector
// (Chrome/Edge/Android). Donde no exista —Safari iOS, Firefox— se decodifica cada
// cuadro con jsQR (JS puro, incluido en el bundle, funciona offline). Solo si no
// hay cámara alguna la pantalla de conteo cae a la búsqueda manual.

interface Props {
  onDetectado: (texto: string) => void;
  activo: boolean;
}

type DetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

function tieneBarcodeDetector(): boolean {
  return typeof (globalThis as Record<string, unknown>).BarcodeDetector !== 'undefined';
}

/** Hay forma de escanear con cámara en este navegador (nativa o por jsQR). */
export function soportaEscaneoCamara(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export function QrScanner({ onDetectado, activo }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ultimo = useRef<{ valor: string; t: number }>({ valor: '', t: 0 });

  useEffect(() => {
    if (!activo) return;
    if (!soportaEscaneoCamara()) {
      setError('Este navegador no soporta escaneo de cámara. Usa la búsqueda manual.');
      return;
    }
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelado = false;

    const Detector = tieneBarcodeDetector()
      ? ((globalThis as Record<string, unknown>).BarcodeDetector as {
          new (opts: { formats: string[] }): DetectorLike;
        })
      : null;
    const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;

    const emitir = (valor: string) => {
      const now = Date.now();
      if (valor !== ultimo.current.valor || now - ultimo.current.t > 2500) {
        ultimo.current = { valor, t: now };
        onDetectado(valor);
      }
    };

    const leerConJsQR = (v: HTMLVideoElement) => {
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (!w || !h) return;
      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvasRef.current = canvas;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const res = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
      if (res?.data) emitir(res.data);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelado) return;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        let ultimoJsQR = 0;
        const tick = async () => {
          if (cancelado) return;
          try {
            if (detector) {
              const codes = await detector.detect(v);
              if (codes[0]) emitir(codes[0].rawValue);
            } else {
              // jsQR es más caro: ~6 lecturas por segundo bastan.
              const now = Date.now();
              if (now - ultimoJsQR > 160) {
                ultimoJsQR = now;
                leerConJsQR(v);
              }
            }
          } catch {
            /* cuadro sin código */
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
