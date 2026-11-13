// =====================================================================
//  PORTAL YA MKULIMA — upande wa ofisi
//   PortalAccess: hali ya mkulima mmoja + kutoa/kufuta PIN (Mhasibu na Storekeeper; Meneja anaona tu)
//   PortalSummary: idadi ya wakulima wenye PIN na kitufe cha Meneja cha kuwasha/kuzima portal
// =====================================================================
import { useState } from 'react';
import { api } from '../lib/api';
import { useAction, useFetch } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { dateTime, num } from '../lib/format';
import { useT } from '../lib/prefs';
import { Alert, Badge, Button, Modal } from './ui';

interface State { enabled: boolean; hasPin: boolean; mustChange: boolean; issuedAt: string | null; issuedBy: string | null; lastLoginAt: string | null; locked: boolean; eligible: boolean; canIssue: boolean }

export const portalUrl = () => `${window.location.origin}/mkulima`;

export function PortalAccess({ memberId, memberName }: { memberId: string; memberName: string }) {
  const t = useT();
  const { data, reload } = useFetch<State>(`/members/${memberId}/portal`);
  const act = useAction();
  const [pin, setPin] = useState<{ pin: string | null; memberNo: string; delivery?: { status: 'SENT' | 'FAILED' | 'OFF'; phoneMasked?: string; error?: string } } | null>(null);
  const [confirm, setConfirm] = useState<'reset' | 'revoke' | null>(null);
  if (!data) return null;

  const issue = async () => {
    const r = await act.run(() => api<{ pin: string | null; memberNo: string; delivery?: { status: 'SENT' | 'FAILED' | 'OFF'; phoneMasked?: string; error?: string } }>(`/members/${memberId}/portal/pin`, { method: 'POST' }));
    setConfirm(null);
    if (r) { setPin(r); reload(); }
  };
  const revoke = async () => {
    const r = await act.run(() => api(`/members/${memberId}/portal/pin`, { method: 'DELETE' }));
    setConfirm(null);
    if (r) reload();
  };

  return (
    <>
    <section className="card card-pad portal-card no-print">
      <div className="portal-head">
        <h2>{t('Portal ya mkulima')}</h2>
        {!data.enabled ? <Badge status="DRAFT" label={t('Haijawashwa')} />
          : data.hasPin ? (data.locked ? <Badge status="REJECTED" label={t('Imefungwa kwa muda')} /> : data.mustChange ? <Badge status="PENDING" label={t('Bado hajaingia')} /> : <Badge status="APPROVED" label={t('Anatumia')} />)
          : <Badge status="DRAFT" label={t('Hana PIN')} />}
      </div>
      {!data.enabled ? (
        <p className="muted">{t('Meneja hajawasha portal ya wakulima kwa chama hiki. Ikiwashwa, mkulima ataweza kuona taarifa zake kwenye simu.')}</p>
      ) : (
        <>
          <dl className="dl portal-dl">
            <dt>{t('PIN ilitolewa')}</dt><dd>{data.issuedAt ? `${dateTime(data.issuedAt)}${data.issuedBy ? ` · ${data.issuedBy}` : ''}` : '—'}</dd>
            <dt>{t('Aliingia mara ya mwisho')}</dt><dd>{data.lastLoginAt ? dateTime(data.lastLoginAt) : '—'}</dd>
          </dl>
          {!data.eligible && <Alert kind="warn">{t('PIN inatolewa kwa mkulima aliye hai tu.')}</Alert>}
          <Alert>{act.error}</Alert>
          {data.canIssue && data.eligible && (
            <div className="portal-actions">
              {data.hasPin
                ? <><Button size="sm" variant="secondary" onClick={() => setConfirm('reset')}>{t('Toa PIN mpya')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm('revoke')}>{t('Futa PIN')}</Button></>
                : <Button size="sm" onClick={issue} busy={act.busy}>{t('Toa PIN')}</Button>}
            </div>
          )}
          {!data.canIssue && <p className="muted" style={{ fontSize: 13 }}>{t('PIN inatolewa na Mhasibu au Storekeeper.')}</p>}
        </>
      )}
    </section>

      <Modal open={!!confirm} title={confirm === 'revoke' ? 'Futa PIN ya mkulima' : 'Toa PIN mpya'} onClose={() => setConfirm(null)}
        footer={<><Button variant="secondary" onClick={() => setConfirm(null)}>Ghairi</Button>
          <Button variant={confirm === 'revoke' ? 'danger' : 'primary'} busy={act.busy} onClick={confirm === 'revoke' ? revoke : issue}>{confirm === 'revoke' ? 'Futa PIN' : 'Toa PIN mpya'}</Button></>}>
        <p>{confirm === 'revoke'
          ? t('{name} hataweza kuingia kwenye portal mpaka apewe PIN mpya. Simu zote alizoingia nazo zitatolewa nje.', { name: memberName })
          : t('PIN ya zamani ya {name} itaacha kufanya kazi mara moja, na simu zote alizoingia nazo zitatolewa nje. Fanya hivi tu mkulima akiwa mbele yako.', { name: memberName })}</p>
      </Modal>

      <Modal open={!!pin} title="PIN ya mkulima" onClose={() => setPin(null)} footer={<Button onClick={() => setPin(null)}>{pin?.pin ? t('Nimempa mkulima') : t('Sawa')}</Button>}>
        {pin && !pin.pin && (
          <div className="pin-slip">
            <Alert kind="ok">{t('PIN imetumwa moja kwa moja kwa simu ya mkulima')} ({pin.delivery?.phoneMasked}). {t('Wewe huioni — ni yake peke yake.')}</Alert>
            <div className="pin-slip-box">
              <div><span>{t('Namba ya uanachama')}</span><strong>{pin.memberNo}</strong></div>
              <div><span>{t('Ingia hapa')}</span><strong>{portalUrl().replace(/^https?:\/\//, '')}</strong></div>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>{t('Akiingia mara ya kwanza, mfumo utamtaka aweke PIN yake mwenyewe. Hajapata SMS? Toa PIN mpya baada ya dakika chache.')}</p>
          </div>
        )}
        {pin?.pin && (
          <div className="pin-slip">
            {pin.delivery?.status === 'FAILED' && <Alert kind="warn">{t('SMS ya PIN haikufika kwa mkulima — mpe PIN hii mwenyewe.')}</Alert>}
            <Alert kind="warn">{t('Mpe mkulima PIN hii sasa. Haitaonekana tena — ikipotea, utatoa mpya.')}</Alert>
            <div className="pin-slip-box">
              <div><span>{t('Namba ya uanachama')}</span><strong>{pin.memberNo}</strong></div>
              <div><span>PIN</span><strong className="pin-big">{pin.pin}</strong></div>
              <div><span>{t('Ingia hapa')}</span><strong>{portalUrl().replace(/^https?:\/\//, '')}</strong></div>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>{t('Akiingia mara ya kwanza, mfumo utamtaka aweke PIN yake mwenyewe.')}</p>
          </div>
        )}
      </Modal>
    </>
  );
}

interface Summary { enabled: boolean; active: number; withPin: number; loggedIn: number; last7: number; canIssue: boolean; canToggle: boolean }

export function PortalSummary() {
  const t = useT();
  const { amcos, refresh } = useAuth();
  const { data, reload } = useFetch<Summary>('/members/portal/summary');
  const act = useAction();
  const [open, setOpen] = useState(false);
  if (!data) return null;
  if (!data.enabled && !data.canToggle) return null;
  const toggle = async () => {
    if (!amcos) return;
    const r = await act.run(() => api(`/amcos/${amcos.id}`, { method: 'PATCH', body: { farmerPortal: !data.enabled } }));
    setOpen(false);
    if (r) { reload(); refresh().catch(() => undefined); }
  };
  return (
    <>
    <section className="card card-pad portal-sum no-print">
      <div className="portal-sum-main">
        <div>
          <h3>{t('Portal ya wakulima')} {data.enabled ? <Badge status="APPROVED" label={t('Imewashwa')} /> : <Badge status="DRAFT" label={t('Imezimwa')} />}</h3>
          {data.enabled
            ? <p className="muted">{t('Wakulima {pin} kati ya {all} wana PIN · {logged} wameshaingia · {week} wiki hii', { pin: num(data.withPin), all: num(data.active), logged: num(data.loggedIn), week: num(data.last7) })}
                {' · '}<a href="/mkulima" target="_blank" rel="noreferrer">{portalUrl().replace(/^https?:\/\//, '')}</a></p>
            : <p className="muted">{t('Wakulima wanaweza kuona deni lao, mauzo, pembejeo na malipo kwenye simu zao. Huduma hii ni bure ndani ya ada ya chama.')}</p>}
        </div>
        {data.canToggle && <Button size="sm" variant={data.enabled ? 'ghost' : 'primary'} onClick={() => setOpen(true)}>{data.enabled ? t('Zima portal') : t('Washa portal')}</Button>}
      </div>
      <Alert>{act.error}</Alert>
    </section>
      <Modal open={open} title={data.enabled ? 'Zima portal ya wakulima' : 'Washa portal ya wakulima'} onClose={() => setOpen(false)}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Ghairi</Button><Button busy={act.busy} variant={data.enabled ? 'danger' : 'primary'} onClick={toggle}>{data.enabled ? 'Zima' : 'Washa'}</Button></>}>
        {data.enabled
          ? <p>{t('Wakulima wote watashindwa kuingia mpaka uiwashe tena. PIN zao zitabaki.')}</p>
          : <ul className="portal-list">
              <li>{t('Mhasibu au Storekeeper atampa kila mkulima PIN ofisini (kwenye ukurasa wa mkulima).')}</li>
              <li>{t('Mkulima ataona taarifa zake mwenyewe tu, zilizoidhinishwa tu. Hawezi kubadilisha chochote.')}</li>
              <li>{t('Unaweza kuizima wakati wowote.')}</li>
            </ul>}
      </Modal>
    </>
  );
}
