// =====================================================================
//  KAZI NJE YA MTANDAO (v2.9) — /offline
//   Vijijini bila mtandao: toa pembejeo kwa mkulima na sajili mkulima mpya kwa data iliyopakuliwa kwenye kifaa.
//   Kila kitu kinakaa kwenye foleni na kinatumwa mtandao ukirudi — server inakagua stoo, bei, OTP na idhini wakati huo.
// =====================================================================
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { dateTime, num, tsh, UNIT_LABEL } from '../lib/format';
import { usd } from '../lib/fx';
import { Alert, Button, Empty, PageHead, SelectField, TextField } from '../components/ui';
import { Icon } from '../components/icons';
import { ComboSelect } from '../components/LocationPicker';
import { enqueueOffline, refreshPack, removeQueued, syncNow, updateQueued, useOffline, type Pack, type PackMember, type QItem } from '../lib/offline';

const ST: Record<QItem['status'], { label: string; cls: string }> = {
  PENDING: { label: 'Inasubiri mtandao', cls: 'q-wait' }, SYNCING: { label: 'Inatumwa…', cls: 'q-wait' }, DONE: { label: 'Imetumwa', cls: 'q-ok' },
  ERROR: { label: 'Imekataliwa', cls: 'q-bad' }, NEEDS_OTP: { label: 'Thibitisha namba', cls: 'q-otp' },
};

