// =====================================================================
//  KAZI YA NYUMA: VIKUMBUSHO NA ARIFA (v0.38) — kila saa
//   1. Vikumbusho vya ada kiotomatiki: siku 14 na 3 kabla ya tarehe ya mwisho, na siku 1 baada ya kupita
//      (saa za kazi tu, 09:00–17:59 EAT; chama hakikumbushwi zaidi ya mara moja kwa saa 24).
//   2. SMS za kazi kwa wafanyakazi (mara moja kwa kila jambo, saa za kimya zinaheshimiwa):
//      malipo yaliyosubiri uthibitisho > saa 24, tiketi zilizochelewa, leads mpya bila mhusika > saa 2.
// =====================================================================
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { getSetting } from './settings';
import { enqueue } from './sms';
import { effectivePermissions, PLATFORM_ROLES, type Permission } from './permissions';
import { sendFeeReminders } from '../modules/owner/finance-desk.routes';

const eatHour = () => Number(new Date().toLocaleString('en-US', { timeZone: 'Africa/Dar_es_Salaam', hour: 'numeric', hourCycle: 'h23' }));

async function staffWith(perm: Permission) {
  const rows = await db.select({ id: schema.users.id, phone: schema.users.phone, role: schema.users.role, permissions: schema.users.permissions })
    .from(schema.users).where(and(inArray(schema.users.role, PLATFORM_ROLES), eq(schema.users.isActive, true)));
  return rows.filter((u) => effectivePermissions(u.role, u.permissions).includes(perm));
}

/** Arifa moja kwa kila (jambo, mtu) — inarudisha true kama ni mpya. */
async function once(key: string, userId: string) {
  const r = await db.insert(schema.staffAlerts).values({ key, userId }).onConflictDoNothing().returning({ key: schema.staffAlerts.key });
  return r.length > 0;
}

export async function runRemindersSweep(opts: { force?: boolean } = {}) {
  const cfg = await getSetting('reminders');
  const out = { feeReminders: 0, staffAlerts: 0 };
  const h = eatHour();

  // 1. Vikumbusho vya ada
  if (cfg.feesAuto && (opts.force || (h >= 9 && h < 18))) {
    const due = (await db.execute<{ id: string }>(sql`select id from platform_fees where status in ('UNPAID','PARTIAL')
      and ((due_date - (now() at time zone 'Africa/Dar_es_Salaam')::date) in (14, 3) or ((now() at time zone 'Africa/Dar_es_Salaam')::date - due_date) = 1)`)).rows;
    if (due.length) {
      const r = await sendFeeReminders(due.map((x) => x.id), null);
      out.feeReminders = r?.targets ?? 0;
    }
  }

  // 2. SMS za kazi kwa wafanyakazi
  if (cfg.staffSms) {
    const msgs: { kind: 'STAFF_ALERT'; phone: string; userId: string; text: string }[] = [];
    const pays = (await db.execute<{ id: string; invoice_no: string; amount: string; created_by_id: string | null }>(sql`select id, invoice_no, amount, created_by_id
      from platform_payments where status = 'PENDING' and created_at < now() - interval '24 hours'`)).rows;
    if (pays.length) {
      const fin = await staffWith('finance.manage');
      for (const p of pays) for (const u of fin) {
        if (u.role !== 'SUPER_ADMIN' && u.id === p.created_by_id) continue; // aliyerekodi hathibitishi
        if (await once(`pay:${p.id}:${u.id}`, u.id)) msgs.push({ kind: 'STAFF_ALERT', phone: u.phone, userId: u.id,
          text: `CoopLink: Malipo ${p.invoice_no} (TSh ${Math.round(Number(p.amount)).toLocaleString('en-US')}) yamesubiri uthibitisho zaidi ya saa 24. Fungua Finance > Malipo.` });
      }
    }
    const tickets = (await db.execute<{ id: string; ticket_no: number; subject: string; assigned_to_id: string | null }>(sql`select id, ticket_no, subject, assigned_to_id
      from support_tickets where first_response_at is null and status <> 'CLOSED' and due_at < now()`)).rows;
    if (tickets.length) {
      const sup = (await staffWith('support.manage')).filter((u) => u.role !== 'SUPER_ADMIN');
      for (const t of tickets) {
        const to = t.assigned_to_id ? sup.filter((u) => u.id === t.assigned_to_id) : sup;
        for (const u of to) if (await once(`tkt:${t.id}:${u.id}`, u.id)) msgs.push({ kind: 'STAFF_ALERT', phone: u.phone, userId: u.id,
          text: `CoopLink: Tiketi #${t.ticket_no} (${t.subject.slice(0, 60)}) imepita muda wa jibu la kwanza${t.assigned_to_id ? '' : ' na haina mhusika'}. Ijibu sasa.` });
      }
    }
    const leads = (await db.execute<{ id: string; amcos_name: string; name: string }>(sql`select id, amcos_name, name from demo_requests
      where stage = 'NEW' and assigned_to_id is null and created_at < now() - interval '2 hours' and created_at > now() - interval '7 days'`)).rows;
    if (leads.length) {
      const sales = (await staffWith('leads.manage')).filter((u) => u.role !== 'SUPER_ADMIN');
      for (const l of leads) for (const u of sales) if (await once(`lead:${l.id}:${u.id}`, u.id)) msgs.push({ kind: 'STAFF_ALERT', phone: u.phone, userId: u.id,
        text: `CoopLink: Lead mpya bila mhusika — ${l.amcos_name} (${l.name}). Ichukue kwenye Leads & CRM na umpigie simu.` });
    }
    if (msgs.length) out.staffAlerts = await enqueue(db, msgs);
  }
  return out;
}
