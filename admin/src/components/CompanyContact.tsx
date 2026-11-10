// =====================================================================
//  MAWASILIANO YA KAMPUNI (DUKALANGU SOLUTION) — yanatoka kwenye wasifu wa biashara (Owner → Business Center).
//  Hakuna namba wala email iliyoandikwa kwenye code: Owner akibadilisha wasifu, mfumo mzima unabadilika.
// =====================================================================
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useT } from '../lib/prefs';

export interface Contact { companyName: string; address: string; phone: string; email: string; website: string; supportPhone: string; supportEmail: string }

let cached: Promise<Contact | null> | null = null;
export function loadContact() {
  cached ??= api<{ contact?: Contact }>('/public/status').then((r) => r.contact ?? null).catch(() => { cached = null; return null; });
  return cached;
}
export function useContact() {
  const [c, setC] = useState<Contact | null>(null);
  useEffect(() => { let live = true; loadContact().then((v) => live && setC(v)); return () => { live = false; }; }, []);
  return c;
}

/** "0712 345 678 / 0754 123 456" -> viungo viwili vya kupiga simu */
export function Phones({ value }: { value: string }) {
  const list = value.split(/[/,]/).map((x) => x.trim()).filter(Boolean);
  return <>{list.map((p, i) => <span key={p}>{i > 0 && ' / '}<a href={`tel:${p.replace(/[\s-]/g, '')}`}>{p}</a></span>)}</>;
}
const Mail = ({ value }: { value: string }) => <a href={`mailto:${value}`}>{value}</a>;

/**
 * footer: mistari mifupi chini ya ukurasa (kuingia, sidebar)
 * card:   kadi kamili (ukurasa wa Msaada) — mauzo na msaada wa kiufundi kando kwa kando
 */
export function CompanyContact({ variant = 'footer' }: { variant?: 'footer' | 'card' }) {
  const t = useT();
  const c = useContact();
  if (!c) return null;
  const hasSales = !!(c.phone || c.email);
  const hasSupport = !!(c.supportPhone || c.supportEmail);
  if (!hasSales && !hasSupport && !c.address) return null;

  if (variant === 'footer') {
    return (
      <div className="co-foot">
        {hasSupport && <div><span className="co-k">{t('Msaada wa kiufundi')}</span> {c.supportPhone && <Phones value={c.supportPhone} />}{c.supportPhone && c.supportEmail && ' · '}{c.supportEmail && <Mail value={c.supportEmail} />}</div>}
        {hasSales && <div><span className="co-k">{t('Mauzo')}</span> {c.phone && <Phones value={c.phone} />}{c.phone && c.email && ' · '}{c.email && <Mail value={c.email} />}</div>}
        {c.address && <div className="co-addr">{c.companyName} · {c.address}</div>}
      </div>
    );
  }
  return (
    <section className="card co-card">
      <div className="co-card-head">
        <strong>{c.companyName}</strong>
        {c.address && <span>{c.address}</span>}
      </div>
      <div className="co-grid">
        {hasSupport && (
          <div className="co-box co-support">
            <h3>{t('Msaada wa kiufundi')}</h3>
            <p className="muted">{t('Mfumo haufanyi kazi, kuingia, hitilafu au swali la matumizi')}</p>
            {c.supportPhone && <div className="co-line"><span aria-hidden="true">☎</span><Phones value={c.supportPhone} /></div>}
            {c.supportEmail && <div className="co-line"><span aria-hidden="true">✉</span><Mail value={c.supportEmail} /></div>}
          </div>
        )}
        {hasSales && (
          <div className="co-box">
            <h3>{t('Mauzo na ada')}</h3>
            <p className="muted">{t('Ada ya CoopLink, mkataba, kujiunga kwa chama kipya')}</p>
            {c.phone && <div className="co-line"><span aria-hidden="true">☎</span><Phones value={c.phone} /></div>}
            {c.email && <div className="co-line"><span aria-hidden="true">✉</span><Mail value={c.email} /></div>}
          </div>
        )}
      </div>
    </section>
  );
}

/** Mstari mmoja wa msaada wa kiufundi (chini ya sidebar) */
export function SupportLine() {
  const t = useT();
  const c = useContact();
  if (!c?.supportPhone && !c?.supportEmail) return null;
  return (
    <span className="co-side">
      {t('Msaada')}: {c.supportPhone ? <Phones value={c.supportPhone.split(/[/,]/)[0].trim()} /> : <Mail value={c.supportEmail} />}<br />
    </span>
  );
}