export function Offline() {
  const s = useOffline();
  const [tab, setTab] = useState<'queue' | 'issue' | 'member'>('queue');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = s.pack;
  const waiting = s.queue.filter((x) => x.status === 'PENDING' || x.status === 'SYNCING').length;
  const attention = s.queue.filter((x) => x.status === 'ERROR' || x.status === 'NEEDS_OTP').length;
  const download = async () => {
    setBusy(true); setErr(null);
    try { const x = await refreshPack(); setMsg(`Data imepakuliwa: wakulima ${x.members.length.toLocaleString('en-US')}, pembejeo ${x.items.length}. Sasa unaweza kufanya kazi bila mtandao.`); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const saved = (what: string) => { setMsg(`${what} imehifadhiwa kwenye kifaa. ${s.online ? 'Inatumwa sasa…' : 'Itatumwa mtandao ukirudi.'}`); setTab('queue'); };

  return (
    <>
      <PageHead title="Kazi nje ya mtandao" sub="Toa pembejeo na sajili wakulima vijijini bila mtandao — kazi zinatumwa zenyewe mtandao ukirudi" />
      <section className={`card off-head ${s.online ? 'on' : 'off'}`}>
        <span className="off-ic"><Icon name={s.online ? 'globe' : 'wifiOff'} /></span>
        <div className="grow">
          <b>{s.online ? 'Uko mtandaoni' : 'Huna mtandao sasa'}</b>
          <small>{p ? `Data ya kifaa: ${p.amcos.name} · wakulima ${p.members.length.toLocaleString('en-US')} · pembejeo ${p.items.length} · imesasishwa ${dateTime(p.at)}` : 'Bado hujapakua data ya kufanyia kazi bila mtandao.'}</small>
          {p?.truncated && <small className="money-neg">Wakulima ni wengi mno — ni wa kwanza 30,000 tu waliopakuliwa.</small>}
        </div>
        <div className="actions">
          {s.online && <Button variant="secondary" busy={busy} onClick={download}>{p ? 'Sasisha data' : 'Pakua data ya offline'}</Button>}
          {s.online && (waiting > 0 || attention > 0) && <Button busy={s.syncing} onClick={() => void syncNow({ includeErrors: false })}>Tuma sasa ({waiting})</Button>}
        </div>
      </section>
      <Alert kind="ok">{msg}</Alert>
      <Alert>{err}</Alert>
      {!p && !s.online && <Alert kind="warn">Kifaa hiki hakina data ya offline. Ukipata mtandao, fungua ukurasa huu na ubonyeze "Pakua data ya offline" kabla ya kwenda vijijini.</Alert>}

      <div className="seg off-tabs" role="tablist">
        <button type="button" className={tab === 'queue' ? 'on' : ''} onClick={() => setTab('queue')}>Foleni{s.queue.length > 0 && <em className={attention ? 'bad' : ''}>{waiting + attention || s.queue.length}</em>}</button>
        {p?.can.issue && <button type="button" className={tab === 'issue' ? 'on' : ''} onClick={() => setTab('issue')}>+ Toa pembejeo</button>}
        {p?.can.register && <button type="button" className={tab === 'member' ? 'on' : ''} onClick={() => setTab('member')}>+ Sajili mkulima</button>}
      </div>

      {tab === 'queue' && <QueueList items={s.queue} online={s.online} canOverride={!!p?.can.approveMembers} />}
      {tab === 'issue' && p && <IssueForm pack={p} onSaved={() => saved('Ombi la pembejeo')} />}
      {tab === 'member' && p && <MemberForm pack={p} onSaved={() => saved('Usajili wa mkulima')} />}
      <p className="muted st-small">Usalama: data iko kwenye kifaa hiki kwa akaunti yako tu. Ombi la pembejeo bado linahitaji idhini ya Meneja na OTP ya mkulima wakati wa kukabidhi; usajili unahitaji kuthibitisha namba ya simu kwa OTP kama kawaida.</p>
    </>
  );
}

function QueueList({ items, online, canOverride }: { items: QItem[]; online: boolean; canOverride: boolean }) {
  if (!items.length) return <section className="card"><Empty>Hakuna kazi kwenye foleni. Kazi utakazofanya bila mtandao zitaonekana hapa.</Empty></section>;
  return (
    <section className="card">
      <ul className="off-q">{items.map((x) => (
        <li key={x.ref} className={ST[x.status].cls}>
          <span className="off-qic"><Icon name={x.kind === 'ISSUE' ? 'issue' : 'userPlus'} /></span>
          <div className="grow">
            <b>{x.kind === 'ISSUE' ? 'Pembejeo' : 'Usajili'}: {x.label}</b>
            {x.sub && <small>{x.sub}</small>}
            <small>Imeandikwa {dateTime(x.createdAt)}{x.syncedAt ? ` · imetumwa ${dateTime(x.syncedAt)}` : ''}{x.result?.no ? ` · ${x.result.no}` : ''}</small>
            {x.error && <span className={`off-err ${x.status === 'NEEDS_OTP' ? 'otp' : ''}`}>{x.error}</span>}
            {x.status === 'NEEDS_OTP' && online && <OtpFix item={x} canOverride={canOverride} />}
          </div>
          <span className={`q-pill ${ST[x.status].cls}`}>{ST[x.status].label}</span>
          <span className="actions">
            {x.status === 'DONE' && x.result && <Link className="btn btn-sm btn-ghost" to={x.kind === 'ISSUE' ? `/input-issues` : `/members/${x.result.id}`}>Fungua</Link>}
            {x.status === 'ERROR' && online && <Button size="sm" variant="secondary" onClick={async () => { await updateQueued(x.ref, { status: 'PENDING', error: null }); void syncNow(); }}>Jaribu tena</Button>}
            {x.status !== 'DONE' && x.status !== 'SYNCING' && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('Futa kazi hii kwenye foleni? Haitatumwa.')) void removeQueued(x.ref); }}>Futa</Button>}
          </span>
        </li>
      ))}</ul>
    </section>
  );
}

