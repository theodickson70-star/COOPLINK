// =====================================================================
//  MAAFISA USHIRIKA (v0.43) — Owner pekee anawasajili
//   Kila afisa amefungwa kwenye wilaya moja; maafisa 5 walio hai kwa kila wilaya.
//   Nenosiri la muda linatumwa kwa SMS (COOPLINK) — halionyeshwi kama SMS imefika.
// =====================================================================
import { LocationFields } from '../components/LocationPicker';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { dateTime, phone } from '../lib/format';
import { Alert, Button, Empty, Loading, Modal, PageHead, TextField } from '../components/ui';
import { PhoneNameFields } from '../components/PhoneName';
import { Kpi, Pill } from '../components/owner-ui';
import { SentModal, type Delivery, type Sent } from './Staff';

interface Officer {
  id: string; fullName: string; phone: string; email: string | null; jobTitle: string | null; isActive: boolean; lastLoginAt: string | null; totpEnabled: boolean;
  jurisdictionRegion: string | null; jurisdictionDistrict: string | null; createdAt: string; amcosCount: number;
}
interface District { region: string | null; district: string; amcos: number }
interface Data { data: Officer[]; districts: District[]; maxPerDistrict: number }

export function OwnerOfficers() {
  const r = useFetch<Data>('/owner/officers');
  const act = useAction();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Officer | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, { district: string; region: string | null; amcos: number; officers: Officer[] }>();
    for (const d of r.data?.districts ?? []) m.set(d.district.toLowerCase(), { district: d.district, region: d.region, amcos: d.amcos, officers: [] });
    for (const o of r.data?.data ?? []) {
      const k = (o.jurisdictionDistrict ?? '—').toLowerCase();
      if (!m.has(k)) m.set(k, { district: o.jurisdictionDistrict ?? '—', region: o.jurisdictionRegion, amcos: o.amcosCount, officers: [] });
      m.get(k)!.officers.push(o);
    }
    return [...m.values()].sort((a, b) => b.officers.length - a.officers.length || a.district.localeCompare(b.district));
  }, [r.data]);
  const max = r.data?.maxPerDistrict ?? 5;
  const all = r.data?.data ?? [];
  const toggle = async (o: Officer) => { if (await act.run(() => api(`/owner/officers/${o.id}/active`, { method: 'POST', body: { isActive: !o.isActive } }))) r.reload(); };
  const reset = async (o: Officer) => {
    const x = await act.run(() => api<{ delivery: Delivery; temporaryPassword: string | null }>(`/owner/officers/${o.id}/reset-password`, { method: 'POST' }));
    if (x) setSent({ name: o.fullName, delivery: x.delivery, password: x.temporaryPassword });
  };
  return (
    <>
      <PageHead title="Maafisa Ushirika" sub="Wasimamizi na wakaguzi wa serikali wa vyama vya wilaya — wanaona kila kitu cha vyama vya wilaya yao, wanatoa hoja za ukaguzi, maagizo rasmi na zuio la malipo.">
        <Button onClick={() => setCreating(true)}>+ Sajili afisa</Button>
      </PageHead>
      <Alert>{r.error ?? act.error}</Alert>
      {r.loading && !r.data ? <Loading /> : (
        <>
          <div className="grid grid-kpi">
            <Kpi label="Maafisa walio hai" value={all.filter((o) => o.isActive).length} tone="dark" />
            <Kpi label="Wilaya zenye afisa" value={groups.filter((g) => g.officers.some((o) => o.isActive)).length} hint={`kati ya ${r.data?.districts.length ?? 0} zenye vyama`} />
            <Kpi label="Bila 2FA" value={all.filter((o) => o.isActive && !o.totpEnabled).length} tone={all.some((o) => o.isActive && !o.totpEnabled) ? 'warn' : undefined} hint="lazima ndani ya siku 3" />
          </div>
          {!groups.length && <Empty>Bado hakuna afisa wala chama chenye wilaya. Weka wilaya kwenye taarifa za vyama kwanza.</Empty>}
          <div className="ov-districts">
            {groups.map((g) => {
              const active = g.officers.filter((o) => o.isActive).length;
              return (
                <section key={g.district} className="card ov-district">
                  <header>
                    <div><h3>Wilaya ya {g.district}</h3><small className="muted">{g.region ? `Mkoa wa ${g.region} · ` : ''}vyama {g.amcos}</small></div>
                    <span className={`ov-slot ${active >= max ? 'full' : ''}`}>{active}/{max}</span>
                  </header>
                  {!g.officers.length ? <p className="muted st-small">Hakuna afisa bado.</p> : (
                    <ul className="ov-off-list">
                      {g.officers.map((o) => (
                        <li key={o.id} className={o.isActive ? '' : 'off'}>
                          <span className="avatar" aria-hidden="true">{o.fullName.charAt(0)}</span>
                          <div className="grow">
                            <b>{o.fullName}</b> {!o.isActive && <Pill value="SUSPENDED" label="Amezimwa" />} {o.isActive && !o.totpEnabled && <Pill value="PENDING" label="Bila 2FA" />}
                            <small className="muted">{o.jobTitle ?? 'Afisa Ushirika'} · {phone(o.phone)} · aliingia {o.lastLoginAt ? dateTime(o.lastLoginAt) : 'bado'}</small>
                          </div>
                          <div className="actions">
                            <Button size="sm" variant="ghost" onClick={() => setEditing(o)}>Hariri</Button>
                            {o.isActive && <Button size="sm" variant="ghost" busy={act.busy} onClick={() => reset(o)}>Tuma nenosiri</Button>}
                            <Button size="sm" variant={o.isActive ? 'secondary' : 'primary'} busy={act.busy} disabled={!o.isActive && active >= max} onClick={() => toggle(o)}>{o.isActive ? 'Zima' : 'Washa'}</Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
      {(creating || editing) && r.data && (
        <OfficerForm officer={editing} districts={r.data.districts} onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(s) => { setCreating(false); setEditing(null); r.reload(); if (s) setSent(s); }} />
      )}
      {sent && <SentModal sent={sent} onClose={() => setSent(null)} />}
    </>
  );
}

function OfficerForm({ officer, districts, onClose, onSaved }: { officer: Officer | null; districts: District[]; onClose: () => void; onSaved: (s?: Sent) => void }) {
  const act = useAction();
  const [ph, setPh] = useState('');
  const [fullName, setFullName] = useState(officer?.fullName ?? '');
  const [email, setEmail] = useState(officer?.email ?? '');
  const [jobTitle, setJobTitle] = useState(officer?.jobTitle ?? 'Afisa Ushirika Wilaya');
  const [district, setDistrict] = useState(officer?.jurisdictionDistrict ?? '');
  const [region, setRegion] = useState(officer?.jurisdictionRegion ?? '');
  const known = districts.find((x) => x.district.toLowerCase() === district.trim().toLowerCase());
  const save = async () => {
    const body = { fullName: fullName.trim(), email: email.trim() || null, jobTitle: jobTitle.trim(), district: district.trim(), region: region.trim() || null };
    if (officer) {
      if (await act.run(() => api(`/owner/officers/${officer.id}`, { method: 'PATCH', body }))) onSaved();
      return;
    }
    const x = await act.run(() => api<{ officer: Officer; delivery: Delivery; temporaryPassword: string | null }>('/owner/officers', { method: 'POST', body: { ...body, phone: ph } }));
    if (x) onSaved({ name: x.officer.fullName, delivery: x.delivery, password: x.temporaryPassword });
  };
  const moving = !!officer && district.trim().toLowerCase() !== (officer.jurisdictionDistrict ?? '').toLowerCase();
  return (
    <Modal open size="lg" title={officer ? `Hariri: ${officer.fullName}` : 'Sajili Afisa Ushirika'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Ghairi</Button><Button busy={act.busy} disabled={fullName.trim().length < 3 || district.trim().length < 2 || (!officer && !ph)} onClick={save}>{officer ? 'Hifadhi' : 'Sajili na tuma nenosiri'}</Button></>}>
      <Alert>{act.error}</Alert>
      <div className="form-grid">
        {officer ? (
          <>
            <TextField label="Jina kamili" value={fullName} onChange={setFullName} />
            <TextField label="Simu" value={phone(officer.phone)} onChange={() => {}} disabled />
          </>
        ) : (
          <PhoneNameFields phoneLabel="Simu ya afisa *" phone={ph} onPhone={setPh} name={fullName} onName={(v) => setFullName(v)} autoFocus phoneHelp="Nenosiri la muda litatumwa kwa SMS kwa namba hii" />
        )}
        <TextField label="Barua pepe (hiari)" type="email" value={email} onChange={setEmail} />
        <TextField label="Cheo" value={jobTitle} onChange={setJobTitle} />
        <LocationFields levels={2} requireDistrict value={{ region, district }} onChange={(v) => { setRegion(v.region); setDistrict(v.district); }} />
      </div>
      <p className="st-small muted" style={{ margin: '4px 0 0' }}>{known ? `Vyama ${known.amcos} vimesajiliwa na wilaya hii.` : district ? 'Hakuna chama kilichosajiliwa na wilaya hii bado.' : 'Chagua mkoa, kisha wilaya ya vyama atakavyosimamia.'}</p>
      {moving && <Alert kind="warn">Kubadili wilaya kutamtoa afisa kwenye vifaa vyote; ataingia upya na kuona vyama vya wilaya mpya tu.</Alert>}
      <ul className="sent-steps st-small">
        <li>Afisa anaona taarifa zote za vyama vya wilaya yake (wanachama, fedha, mauzo, mishahara, kumbukumbu) — hawezi kubadilisha rekodi za chama.</li>
        <li>Anatoa ukaguzi na hoja, maagizo rasmi, na zuio la malipo (kwa nenosiri + 2FA).</li>
        <li>2FA ni lazima ndani ya siku 3. Wilaya moja inaweza kuwa na maafisa 5 walio hai.</li>
      </ul>
    </Modal>
  );
}
