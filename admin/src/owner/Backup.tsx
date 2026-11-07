import { useState } from 'react';
import { api, apiDownload, type Paged } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { Alert, Button, Empty, Loading, Modal, PageHead, Pager, SelectField, TextField } from '../components/ui';
import { ConfirmDialog, Kpi, LABELS, Pill, Section } from '../components/owner-ui';

interface Status {
  database: { status: string; latencyMs: number; pretty: string; connections: number; version: string };
  tables: { table: string; rows: string; size: string }[];
  migrations: { applied: number; total: number; latest: string | null; upToDate: boolean };
  lastSuccessfulBackup: { takenAt: string; kind: string } | null;
}
interface Rec { id: string; kind: string; status: string; sizeBytes: number | null; location: string | null; notes: string | null; takenAt: string; createdBy: string | null }
interface Req { id: string; reason: string; status: string; createdAt: string; requestedBy: string | null; decisionNotes: string | null; decidedAt: string | null }

const size = (b: number | null) => (b === null ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const ageDays = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

export function OwnerBackup() {
  const { has } = useAuth();
  const st = useFetch<Status>('/owner/backup/status');
  const [page, setPage] = useState(1);
  const recs = useFetch<Paged<Rec>>('/owner/backup/records', { page, pageSize: 20 });
  const reqs = useFetch<{ data: Req[] }>('/owner/backup/restore-requests');
  const [modal, setModal] = useState<null | 'export' | 'record' | 'restore' | { decide: Req }>(null);
  const [rec, setRec] = useState({ kind: 'RAILWAY', status: 'SUCCESS', location: '', notes: '' });
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState('APPROVED');
  const [notes, setNotes] = useState('');
  const act = useAction();
  const close = () => { setModal(null); setReason(''); setNotes(''); };
  const refresh = () => { st.reload(); recs.reload(); reqs.reload(); };
  const s = st.data;

  return (
    <>
      <PageHead title="Backup & Database" sub="Hali ya database, historia ya backup na maombi ya kurejesha (restore)">
        {has('backup.manage') && <>
          <Button variant="secondary" onClick={() => setModal('record')}>Rekodi backup ya Railway</Button>
          <Button onClick={() => setModal('export')}>Pakua export ya data</Button>
        </>}
      </PageHead>
      <Alert>{st.error ?? act.error}</Alert>
      {st.loading && !s ? <Loading /> : s && (
        <div className="stack">
          <div className="grid grid-kpi">
            <Kpi label="Database" value={<Pill value={s.database.status} />} hint={`${s.database.latencyMs} ms · miunganisho ${s.database.connections}`} />
            <Kpi label="Ukubwa" value={s.database.pretty} />
            <Kpi tone={s.migrations.upToDate ? undefined : 'warn'} label="Migrations" value={`${s.migrations.applied}/${s.migrations.total}`} hint={s.migrations.latest ?? ''} />
            <Kpi tone={!s.lastSuccessfulBackup || ageDays(s.lastSuccessfulBackup.takenAt) > 7 ? 'warn' : undefined} label="Backup ya mwisho"
              value={s.lastSuccessfulBackup ? `Siku ${ageDays(s.lastSuccessfulBackup.takenAt)} zilizopita` : 'Hakuna'}
              hint={s.lastSuccessfulBackup ? `${LABELS[s.lastSuccessfulBackup.kind] ?? s.lastSuccessfulBackup.kind} · ${dateTime(s.lastSuccessfulBackup.takenAt)}` : 'Rekodi au pakua backup'} />
          </div>
          <Alert kind="warn">
            Backup halisi za database zinachukuliwa na <strong>Railway</strong> (Postgres service → Backups). Hapa unarekodi backup hizo, unapakua export ya data (JSON),
            na unaomba/kuidhinisha restore. Kwa usalama, mfumo <strong>haufanyi restore wala kufuta database</strong> wenyewe; restore inafanywa kwenye Railway baada ya idhini.
          </Alert>
          <div className="grid grid-2">
            <Section pad={false} title="Meza kubwa zaidi">
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Meza</th><th className="num">Safu</th><th className="num">Ukubwa</th></tr></thead>
                <tbody>{s.tables.map((t) => <tr key={t.table}><td><code>{t.table}</code></td><td className="num">{Number(t.rows).toLocaleString()}</td><td className="num">{t.size}</td></tr>)}</tbody>
              </table></div>
            </Section>
            <Section pad={false} title="Maombi ya restore" actions={has('backup.manage') && <Button size="sm" variant="secondary" onClick={() => setModal('restore')}>+ Omba restore</Button>}>
              {reqs.data?.data.length === 0 ? <Empty>Hakuna maombi.</Empty> : (
                <div className="table-wrap"><table className="table"><tbody>{reqs.data?.data.map((r) => (
                  <tr key={r.id}>
                    <td>{dateTime(r.createdAt)}<div className="muted" style={{ fontSize: 12 }}>{r.requestedBy}</div></td>
                    <td>{r.reason}{r.decisionNotes && <div className="muted" style={{ fontSize: 12 }}>Uamuzi: {r.decisionNotes}</div>}</td>
                    <td><Pill value={r.status} /></td>
                    <td className="num">{has('staff.manage') && (r.status === 'REQUESTED' || r.status === 'APPROVED') && <Button size="sm" variant="ghost" onClick={() => { setDecision(r.status === 'REQUESTED' ? 'APPROVED' : 'COMPLETED'); setModal({ decide: r }); }}>Amua</Button>}</td>
                  </tr>
                ))}</tbody></table></div>
              )}
            </Section>
          </div>
          <Section pad={false} title="Historia ya backup">
            {recs.data?.data.length === 0 ? <Empty>Bado hakuna backup iliyorekodiwa.</Empty> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Wakati</th><th>Aina</th><th>Hali</th><th className="num">Ukubwa</th><th>Mahali / maelezo</th><th>Na</th></tr></thead>
                <tbody>{recs.data?.data.map((r) => <tr key={r.id}><td>{dateTime(r.takenAt)}</td><td>{LABELS[r.kind] ?? r.kind}</td><td><Pill value={r.status} /></td><td className="num">{size(r.sizeBytes)}</td><td>{r.location ?? ''}{r.notes ? <div className="muted" style={{ fontSize: 12 }}>{r.notes}</div> : null}</td><td>{r.createdBy ?? '—'}</td></tr>)}</tbody>
              </table></div>
            )}
            <Pager meta={recs.data?.meta} onPage={setPage} />
          </Section>
        </div>
      )}

      <ConfirmDialog open={modal === 'export'} title="Pakua export ya data" confirmLabel="Pakua" onClose={close}
        message="Faili la JSON lenye data zote za mfumo litapakuliwa. Nenosiri, hash na siri za 2FA HAZIMO. Hifadhi faili hili mahali salama."
        onConfirm={async (c) => { await apiDownload('/owner/backup/export', { method: 'POST', body: c, filename: 'cooplink-export.json' }); close(); refresh(); }} />
      {modal === 'record' && (
        <Modal open title="Rekodi backup" onClose={close}
          footer={<><Button variant="secondary" onClick={close}>Ghairi</Button><Button busy={act.busy} onClick={async () => { if (await act.run(() => api('/owner/backup/records', { method: 'POST', body: { ...rec, location: rec.location || null, notes: rec.notes || null } }))) { close(); refresh(); } }}>Hifadhi</Button></>}>
          <div className="form-grid">
            <SelectField label="Aina" value={rec.kind} onChange={(v) => setRec({ ...rec, kind: v })} options={[{ value: 'RAILWAY', label: 'Railway Postgres backup' }, { value: 'OTHER', label: 'Nyingine' }]} />
            <SelectField label="Hali" value={rec.status} onChange={(v) => setRec({ ...rec, status: v })} options={[{ value: 'SUCCESS', label: 'Imefanikiwa' }, { value: 'FAILED', label: 'Imeshindwa' }]} />
          </div>
          <TextField label="Mahali" placeholder="mf. Railway › Postgres › Backups" value={rec.location} onChange={(v) => setRec({ ...rec, location: v })} />
          <TextField label="Maelezo" value={rec.notes} onChange={(v) => setRec({ ...rec, notes: v })} />
        </Modal>
      )}
      {modal === 'restore' && (
        <Modal open title="Omba restore ya database" onClose={close}
          footer={<><Button variant="secondary" onClick={close}>Ghairi</Button><Button variant="danger" busy={act.busy} disabled={reason.trim().length < 10} onClick={async () => { if (await act.run(() => api('/owner/backup/restore-requests', { method: 'POST', body: { reason } }))) { close(); refresh(); } }}>Tuma ombi</Button></>}>
          <Alert kind="warn">Restore inarudisha data ya zamani na inaweza kupoteza kazi iliyofanyika baada ya backup. Ombi hili linahitaji idhini ya Owner.</Alert>
          <TextField label="Sababu (angalau herufi 10) *" value={reason} onChange={setReason} />
        </Modal>
      )}
      <ConfirmDialog open={typeof modal === 'object' && modal !== null} danger={decision !== 'REJECTED'} title="Uamuzi wa ombi la restore" confirmLabel="Hifadhi uamuzi" onClose={close}
        message={typeof modal === 'object' && modal ? <>Ombi: <em>{modal.decide.reason}</em>. Kuidhinisha hakubadilishi database; inakuruhusu kufanya restore kwenye Railway, kisha kurudi kuweka "Imekamilika".</> : ''}
        onConfirm={async (c) => { if (typeof modal === 'object' && modal) { await api(`/owner/backup/restore-requests/${modal.decide.id}/decide`, { method: 'POST', body: { decision, notes, ...c } }); close(); refresh(); } }}>
        <SelectField label="Uamuzi" value={decision} onChange={setDecision}
          options={typeof modal === 'object' && modal?.decide.status === 'APPROVED' ? [{ value: 'COMPLETED', label: 'Restore imekamilika' }] : [{ value: 'APPROVED', label: 'Idhinisha' }, { value: 'REJECTED', label: 'Kataa' }]} />
        <TextField label="Maelezo *" value={notes} onChange={setNotes} />
      </ConfirmDialog>
    </>
  );
}