/** Usajili uliofanyika offline: namba ya simu inathibitishwa kwa OTP sasa (mkulima ataje namba aliyotumiwa), au Meneja kwa sababu */
function OtpFix({ item, canOverride }: { item: QItem; canOverride: boolean }) {
  const pl = item.payload as { phone?: string; mobileMoneyNumber?: string; firstName: string; lastName: string };
  const phones = [...new Set([pl.phone, pl.mobileMoneyNumber].filter(Boolean) as string[])];
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [e, setE] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = `${pl.firstName} ${pl.lastName}`;
  const run = async (f: () => Promise<void>) => { setBusy(true); setE(null); try { await f(); } catch (x) { setE((x as ApiError).message); } finally { setBusy(false); } };
  const ph = sent ?? phones[0];
  return (
    <div className="off-otp">
      {!sent ? (
        <div className="actions">{phones.map((p) => <Button key={p} size="sm" busy={busy} onClick={() => run(async () => { await api('/members/register-otp', { method: 'POST', body: { phone: p, name } }); setSent(p); })}>Tuma OTP kwa {p}</Button>)}</div>
      ) : (
        <div className="actions">
          <input className="input" inputMode="numeric" placeholder="Namba ya OTP" value={code} onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ''))} style={{ maxWidth: 160 }} />
          <Button size="sm" busy={busy} disabled={code.length < 4} onClick={() => run(async () => {
            await api('/members/register-otp/verify', { method: 'POST', body: { phone: ph, code } });
            const rest = phones.filter((x) => x !== ph);
            if (rest.length) { setSent(null); setCode(''); return; }
            await updateQueued(item.ref, { status: 'PENDING', error: null }); void syncNow();
          })}>Thibitisha</Button>
        </div>
      )}
      {canOverride && (
        <details><summary>Mkulima hapatikani? Sajili bila OTP (Meneja)</summary>
          <div className="actions"><input className="input" placeholder="Sababu (herufi 10+)" value={reason} onChange={(ev) => setReason(ev.target.value)} />
            <Button size="sm" variant="secondary" disabled={reason.trim().length < 10} onClick={async () => { await updateQueued(item.ref, { status: 'PENDING', error: null, payload: { ...item.payload, phoneOtpOverride: reason.trim() } }); void syncNow(); }}>Sajili kwa sababu hii</Button></div>
        </details>
      )}
      {e && <span className="off-err">{e}</span>}
    </div>
  );
}

