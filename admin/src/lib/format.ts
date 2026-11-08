const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const tsh = (v: string | number | null | undefined) => `TSh ${nf0.format(Number(v ?? 0))}`;
export const num = (v: string | number | null | undefined) => nf.format(Number(v ?? 0));

export const date = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const dateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const fullName = (m: { firstName: string; middleName?: string | null; lastName: string }) =>
  [m.firstName, m.middleName, m.lastName].filter(Boolean).join(' ');

export const phone = (p?: string | null) => (p ? p.replace(/^255/, '0') : '—');

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Msimamizi wa Mfumo',
  UNION_ADMIN: 'Msimamizi wa Union',
  UNION_VIEWER: 'Mtazamaji wa Union',
  AMCOS_ADMIN: 'Meneja',
  ACCOUNTANT: 'Mhasibu',
  CLERK: 'Stokipa',
  AMCOS_VIEWER: 'Mtazamaji (amezimwa)',
  FINANCE_MANAGER: 'Meneja wa Fedha',
  TECH_SUPPORT: 'Msaada wa Kiufundi',
  CUSTOMER_SUPPORT: 'Huduma kwa Wateja',
  MARKETING_MANAGER: 'Meneja wa Masoko',
};
export const OWNER_ROLE_LABEL = 'Owner Super Admin';

export const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Hai', SUSPENDED: 'Amesimamishwa', EXITED: 'Ametoka', DECEASED: 'Marehemu',
  DRAFT: 'Rasimu', APPROVED: 'Imeidhinishwa', REJECTED: 'Imekataliwa',
  ISSUED: 'Imetolewa', CANCELLED: 'Imefutwa', PENDING: 'Inasubiri uthibitisho', PENDING_APPROVAL: 'Inasubiri idhini',
  POSTED: 'Imekamilika', PARTIALLY_RECEIVED: 'Imepokelewa sehemu', RECEIVED: 'Imepokelewa',
  PLANNING: 'Maandalizi', MARKETING: 'Masoko', CLOSED: 'Umefungwa',
};

export const LEDGER_LABEL: Record<string, string> = {
  INPUT_LOAN: 'Mkopo wa pembejeo', CASH_LOAN: 'Mkopo wa fedha', TOBACCO_SALE: 'Mauzo ya tumbaku',
  DEDUCTION: 'Makato', PAYMENT: 'Malipo', ADJUSTMENT: 'Marekebisho', REVERSAL: 'Kufutwa (reversal)', OPENING_BALANCE: 'Salio la kuanzia',
  REPAYMENT: 'Marejesho ya deni',
};

export const CATEGORY_LABEL: Record<string, string> = {
  FERTILIZER: 'Mbolea', SEED: 'Mbegu', CHEMICAL: 'Dawa', PACKAGING: 'Vifungashio', EQUIPMENT: 'Vifaa', OTHER: 'Nyingine',
};
export const UNIT_LABEL: Record<string, string> = {
  BAG: 'Mfuko', KG: 'Kilo', LITRE: 'Lita', ROLL: 'Roli', PIECE: 'Kipande', PACKET: 'Pakiti',
};
export const MOVE_LABEL: Record<string, string> = {
  RECEIPT: 'Kupokea', ISSUE: 'Kutoa', RETURN: 'Kurudishwa', ADJUSTMENT: 'Marekebisho', DAMAGE: 'Zimeharibika', EXPIRY: 'Muda umeisha',
};

export const STAFF_TITLE: Record<string, string> = { AMCOS_ADMIN: 'Meneja', ACCOUNTANT: 'Mhasibu', CLERK: 'Stokipa' };
export const STAFF_DUTY: Record<string, string> = {
  AMCOS_ADMIN: 'Anaidhinisha matumizi, malipo, manunuzi, marekebisho ya stoo na ugawaji wa pembejeo',
  ACCOUNTANT: 'Anasimamia mapato, matumizi, malipo, akaunti na ripoti za fedha',
  CLERK: 'Anasimamia bidhaa, kupokea mzigo, ugawaji wa pembejeo na manunuzi',
};
export const APPROVAL_TYPE_LABEL: Record<string, string> = {
  MEMBER_REGISTRATION: 'Usajili wa mkulima', EXPENSE: 'Matumizi', FARMER_PAYMENT: 'Malipo kwa mkulima', SUPPLIER_PAYMENT: 'Malipo kwa mzabuni',
  PURCHASE: 'Manunuzi', STOCK_ADJUSTMENT: 'Marekebisho ya stoo', INPUT_ISSUE: 'Ugawaji wa pembejeo', REVERSAL: 'Kusahihisha muamala',
};
export const TXN_KIND_LABEL: Record<string, string> = {
  INCOME: 'Mapato', EXPENSE: 'Matumizi', FARMER_PAYMENT: 'Malipo kwa mkulima', SUPPLIER_PAYMENT: 'Malipo kwa mzabuni', REVERSAL: 'Kusahihisha',
};
export const ACCOUNT_KIND_LABEL: Record<string, string> = { CASH: 'Fedha taslimu', BANK: 'Benki', MOBILE_MONEY: 'Simu (M-Pesa n.k.)' };
