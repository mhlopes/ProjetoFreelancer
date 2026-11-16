'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

/** Mensagem de resultado da última ação, anunciada por leitores de tela. */
export function Flash() {
  const sp = useSearchParams();
  const ok = sp.get('ok'), erro = sp.get('erro');
  if (!ok && !erro) return null;
  return erro
    ? <div className="note bad" role="alert"><strong>Não foi possível: </strong>{erro}</div>
    : <div className="note ok" role="status">{ok}</div>;
}

/** Atualiza os dados da página periodicamente (chat, propostas, estado do contrato) sem perder o que está digitado. */
export function AutoRefresh({ seconds = 8 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** Botão de envio que desabilita durante o envio (evita clique duplo). */
export function Submit({ children, className = 'btn', name, value }: { children: React.ReactNode; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending} name={name} value={value}>{pending ? 'Enviando…' : children}</button>;
}

/** Localização opcional, somente com consentimento explícito do usuário. */
export function GeoFields({ lat, lng }: { lat?: number | null; lng?: number | null }) {
  const [pos, setPos] = useState<{ lat: string; lng: string }>({ lat: lat != null ? String(lat) : '', lng: lng != null ? String(lng) : '' });
  const [msg, setMsg] = useState('');
  const locate = () => {
    if (!navigator.geolocation) return setMsg('Seu navegador não oferece localização. Tudo bem: usaremos a cidade informada.');
    setMsg('Obtendo localização…');
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }); setMsg('Localização obtida. Ela não é exibida publicamente.'); },
      () => setMsg('Sem permissão de localização. Tudo bem: usaremos a cidade informada.'),
      { timeout: 10000 },
    );
  };
  return (
    <div className="field">
      <input type="hidden" name="lat" value={pos.lat} />
      <input type="hidden" name="lng" value={pos.lng} />
      <div className="row">
        <button type="button" className="btn ghost small" onClick={locate}>Usar minha localização atual</button>
        {pos.lat && <button type="button" className="linkbtn" onClick={() => { setPos({ lat: '', lng: '' }); setMsg('Localização removida.'); }}>Remover</button>}
      </div>
      <span className="hint" role="status">{msg || (pos.lat ? 'Localização salva (privada). Melhora o cálculo de distância.' : 'Opcional. Sem ela, o pareamento usa a cidade.')}</span>
    </div>
  );
}

/** Contagem regressiva textual até um instante (não depende de cor nem som). */
export function Countdown({ until, expiredText = 'prazo encerrado' }: { until: string; expiredText?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  if (now == null) return <span>…</span>;
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return <span>{expiredText}</span>;
  const m = Math.ceil(ms / 60000), h = Math.floor(m / 60);
  return <span>{h > 0 ? `${h}h ${m % 60}min` : `${m} min`}</span>;
}