// ------------------------------ UGAWAJI WA PEMBEJEO (offline) ------------------------------
interface Line { itemId: string; qty: string; unit: 'PACK' | 'KG' }
function IssueForm({ pack, onSaved }: { pack: Pack; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const [member, setMember] = useState<PackMember | null>(null);
  const [lines, setLines] = useState<Line[]>([{ itemId: '', qty: '', unit: 'PACK' }]);
  const [notes, setNotes] = useState('');
  const [e, setE] = useState<string | null>(null);
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    return pack.members.filter((m) => m.name.toLowerCase().includes(n) || m.memberNo.toLowerCase().includes(n) || (m.village ?? '').toLowerCase().includes(n)).slice(0, 8);
  }, [q, pack.members]);
  const itemOf = (id: string) => pack.items.find((i) => i.id === id);
  const priced = pack.items.filter((i) => (pack.usdMode ? i.priceUsd : i.price));
  const lineCost = (l: Line) => {
    const it = itemOf(l.itemId); const n = Number(l.qty);
    if (!it || !(n > 0)) return 0;
    const unitP = Number(pack.usdMode ? it.priceUsd : it.price);
    return l.unit === 'KG' && it.packKg ? (unitP / Number(it.packKg)) * n : unitP * n;
  };
  const total = lines.reduce((t, l) => t + lineCost(l), 0);
  const ok = member && lines.length && lines.every((l) => l.itemId && Number(l.qty) > 0);
  const save = async () => {
    setE(null);
    if (!ok || !member) { setE('Chagua mkulima na weka kila pembejeo na idadi yake'); return; }
    const sub = lines.map((l) => `${itemOf(l.itemId)?.name} × ${l.qty}${l.unit === 'KG' ? ' kg' : ''}`).join(', ');
    await enqueueOffline({ kind: 'ISSUE', label: `${member.name} (${member.memberNo})`, sub: `${sub} · ≈ ${pack.usdMode ? usd(total) : tsh(total)}`,
      payload: { memberId: member.id, lines: lines.map((l) => ({ inputItemId: l.itemId, quantity: l.qty, unit: l.unit })), ...(notes.trim() ? { notes: `${notes.trim()} (offline)` } : { notes: 'Imeandaliwa bila mtandao' }) } });
    setMember(null); setQ(''); setLines([{ itemId: '', qty: '', unit: 'PACK' }]); setNotes('');
    onSaved();
  };
  return (
    <section className="card card-pad off-form">
      <h3>1. Mkulima</h3>
      {member ? (
        <div className="off-member"><Icon name="user" /><div className="grow"><b>{member.name}</b><small>{member.memberNo}{member.village ? ` · ${member.village}` : ''}{member.phoneEnd ? ` · simu …${member.phoneEnd}` : ''}</small></div>
          <Button size="sm" variant="ghost" onClick={() => setMember(null)}>Badilisha</Button></div>
      ) : (
        <>
          <input className="input" placeholder="Tafuta kwa jina, namba ya uanachama au kijiji…" value={q} onChange={(ev) => setQ(ev.target.value)} autoFocus />
          {hits.length > 0 && <ul className="off-hits">{hits.map((m) => <li key={m.id}><button type="button" onClick={() => setMember(m)}><b>{m.name}</b><small>{m.memberNo}{m.village ? ` · ${m.village}` : ''}</small></button></li>)}</ul>}
          {q.trim().length >= 2 && !hits.length && <p className="muted st-small">Hakuna mkulima hai anayelingana kwenye data ya kifaa. Mkulima mpya? Msajili kwanza (atahitaji idhini ya Meneja kabla ya kupewa pembejeo).</p>}
        </>
      )}
      <h3>2. Pembejeo</h3>
      {lines.map((l, i) => {
        const it = itemOf(l.itemId);
        const over = it && Number(l.qty) > 0 && (l.unit === 'KG' && it.packKg ? Number(l.qty) / Number(it.packKg) : Number(l.qty)) > Number(it.balance);
        return (
          <div key={i} className="off-line">
            <ComboSelect label="Pembejeo" value={it?.name ?? ''} options={priced.map((x) => x.name)}
              sub={(o) => { const x = priced.find((y) => y.name === o); return x ? `salio ${num(x.balance)} · ${pack.usdMode ? usd(x.priceUsd!) : tsh(x.price!)}` : undefined; }}
              onChange={(name) => { const x = priced.find((y) => y.name === name)!; setLines(lines.map((y, j) => (j === i ? { ...y, itemId: x.id, unit: 'PACK' } : y))); }} />
            {it?.looseKg && <SelectField label="Kipimo" value={l.unit} onChange={(v) => setLines(lines.map((y, j) => (j === i ? { ...y, unit: v as 'PACK' | 'KG' } : y)))}
              options={[{ value: 'PACK', label: UNIT_LABEL[it.unit] ?? 'Mfuko' }, { value: 'KG', label: 'Kilo' }]} />}
            <TextField label={`Idadi${it ? ` (${l.unit === 'KG' ? 'kilo' : (UNIT_LABEL[it.unit] ?? it.unit).toLowerCase()})` : ''}`} type="number" min="0" step="any" value={l.qty} onChange={(v) => setLines(lines.map((y, j) => (j === i ? { ...y, qty: v } : y)))} help={over ? `Zaidi ya salio la mwisho (${num(it!.balance)}) — Meneja ataona wakati wa idhini` : undefined} />
            <span className="off-cost">{lineCost(l) ? (pack.usdMode ? usd(lineCost(l)) : tsh(lineCost(l))) : ''}</span>
            {lines.length > 1 && <Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Ondoa</Button>}
          </div>
        );
      })}
      <Button size="sm" variant="secondary" onClick={() => setLines([...lines, { itemId: '', qty: '', unit: 'PACK' }])}>+ Pembejeo nyingine</Button>
      {!priced.length && <Alert kind="warn">Hakuna pembejeo yenye bei kwenye data ya kifaa. Sasisha data ukiwa na mtandao.</Alert>}
      <TextField label="Maelezo (hiari)" value={notes} onChange={setNotes} />
      <div className="off-total"><span>Jumla (makadirio)</span><b>{pack.usdMode ? usd(total) : tsh(total)}</b></div>
      <Alert>{e}</Alert>
      <div className="actions"><Button disabled={!ok} onClick={save}>Hifadhi kwenye foleni</Button></div>
      <p className="muted st-small">Bei na salio ni vya mara ya mwisho ulipopakua data. Server itakagua tena wakati wa kutuma; Meneja anaidhinisha, kisha pembejeo zinakabidhiwa kwa OTP ya mkulima.</p>
    </section>
  );
}

// ------------------------------ USAJILI WA MKULIMA (offline) ------------------------------
function MemberForm({ pack, onSaved }: { pack: Pack; onSaved: () => void }) {
  const blank = { firstName: '', middleName: '', lastName: '', gender: 'MALE', phone: '', village: '', hamlet: '', dateOfBirth: '', nidaNumber: '' };
  const [f, setF] = useState(blank);
  const [e, setE] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setE(null);
    if (f.firstName.trim().length < 2 || f.lastName.trim().length < 2) return setE('Andika jina la kwanza na la ukoo');
    if (f.phone && !/^0[67]\d{8}$/.test(f.phone.replace(/\s/g, ''))) return setE('Namba ya simu iwe kama 0712345678');
    if (f.nidaNumber && !/^\d{20}$/.test(f.nidaNumber)) return setE('Namba ya NIDA iwe tarakimu 20');
    const payload: Record<string, unknown> = { firstName: f.firstName.trim(), lastName: f.lastName.trim(), gender: f.gender };
    for (const k of ['middleName', 'village', 'hamlet', 'dateOfBirth', 'nidaNumber'] as const) if (f[k].trim()) payload[k] = f[k].trim();
    if (f.phone) payload.phone = f.phone.replace(/\s/g, '');
    await enqueueOffline({ kind: 'MEMBER', label: [f.firstName, f.middleName, f.lastName].filter(Boolean).join(' '), sub: [f.village, f.phone].filter(Boolean).join(' · '), payload });
    setF(blank);
    onSaved();
  };
  return (
    <section className="card card-pad off-form">
      <div className="form-grid">
        <TextField label="Jina la kwanza *" value={f.firstName} onChange={set('firstName')} />
        <TextField label="Jina la kati" value={f.middleName} onChange={set('middleName')} />
        <TextField label="Jina la ukoo *" value={f.lastName} onChange={set('lastName')} />
        <SelectField label="Jinsia *" value={f.gender} onChange={set('gender')} options={[{ value: 'MALE', label: 'Mwanaume' }, { value: 'FEMALE', label: 'Mwanamke' }]} />
        <TextField label="Simu ya mkulima" type="tel" inputMode="tel" placeholder="07XXXXXXXX" value={f.phone} onChange={set('phone')} help="Itathibitishwa kwa OTP mtandao ukirudi" />
        <ComboSelect label="Kijiji" allowCustom value={f.village} onChange={set('village')} options={pack.villages} placeholder="Chagua au andika kijiji" />
        <TextField label="Kitongoji" value={f.hamlet} onChange={set('hamlet')} />
        <TextField label="Tarehe ya kuzaliwa" type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} />
        <TextField label="Namba ya NIDA (hiari)" inputMode="numeric" maxLength={20} value={f.nidaNumber} onChange={(v) => set('nidaNumber')(v.replace(/\D/g, ''))} />
      </div>
      <Alert>{e}</Alert>
      <div className="actions"><Button onClick={save}>Hifadhi kwenye foleni</Button></div>
      <p className="muted st-small">Mtandao ukirudi: usajili unatumwa; kama namba ya simu inahitaji OTP, utaona kitufe "Tuma OTP" kwenye foleni. Picha na taarifa za malipo zinaongezwa baadaye kwenye ukurasa wa mkulima.</p>
    </section>
  );
}
