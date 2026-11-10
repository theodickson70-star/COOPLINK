// =====================================================================
//  COOPLINK — Mfumo wa Kusimamia Vyama vya Msingi (AMCOS) — Tumbaku
//  Muundo wa database wa mfumo MZIMA (Awamu 1, 2 na 3).
//  Awamu 1 ina API tayari; meza za Awamu 2 (soko, makato, malipo)
//  zimewekwa sasa ili msingi usibadilike baadaye.
//
//  Kanuni za msingi:
//   - Kila rekodi ya chama ina amcosId (multi-tenant).
//   - Pesa ni numeric (si float) — hakuna makosa ya hesabu.
//   - member_ledger_entries, stock_movements na audit_logs HAZIBADILISHWI
//     wala kufutwa (trigger kwenye database). Kosa husahihishwa kwa
//     rekodi ya REVERSAL.
//   - Hakuna kufuta wanachama — hali (status) hubadilishwa tu.
//  Majina ya columns kwenye DB ni snake_case (casing: 'snake_case').
// =====================================================================
import {
  pgTable, pgEnum, uuid, text, boolean, integer, numeric, timestamp, date,
  jsonb, uniqueIndex, index, primaryKey, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------
//  ENUMS
// ---------------------------------------------------------------------
export const roleEnum = pgEnum('role', [
  'SUPER_ADMIN',  // Msimamizi wa mfumo
  'UNION_ADMIN',  // Msimamizi wa Chama Kikuu
  'UNION_VIEWER', // Mtazamaji wa Chama Kikuu
  'AMCOS_ADMIN',  // Mwenyekiti / Katibu / Meneja
  'ACCOUNTANT',   // Mhasibu
  'CLERK',        // Karani
  'AMCOS_VIEWER', // Mjumbe wa bodi / mkaguzi (kusoma tu)
  // Wafanyakazi wa DUKALANGU SOLUTION / CoopLink (jukwaa) — HAWANA access ya data za vyama
  'FINANCE_MANAGER',
  'TECH_SUPPORT',
  'CUSTOMER_SUPPORT',
  'MARKETING_MANAGER',
]);
export const amcosStatusEnum = pgEnum('amcos_status', ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']);
export const genderEnum = pgEnum('gender', ['MALE', 'FEMALE']);
export const memberStatusEnum = pgEnum('member_status', ['ACTIVE', 'SUSPENDED', 'EXITED', 'DECEASED', 'PENDING']); // PENDING = anasubiri uthibitisho wa Meneja
export const mobileMoneyProviderEnum = pgEnum('mobile_money_provider', ['MPESA', 'AIRTEL_MONEY', 'MIXX_BY_YAS', 'HALOPESA', 'TPESA']);
export const seasonStatusEnum = pgEnum('season_status', ['PLANNING', 'ACTIVE', 'MARKETING', 'CLOSED']);
export const estimateStatusEnum = pgEnum('estimate_status', ['DRAFT', 'APPROVED', 'REJECTED']);
export const inputCategoryEnum = pgEnum('input_category', ['FERTILIZER', 'SEED', 'CHEMICAL', 'PACKAGING', 'EQUIPMENT', 'OTHER']);
export const inputUnitEnum = pgEnum('input_unit', ['BAG', 'KG', 'LITRE', 'ROLL', 'PIECE', 'PACKET']);
export const stockMovementTypeEnum = pgEnum('stock_movement_type', ['RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'DAMAGE', 'EXPIRY']);
export const inputIssueStatusEnum = pgEnum('input_issue_status', ['ISSUED', 'CANCELLED', 'PENDING_APPROVAL', 'REJECTED']);
export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', [
  'INPUT_LOAN',      // Deni la pembejeo (debit)
  'CASH_LOAN',       // Mkopo wa fedha (debit)
  'TOBACCO_SALE',    // Mauzo ya tumbaku (credit)
  'DEDUCTION',       // Makato (debit)
  'PAYMENT',         // Malipo aliyopokea mkulima (debit)
  'ADJUSTMENT',
  'REVERSAL',
  'OPENING_BALANCE',
  'REPAYMENT',       // Mkulima amerejesha deni kwa fedha taslimu (credit)
  'GROUP_GUARANTEE', // Deni limelipwa na wanakikundi wenzake (credit kwa mdaiwa)
  'LOAN_INTEREST',   // Riba ya pesa ya kuni (debit)
]);
export const marketStatusEnum = pgEnum('market_status', ['SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED']);
export const baleStatusEnum = pgEnum('bale_status', ['REGISTERED', 'GRADED', 'SOLD', 'REJECTED']);
export const deductionBasisEnum = pgEnum('deduction_basis', ['PERCENT_OF_GROSS', 'PER_KG', 'FIXED', 'OUTSTANDING_LOAN']);
export const currencyEnum = pgEnum('currency', ['TZS', 'USD']);
export const settlementStatusEnum = pgEnum('settlement_status', ['DRAFT', 'APPROVED', 'PAID', 'CANCELLED']);
export const paymentMethodEnum = pgEnum('payment_method', ['MOBILE_MONEY', 'BANK', 'CASH']);
export const paymentStatusEnum = pgEnum('payment_status', ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED']);
export const paymentBatchStatusEnum = pgEnum('payment_batch_status', ['DRAFT', 'APPROVED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'CANCELLED']);
export const smsStatusEnum = pgEnum('sms_status', ['QUEUED', 'SENT', 'DELIVERED', 'FAILED']);

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
const money = () => numeric({ precision: 18, scale: 2 });

// ---------------------------------------------------------------------
//  TENANTS: Chama Kikuu (Union) -> Chama cha Msingi (AMCOS)
// ---------------------------------------------------------------------
export const unions = pgTable('unions', {
  id: id(),
  name: text().notNull(),
  code: text().notNull().unique(), // mf. WETCU
  regNumber: text(),
  region: text(),
  district: text(),
  phone: text(),
  email: text(),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const amcos = pgTable('amcos', {
  id: id(),
  unionId: uuid().references(() => unions.id),
  name: text().notNull(),
  code: text().notNull().unique(), // mf. URM01 — hutumika kwenye namba za wanachama
  regNumber: text(),               // Namba ya usajili ya Mrajis
  region: text(),
  district: text(),
  ward: text(),
  village: text(),
  phone: text(),
  email: text(),
  isActive: boolean().notNull().default(true), // access ya watumiaji wa chama (inafuata status)
  // Biashara ya CoopLink (Owner)
  status: amcosStatusEnum().notNull().default('ACTIVE'),
  statusReason: text(),
  contactName: text(),
  contactPhone: text(),
  registeredById: uuid(),
  approvedById: uuid(),
  approvedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index().on(t.unionId), index().on(t.status)]);

// ---------------------------------------------------------------------
//  WATUMIAJI
// ---------------------------------------------------------------------
export const users = pgTable('users', {
  id: id(),
  fullName: text().notNull(),
  phone: text().notNull().unique(), // 2557XXXXXXXX
  email: text().unique(),
  passwordHash: text().notNull(),
  role: roleEnum().notNull(),
  unionId: uuid().references(() => unions.id),
  amcosId: uuid().references(() => amcos.id),
  isActive: boolean().notNull().default(true),
  tokenVersion: integer().notNull().default(0), // ikiongezwa, tokens zote za zamani zinakufa
  mustChangePassword: boolean().notNull().default(true),
  lastLoginAt: timestamp({ withTimezone: true }),
  /** Toleo la Masharti ya Huduma na Sera ya Faragha alilokubali mtumiaji, na lini */
  termsVersion: text(),
  termsAcceptedAt: timestamp({ withTimezone: true }),
  jobTitle: text(),                 // wafanyakazi wa jukwaa
  permissions: text().array(),      // null = ruhusa za kawaida za role
  totpSecret: text(),               // 2FA (imesimbwa kwa AES-256-GCM)
  totpEnabled: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index().on(t.amcosId), index().on(t.unionId), index().on(t.role),
  // Kila AMCOS: Meneja mmoja, Mhasibu mmoja, Stokipa mmoja (walio hai)
  uniqueIndex('users_one_staff_per_role').on(t.amcosId, t.role)
    .where(sql`is_active and role in ('AMCOS_ADMIN', 'ACCOUNTANT', 'CLERK')`),
]);

// ---------------------------------------------------------------------
//  MISIMU NA WANUNUZI (vya mfumo mzima)
// ---------------------------------------------------------------------
export const seasons = pgTable('seasons', {
  id: id(),
  name: text().notNull().unique(), // mf. 2026/2027
  startDate: date().notNull(),
  endDate: date().notNull(),
  status: seasonStatusEnum().notNull().default('PLANNING'),
  isCurrent: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const buyers = pgTable('buyers', {
  id: id(),
  name: text().notNull(),
  code: text().notNull().unique(),
  phone: text(),
  email: text(),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------
//  WANACHAMA NA MASHAMBA
// ---------------------------------------------------------------------
export const members = pgTable('members', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  memberNo: text().notNull(), // mf. URM01-000123
  firstName: text().notNull(),
  middleName: text(),
  lastName: text().notNull(),
  gender: genderEnum().notNull(),
  dateOfBirth: date(),
  nidaNumber: text(),
  voterIdNumber: text(), // Kadi ya mpiga kura (kwa wasio na NIDA)
  phone: text(),
  village: text(),
  hamlet: text(), // Kitongoji
  photoUrl: text(),
  status: memberStatusEnum().notNull().default('ACTIVE'),
  joinedAt: date().notNull().defaultNow(),
  // Malipo
  mobileMoneyNumber: text(),
  mobileMoneyProvider: mobileMoneyProviderEnum(),
  mobileMoneyName: text(),
  bankName: text(),
  bankAccountName: text(),
  bankAccountNumber: text(),
  preferredPayment: paymentMethodEnum().notNull().default('MOBILE_MONEY'),
  // Hisa
  sharesCount: integer().notNull().default(0),
  // Mrithi / ndugu wa karibu
  nextOfKinName: text(),
  nextOfKinPhone: text(),
  nextOfKinRelation: text(),
  // Kiingilio cha uanachama. Fedha halisi inaingizwa na Mhasibu (Mapato -> Ada za uanachama) na inaweka "imelipwa" hapa.
  entryFee: numeric({ precision: 14, scale: 2 }),
  entryFeePaid: boolean().notNull().default(false),
  entryFeePaidAt: date(),
  entryFeeReference: text(), // namba ya muamala wa CoopLink au risiti ya zamani
  // Mzamini wa mkulima
  guarantorName: text(),
  guarantorPhone: text(),
  // Jina la mkulima tofauti na jina la mobile money la namba yake (mf. namba ni ya mke) — linaidhinishwa na Meneja
  phoneOwnerName: text(),             // jina lililosajiliwa kwenye mobile money la namba hii
  nameOverrideReason: text(),
  nameOverrideById: uuid(),           // Meneja aliyeidhinisha (null = linasubiri idhini)
  nameOverrideAt: timestamp({ withTimezone: true }),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex().on(t.amcosId, t.memberNo),
  uniqueIndex().on(t.amcosId, t.nidaNumber),
  uniqueIndex().on(t.amcosId, t.voterIdNumber),
  index().on(t.amcosId, t.lastName),
  index().on(t.amcosId, t.phone),
  index().on(t.amcosId, t.status),
]);

/** Picha ya mkulima (JPEG iliyopunguzwa ukubwa, ~50KB). Iko kwenye database kwa sababu diski ya Railway hufutika kila deploy. */
export const memberPhotos = pgTable('member_photos', {
  memberId: uuid().primaryKey().references(() => members.id),
  mimeType: text().notNull(),
  data: text().notNull(), // base64
  sizeBytes: integer().notNull(),
  uploadedById: uuid(),
  updatedAt: updatedAt(),
});

export const farms = pgTable('farms', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  memberId: uuid().notNull().references(() => members.id),
  name: text(),
  village: text(),
  acres: numeric({ precision: 10, scale: 2 }).notNull(),
  latitude: numeric({ precision: 10, scale: 7 }),
  longitude: numeric({ precision: 10, scale: 7 }),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index().on(t.amcosId, t.memberId)]);

// Makisio ya uzalishaji kwa msimu
export const estimates = pgTable('estimates', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  memberId: uuid().notNull().references(() => members.id),
  farmId: uuid().references(() => farms.id),
  buyerId: uuid().references(() => buyers.id),
  acresPlanted: numeric({ precision: 10, scale: 2 }).notNull(),
  estimatedKg: numeric({ precision: 12, scale: 2 }).notNull(),
  status: estimateStatusEnum().notNull().default('DRAFT'),
  notes: text(),
  approvedById: uuid(),
  approvedAt: timestamp({ withTimezone: true }),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.seasonId, t.memberId), index().on(t.amcosId, t.seasonId)]);

// ---------------------------------------------------------------------
//  PEMBEJEO: aina, bei kwa msimu, stoo, na utoaji kwa mkopo
// ---------------------------------------------------------------------
export const inputItems = pgTable('input_items', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  name: text().notNull(), // mf. NPK 10:18:24 (50kg)
  category: inputCategoryEnum().notNull(),
  unit: inputUnitEnum().notNull(),
  reorderLevel: numeric({ precision: 14, scale: 2 }), // stoo ikishuka chini ya hapa = "stock ndogo"
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.name)]);

export const inputPrices = pgTable('input_prices', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  inputItemId: uuid().notNull().references(() => inputItems.id),
  unitPrice: money().notNull(), // TZS
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.seasonId, t.inputItemId), index().on(t.amcosId, t.seasonId)]);

export const inputIssues = pgTable('input_issues', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  memberId: uuid().notNull().references(() => members.id),
  issueNo: text().notNull(), // mf. URM01-P-000045
  issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  totalAmount: money().notNull(),
  status: inputIssueStatusEnum().notNull().default('ISSUED'),
  notes: text(),
  issuedById: uuid(),
  cancelledById: uuid(),
  cancelledAt: timestamp({ withTimezone: true }),
  cancelReason: text(),
  clientRef: text(), // kitambulisho kutoka app ya offline (kuzuia nakala mbili)
  approvalId: uuid(),
  approvedById: uuid(),
  approvedAt: timestamp({ withTimezone: true }),
  groupId: uuid(), // kikundi cha dhamana cha mkulima wakati wa ugawaji
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex().on(t.amcosId, t.issueNo),
  uniqueIndex().on(t.amcosId, t.clientRef),
  index().on(t.amcosId, t.seasonId, t.memberId),
]);

export const inputIssueLines = pgTable('input_issue_lines', {
  id: id(),
  inputIssueId: uuid().notNull().references(() => inputIssues.id),
  inputItemId: uuid().notNull().references(() => inputItems.id),
  quantity: numeric({ precision: 14, scale: 2 }).notNull(),
  unitPrice: money().notNull(),
  amount: money().notNull(),
}, (t) => [index().on(t.inputIssueId)]);

// Kila mabadiliko ya stoo ni rekodi. Salio = jumla ya quantity (+ ndani, - nje).
export const stockMovements = pgTable('stock_movements', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  inputItemId: uuid().notNull().references(() => inputItems.id),
  type: stockMovementTypeEnum().notNull(),
  quantity: numeric({ precision: 14, scale: 2 }).notNull(),
  reference: text(),
  inputIssueId: uuid().references(() => inputIssues.id),
  notes: text(),
  approvalId: uuid(),                 // idhini ya Meneja (marekebisho / ugawaji)
  purchaseRequestId: uuid(),          // mzigo uliopokelewa dhidi ya ombi la manunuzi
  supplierId: uuid(),
  batchNo: text(),
  expiryDate: date(),
  unitCost: money(),
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [index().on(t.amcosId, t.seasonId, t.inputItemId), index().on(t.amcosId, t.expiryDate)]);

// ---------------------------------------------------------------------
//  LEDGER YA MWANACHAMA — moyo wa uwazi
//  debit  = mwanachama anadaiwa (pembejeo, makato, malipo aliyopokea)
//  credit = chama kinamdai mwanachama (mauzo ya tumbaku)
//  Salio  = credit - debit  (chanya: chama kinamdai; hasi: ana deni)
// ---------------------------------------------------------------------
export const memberLedgerEntries = pgTable('member_ledger_entries', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().references(() => seasons.id),
  memberId: uuid().notNull().references(() => members.id),
  type: ledgerEntryTypeEnum().notNull(),
  debit: money().notNull().default('0'),
  credit: money().notNull().default('0'),
  description: text().notNull(),
  referenceType: text(), // mf. INPUT_ISSUE, SETTLEMENT, PAYMENT
  referenceId: uuid(),
  reversalOfId: uuid().unique().references((): AnyPgColumn => memberLedgerEntries.id),
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [
  index().on(t.amcosId, t.memberId, t.createdAt),
  index().on(t.amcosId, t.seasonId),
  index().on(t.referenceType, t.referenceId),
]);

// ---------------------------------------------------------------------
//  AWAMU 2: SOKO, MABELO, MAKATO, MALIPO (muundo tayari, API baadaye)
// ---------------------------------------------------------------------
export const markets = pgTable('markets', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  buyerId: uuid().references(() => buyers.id),
  marketNo: text().notNull(),
  marketDate: date().notNull(),
  location: text(),
  status: marketStatusEnum().notNull().default('SCHEDULED'),
  buyerName: text(),                                             // kampuni ya ununuzi (mf. TLTC, Alliance One)
  exchangeRate: numeric({ precision: 12, scale: 4 }),            // USD -> TZS siku ya soko
  approvalId: uuid(),                                            // idhini ya mauzo (TOBACCO_SALE)
  notes: text(),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.marketNo)]);

export const bales = pgTable('bales', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  marketId: uuid().notNull().references(() => markets.id),
  memberId: uuid().notNull().references(() => members.id),
  baleNo: text().notNull(), // namba ya tiketi / barcode
  grossKg: numeric({ precision: 10, scale: 2 }).notNull(),
  netKg: numeric({ precision: 10, scale: 2 }),
  grade: text(),
  priceUsd: numeric({ precision: 10, scale: 4 }), // bei kwa kilo
  valueUsd: numeric({ precision: 14, scale: 2 }),
  status: baleStatusEnum().notNull().default('REGISTERED'),
  rejectReason: text(),
  clientRef: text(),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex().on(t.amcosId, t.baleNo),
  uniqueIndex().on(t.amcosId, t.clientRef),
  index().on(t.marketId),
  index().on(t.amcosId, t.memberId),
]);

export const exchangeRates = pgTable('exchange_rates', {
  id: id(),
  rateDate: date().notNull().unique(),
  usdToTzs: numeric({ precision: 12, scale: 4 }).notNull(),
  source: text(), // mf. BoT
  createdAt: createdAt(),
});

// Kanuni za makato — zinawekwa na chama kwa kila msimu (si hard-coded)
export const deductionRules = pgTable('deduction_rules', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  name: text().notNull(), // mf. Ushuru wa Halmashauri
  code: text().notNull(), // mf. LGA_LEVY
  basis: deductionBasisEnum().notNull(),
  rate: numeric({ precision: 14, scale: 4 }).notNull(),
  currency: currencyEnum().notNull().default('TZS'),
  priority: integer().notNull().default(100),
  glAccountCode: text(), // akaunti ya daftari kuu makato yanapoenda (mf. 2310 ushuru wa halmashauri)
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.seasonId, t.code)]);

export const settlements = pgTable('settlements', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  memberId: uuid().notNull().references(() => members.id),
  settlementNo: text().notNull(),
  marketId: uuid(),
  approvalId: uuid(),
  totalKg: numeric({ precision: 12, scale: 2 }).notNull(),
  grossUsd: numeric({ precision: 14, scale: 2 }).notNull(),
  exchangeRate: numeric({ precision: 12, scale: 4 }).notNull(),
  grossTzs: money().notNull(),
  totalDeductions: money().notNull(),
  netTzs: money().notNull(),
  status: settlementStatusEnum().notNull().default('DRAFT'),
  approvedById: uuid(),
  approvedAt: timestamp({ withTimezone: true }),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.settlementNo), index().on(t.amcosId, t.seasonId, t.memberId)]);

export const settlementLines = pgTable('settlement_lines', {
  id: id(),
  settlementId: uuid().notNull().references(() => settlements.id),
  deductionRuleId: uuid().references(() => deductionRules.id),
  description: text().notNull(),
  amount: money().notNull(),
  kind: text().notNull().default('RULE'),   // RULE | GROUP_GUARANTEE
  beneficiaryMemberId: uuid(),              // GROUP_GUARANTEE: mwanakikundi ambaye deni lake linalipwa
}, (t) => [index().on(t.settlementId)]);

export const paymentBatches = pgTable('payment_batches', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  batchNo: text().notNull(),
  totalAmount: money().notNull(),
  status: paymentBatchStatusEnum().notNull().default('DRAFT'),
  marketId: uuid(),
  approvalId: uuid(),
  accountId: uuid(),
  approvedById: uuid(),
  approvedAt: timestamp({ withTimezone: true }),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.batchNo)]);

export const payments = pgTable('payments', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  batchId: uuid().references(() => paymentBatches.id),
  settlementId: uuid().references(() => settlements.id),
  memberId: uuid().notNull().references(() => members.id),
  amount: money().notNull(),
  method: paymentMethodEnum().notNull(),
  destination: text().notNull(),
  provider: text(),
  status: paymentStatusEnum().notNull().default('PENDING'),
  providerRef: text(),
  failureReason: text(),
  financeTxnId: uuid(),
  idempotencyKey: text().notNull().unique(),
  paidAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index().on(t.amcosId, t.memberId), index().on(t.batchId)]);

// ---------------------------------------------------------------------
//  HUDUMA ZA MFUMO
// ---------------------------------------------------------------------
export const smsLogs = pgTable('sms_logs', {
  id: id(),
  amcosId: uuid().references(() => amcos.id),
  phone: text().notNull(),
  message: text().notNull(),
  status: smsStatusEnum().notNull().default('QUEUED'),
  provider: text(),
  providerRef: text(),
  error: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index().on(t.amcosId, t.createdAt)]);

// Namba zinazofuatana — salama hata watumiaji wengi wakiandika kwa wakati mmoja
export const counters = pgTable('counters', {
  amcosId: uuid().notNull().references(() => amcos.id),
  key: text().notNull(),
  value: integer().notNull().default(0),
}, (t) => [primaryKey({ columns: [t.amcosId, t.key] })]);

// Kumbukumbu ya kila kitendo muhimu — nani, nini, lini, kabla na baada
export const auditLogs = pgTable('audit_logs', {
  id: id(),
  amcosId: uuid(),
  unionId: uuid(),
  userId: uuid(),
  userRole: text(),
  action: text().notNull(), // mf. MEMBER_CREATE
  entity: text().notNull(),
  entityId: text(),
  before: jsonb(),
  after: jsonb(),
  ip: text(),
  userAgent: text(),
  createdAt: createdAt(),
}, (t) => [
  index().on(t.amcosId, t.createdAt),
  index().on(t.entity, t.entityId),
  index().on(t.userId, t.createdAt),
]);


// =====================================================================
//  WATUMISHI WA AMCOS: Meneja (AMCOS_ADMIN), Mhasibu (ACCOUNTANT), Stokipa (CLERK)
//  Idhini, fedha za chama na manunuzi. Fedha za chama HAZICHANGANYWI na za CoopLink.
// =====================================================================
export const approvalTypeEnum = pgEnum('approval_type', [
  'MEMBER_REGISTRATION', 'EXPENSE', 'FARMER_PAYMENT', 'SUPPLIER_PAYMENT', 'PURCHASE', 'STOCK_ADJUSTMENT', 'INPUT_ISSUE', 'REVERSAL',
  'JOURNAL', 'TOBACCO_SALE', 'PAYMENT_BATCH', 'TRANSFER', 'PAYROLL', 'ASSET_DISPOSAL',
  'OPENING_BALANCE', 'PERIOD_CLOSE', 'YEAR_END_CLOSE',
  'STOCK_RECEIPT',
  'GROUP_REGISTRATION', 'GROUP_CHANGE',
  'KUNI_BATCH',
]);
export const approvalStatusEnum = pgEnum('approval_status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
export const financeAccountKindEnum = pgEnum('finance_account_kind', ['CASH', 'BANK', 'MOBILE_MONEY']);
export const financeTxnKindEnum = pgEnum('finance_txn_kind', ['INCOME', 'EXPENSE', 'FARMER_PAYMENT', 'SUPPLIER_PAYMENT', 'REVERSAL', 'TRANSFER']);
export const financeDirectionEnum = pgEnum('finance_direction', ['IN', 'OUT']);
export const financeTxnStatusEnum = pgEnum('finance_txn_status', ['PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED']);
export const purchaseStatusEnum = pgEnum('purchase_status', ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']);

/** Kila ombi linalohitaji idhini ya Meneja. Uamuzi ukishafanyika haubadilishwi (trigger). */
export const approvalRequests = pgTable('approval_requests', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  requestNo: text().notNull(),
  type: approvalTypeEnum().notNull(),
  status: approvalStatusEnum().notNull().default('PENDING'),
  title: text().notNull(),
  amount: money(),
  entityType: text(),
  entityId: uuid(),
  payload: jsonb(),
  reason: text(),
  requestedById: uuid().notNull(),
  requestedRole: text().notNull(),
  decidedById: uuid(),
  decidedRole: text(),
  decidedAt: timestamp({ withTimezone: true }),
  decisionNote: text(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex().on(t.amcosId, t.requestNo),
  index().on(t.amcosId, t.status, t.createdAt),
  index().on(t.entityType, t.entityId),
]);

export const financeAccounts = pgTable('finance_accounts', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  name: text().notNull(),
  kind: financeAccountKindEnum().notNull(),
  bankName: text(),
  accountNumber: text(),
  openingBalance: money().notNull().default('0'),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.name)]);

/** Miamala ya fedha ya chama. POSTED = imekamilika: haibadilishwi wala kufutwa; inasahihishwa kwa REVERSAL. */
export const financeTransactions = pgTable('finance_transactions', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().references(() => seasons.id),
  txnNo: text().notNull(),
  kind: financeTxnKindEnum().notNull(),
  direction: financeDirectionEnum().notNull(),
  category: text().notNull(),
  accountId: uuid().references(() => financeAccounts.id),
  amount: money().notNull(),
  txnDate: date().notNull(),
  description: text().notNull(),
  reference: text(),
  payee: text(),
  memberId: uuid().references(() => members.id),
  supplierId: uuid(),
  purchaseRequestId: uuid(),
  status: financeTxnStatusEnum().notNull(),
  approvalId: uuid(),
  reversalOfId: uuid().unique().references((): AnyPgColumn => financeTransactions.id),
  contraGlAccountId: uuid(),   // akaunti ya daftari kuu upande wa pili (hiari; vinginevyo kwa kundi)
  transferGroupId: uuid(),     // uhamisho kati ya akaunti: miamala miwili yenye kundi moja
  marketId: uuid(),            // malipo ya mnunuzi wa tumbaku kwa soko husika
  createdById: uuid().notNull(),
  postedById: uuid(),
  postedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex().on(t.amcosId, t.txnNo),
  index().on(t.amcosId, t.status, t.txnDate),
  index().on(t.amcosId, t.accountId),
  index().on(t.purchaseRequestId),
]);

export const financeBudgets = pgTable('finance_budgets', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  category: text().notNull(),
  amount: money().notNull(),
  notes: text(),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.seasonId, t.category)]);

export const suppliers = pgTable('suppliers', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  name: text().notNull(),
  phone: text(),
  email: text(),
  tin: text(),
  address: text(),
  notes: text(),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.name)]);

export const purchaseRequests = pgTable('purchase_requests', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  prNo: text().notNull(),
  supplierId: uuid().references(() => suppliers.id),
  status: purchaseStatusEnum().notNull().default('PENDING_APPROVAL'),
  totalAmount: money().notNull(),
  neededBy: date(),
  notes: text(),
  approvalId: uuid(),
  requestedById: uuid().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.prNo), index().on(t.amcosId, t.status)]);

export const purchaseRequestLines = pgTable('purchase_request_lines', {
  id: id(),
  purchaseRequestId: uuid().notNull().references(() => purchaseRequests.id),
  inputItemId: uuid().notNull().references(() => inputItems.id),
  quantity: numeric({ precision: 14, scale: 2 }).notNull(),
  unitCost: money().notNull(),
  amount: money().notNull(),
  receivedQty: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
}, (t) => [index().on(t.purchaseRequestId)]);


// =====================================================================
//  OWNER CONTROL PANEL — biashara ya CoopLink (DUKALANGU SOLUTION)
//  Fedha za kampuni HAZICHANGANYWI na fedha za vyama wala za wakulima.
// =====================================================================
export const billingCycleEnum = pgEnum('billing_cycle', ['TRIAL', 'MONTHLY', 'ANNUAL']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED']);
export const platformPaymentStatusEnum = pgEnum('platform_payment_status', ['PENDING', 'VERIFIED', 'FAILED', 'REFUNDED']);
export const platformPaymentCategoryEnum = pgEnum('platform_payment_category', ['SUBSCRIPTION', 'SETUP', 'TRAINING', 'OTHER']);
export const expenseCategoryEnum = pgEnum('expense_category', ['SERVER', 'SMS', 'SALARY', 'MARKETING', 'OFFICE', 'TRANSPORT', 'OTHER']);
export const announcementKindEnum = pgEnum('announcement_kind', ['ANNOUNCEMENT', 'SYSTEM_UPDATE', 'EXPIRY_REMINDER', 'MARKETING']);
export const deliveryStatusEnum = pgEnum('delivery_status', ['QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED']);
export const backupStatusEnum = pgEnum('backup_status', ['RUNNING', 'SUCCESS', 'FAILED']);
export const restoreStatusEnum = pgEnum('restore_status', ['REQUESTED', 'APPROVED', 'REJECTED', 'COMPLETED']);

export const subscriptionPlans = pgTable('subscription_plans', {
  id: id(),
  name: text().notNull(),
  code: text().notNull().unique(),
  description: text(),
  monthlyPrice: money().notNull(),
  annualPrice: money().notNull(),
  currency: currencyEnum().notNull().default('TZS'),
  trialDays: integer().notNull().default(14),
  graceDays: integer().notNull().default(7),
  maxMembers: integer(),
  features: jsonb().$type<string[]>(),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const subscriptions = pgTable('subscriptions', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  planId: uuid().notNull().references(() => subscriptionPlans.id),
  cycle: billingCycleEnum().notNull(),
  status: subscriptionStatusEnum().notNull(),
  startDate: date().notNull(),
  endDate: date().notNull(),          // imelipiwa / trial hadi tarehe hii
  graceDays: integer().notNull(),
  discountPercent: numeric({ precision: 5, scale: 2 }).notNull().default('0'),
  price: money().notNull(),           // bei kwa kipindi kimoja baada ya punguzo
  notes: text(),
  createdById: uuid(),
  cancelledAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index().on(t.amcosId),
  index().on(t.status, t.endDate),
  uniqueIndex('subscriptions_one_current').on(t.amcosId).where(sql`status in ('TRIAL', 'ACTIVE', 'PAST_DUE')`),
]);

export const platformPayments = pgTable('platform_payments', {
  id: id(),
  invoiceNo: text().notNull().unique(),
  amcosId: uuid().references(() => amcos.id),
  subscriptionId: uuid().references(() => subscriptions.id),
  category: platformPaymentCategoryEnum().notNull(),
  amount: money().notNull(),
  currency: currencyEnum().notNull().default('TZS'),
  method: paymentMethodEnum().notNull(),
  providerRef: text().unique(),       // namba ya muamala — huzuia malipo kurekodiwa mara mbili
  periods: integer().notNull().default(1),
  cycle: billingCycleEnum(),
  status: platformPaymentStatusEnum().notNull().default('PENDING'),
  paidAt: timestamp({ withTimezone: true }).notNull(),
  verifiedById: uuid(),
  verifiedAt: timestamp({ withTimezone: true }),
  failureReason: text(),
  refundedAt: timestamp({ withTimezone: true }),
  refundReason: text(),
  notes: text(),
  feeId: uuid(),                      // ada ya CoopLink (kingilio/msimu) iliyolipiwa
  controlNumberId: uuid(),            // control number ya TeePay iliyotumika
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index().on(t.amcosId), index().on(t.status, t.paidAt), index().on(t.feeId)]);

// ---------------------------------------------------------------------
//  ADA ZA COOPLINK: kingilio (mara moja) + ada ya msimu (kila mwaka, mwisho 15/10)
//  Zinalipwa kwa control number ya TeePay TU. Chama kinafungwa ada ikipita tarehe bila kulipwa,
//  na kinafunguka papo hapo malipo yakithibitishwa na TeePay.
// ---------------------------------------------------------------------
export const platformFeeKindEnum = pgEnum('platform_fee_kind', ['ENTRANCE', 'SEASON']);
export const platformFeeStatusEnum = pgEnum('platform_fee_status', ['UNPAID', 'PARTIAL', 'PAID', 'WAIVED']);
export const controlNumberStatusEnum = pgEnum('control_number_status', ['ISSUING', 'ISSUED', 'PAID', 'FAILED']);

export const platformFees = pgTable('platform_fees', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  kind: platformFeeKindEnum().notNull(),
  label: text().notNull(),            // mf. "Ada ya kingilio" / "Ada ya msimu 2026/2027"
  amount: money().notNull(),
  installments: integer().notNull().default(1),
  paid: money().notNull().default('0'),
  dueDate: date().notNull(),          // chama kinafungwa baada ya tarehe hii kama haijalipwa yote
  status: platformFeeStatusEnum().notNull().default('UNPAID'),
  paidAt: timestamp({ withTimezone: true }),
  waivedById: uuid(),
  waivedReason: text(),
  testAmount: money(),                // Owner: kiasi cha majaribio (mf. 500); likifanikiwa, linaondoka na ada halisi haipungui
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index().on(t.amcosId, t.status),
  uniqueIndex('platform_fees_one_entrance').on(t.amcosId).where(sql`kind = 'ENTRANCE'`),
  uniqueIndex('platform_fees_one_season').on(t.amcosId, t.dueDate).where(sql`kind = 'SEASON'`),
]);

export const platformControlNumbers = pgTable('platform_control_numbers', {
  id: id(),
  feeId: uuid().notNull().references(() => platformFees.id),
  amcosId: uuid().notNull().references(() => amcos.id),
  amount: money().notNull(),
  amountMinor: text().notNull(),
  idempotencyKey: text().notNull().unique(),
  request: jsonb().notNull(),         // ombi lililotumwa TeePay — linarudiwa NENO KWA NENO na Idempotency-Key ileile
  teepayId: text().unique(),
  number: text(),
  status: controlNumberStatusEnum().notNull().default('ISSUING'),
  collectedMinor: text().notNull().default('0'),
  lastError: text(),
  lastSyncedAt: timestamp({ withTimezone: true }),
  paidAt: timestamp({ withTimezone: true }),
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [index().on(t.feeId), index().on(t.status)]);

// Malipo ya ada kwa mitandao ya simu (TeePay mobile money push): Meneja anaweka namba, anapokea ombi la PIN kwenye simu
export const mobilePaymentStatusEnum = pgEnum('mobile_payment_status', ['SENDING', 'PENDING', 'SUCCEEDED', 'FAILED']);
export const platformMobilePayments = pgTable('platform_mobile_payments', {
  id: id(),
  feeId: uuid().notNull().references(() => platformFees.id),
  amcosId: uuid().notNull().references(() => amcos.id),
  amount: money().notNull(),
  provider: text().notNull().default('TEEPAY'),   // TEEPAY | ABLINER — njia mbili; moja ikishindwa, nyingine inajaribiwa
  amountMinor: text().notNull(),
  phone: text().notNull(),
  payerName: text().notNull(),
  idempotencyKey: text().notNull().unique(),
  request: jsonb().notNull(),         // ombi lililotumwa TeePay — linarudiwa NENO KWA NENO na Idempotency-Key ileile
  teepayId: text(),                   // id ya muamala kwa mtoa huduma (TeePay au Abliner)
  reference: text().unique(),         // reference ya mtoa huduma (TeePay public_reference / Abliner reference)
  status: mobilePaymentStatusEnum().notNull().default('SENDING'),
  statusDetail: text(),               // cancelled / expired
  channel: text(),
  lastError: text(),
  lastSyncedAt: timestamp({ withTimezone: true }),
  paidAt: timestamp({ withTimezone: true }),
  platformPaymentId: uuid(),
  isTest: boolean().notNull().default(false),   // malipo ya majaribio (hayapunguzi ada)
  abandonedAt: timestamp({ withTimezone: true }), // Meneja ameghairi (push haikufika) — bado yanahakikiwa TeePay
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [index().on(t.feeId), index().on(t.status)]);

// Majina yaliyosajiliwa kwenye mobile money (Abliner Name Lookup) — akiba ili kupunguza gharama na kuongeza kasi
export const phoneNameLookups = pgTable('phone_name_lookups', {
  phone: text().primaryKey(),         // 2557XXXXXXXX
  status: text().notNull(),           // FOUND | NOT_FOUND
  name: text(),                       // jina kama lilivyosajiliwa (mf. "JOHN JUMA DOE")
  network: text(),
  checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Kila tukio la webhook ya TeePay linaandikwa mara moja tu (X-TeePay-Event-ID)
export const teepayEvents = pgTable('teepay_events', {
  id: text().primaryKey(),
  type: text().notNull(),
  payload: jsonb().notNull(),
  receivedAt: createdAt(),
});

export const platformExpenses = pgTable('platform_expenses', {
  id: id(),
  category: expenseCategoryEnum().notNull(),
  amount: money().notNull(),
  description: text().notNull(),
  vendor: text(),
  spentAt: date().notNull(),
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [index().on(t.spentAt)]);

export const businessTargets = pgTable('business_targets', {
  id: id(),
  period: text().notNull(),           // YYYY au YYYY-MM
  metric: text().notNull(),           // REVENUE | NEW_AMCOS | ACTIVE_SUBSCRIPTIONS
  targetValue: numeric({ precision: 18, scale: 2 }).notNull(),
  notes: text(),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.period, t.metric)]);

export const platformSettings = pgTable('platform_settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedById: uuid(),
  updatedAt: updatedAt(),
});

export const announcements = pgTable('announcements', {
  id: id(),
  kind: announcementKindEnum().notNull(),
  title: text().notNull(),
  body: text().notNull(),
  audience: text().notNull(),         // ALL | SELECTED
  amcosIds: uuid().array(),
  channels: text().array().notNull(), // IN_APP, SMS, EMAIL
  sentAt: timestamp({ withTimezone: true }),
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [index().on(t.createdAt)]);

export const announcementDeliveries = pgTable('announcement_deliveries', {
  id: id(),
  announcementId: uuid().notNull().references(() => announcements.id),
  amcosId: uuid().references(() => amcos.id),
  channel: text().notNull(),
  recipient: text(),
  status: deliveryStatusEnum().notNull().default('QUEUED'),
  providerRef: text(),
  error: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index().on(t.announcementId), index().on(t.amcosId)]);

export const loginEvents = pgTable('login_events', {
  id: id(),
  userId: uuid(),
  phone: text(),
  success: boolean().notNull(),
  reason: text(),                     // OK, UNKNOWN_PHONE, BAD_PASSWORD, INACTIVE, AMCOS_SUSPENDED, BAD_2FA, 2FA_REQUIRED
  suspicious: boolean().notNull().default(false),
  ip: text(),
  userAgent: text(),
  createdAt: createdAt(),
}, (t) => [index().on(t.userId, t.createdAt), index().on(t.createdAt), index().on(t.phone, t.createdAt)]);

export const userSessions = pgTable('user_sessions', {
  id: id(),
  userId: uuid().notNull().references(() => users.id),
  ip: text(),
  userAgent: text(),
  createdAt: createdAt(),
  lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  revokedAt: timestamp({ withTimezone: true }),
  revokedById: uuid(),
}, (t) => [index().on(t.userId, t.revokedAt)]);

export const systemErrors = pgTable('system_errors', {
  id: id(),
  method: text(),
  path: text(),
  status: integer(),
  message: text(),
  stack: text(),
  userId: uuid(),
  createdAt: createdAt(),
}, (t) => [index().on(t.createdAt)]);

export const jobRuns = pgTable('job_runs', {
  id: id(),
  name: text().notNull(),
  status: text().notNull(),           // RUNNING | SUCCESS | FAILED | SKIPPED
  details: jsonb(),
  startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
}, (t) => [index().on(t.name, t.startedAt)]);

export const backupRecords = pgTable('backup_records', {
  id: id(),
  kind: text().notNull(),             // RAILWAY | EXPORT | OTHER
  status: backupStatusEnum().notNull(),
  sizeBytes: integer(),
  location: text(),
  notes: text(),
  takenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [index().on(t.takenAt)]);

export const restoreRequests = pgTable('restore_requests', {
  id: id(),
  backupId: uuid().references(() => backupRecords.id),
  reason: text().notNull(),
  status: restoreStatusEnum().notNull().default('REQUESTED'),
  requestedById: uuid(),
  decidedById: uuid(),
  decidedAt: timestamp({ withTimezone: true }),
  decisionNotes: text(),
  createdAt: createdAt(),
});

// =====================================================================
//  UHASIBU KAMILI WA CHAMA (Mhasibu) — daftari kuu la double-entry
//   - Kila muamala wa chama unakuwa "journal" yenye debit = credit (trigger inakagua)
//   - Journal haibadilishwi wala kufutwa: inasahihishwa kwa journal ya kinyume (reversalOfId)
//   - Fedha za chama HAZICHANGANYWI na za CoopLink
// =====================================================================
export const glAccountTypeEnum = pgEnum('gl_account_type', ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);
export const payrollStatusEnum = pgEnum('payroll_status', ['PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED']);
export const assetStatusEnum = pgEnum('asset_status', ['ACTIVE', 'DISPOSAL_PENDING', 'DISPOSED']);

/** Chati ya akaunti (chart of accounts) ya kila chama. */
export const glAccounts = pgTable('gl_accounts', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  code: text().notNull(),
  name: text().notNull(),
  type: glAccountTypeEnum().notNull(),
  subtype: text(),                       // CASH, RECEIVABLE, PAYABLE, FIXED_ASSET ... (kwa ripoti)
  isSystem: boolean().notNull().default(false),
  isActive: boolean().notNull().default(true),
  financeAccountId: uuid().unique(),     // akaunti ya fedha (taslimu/benki/simu) inayowakilishwa
  description: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.code)]);

export const journalEntries = pgTable('journal_entries', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  entryNo: text().notNull(),
  entryDate: date().notNull(),
  description: text().notNull(),
  source: text().notNull(),              // FINANCE_TXN, INPUT_ISSUE, TOBACCO_SALE, PAYROLL, DEPRECIATION, MANUAL ...
  sourceId: uuid(),
  reference: text(),
  approvalId: uuid(),
  reversalOfId: uuid().unique().references((): AnyPgColumn => journalEntries.id),
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex().on(t.amcosId, t.entryNo),
  uniqueIndex().on(t.amcosId, t.source, t.sourceId),
  index().on(t.amcosId, t.entryDate),
]);

export const journalLines = pgTable('journal_lines', {
  id: id(),
  journalEntryId: uuid().notNull().references(() => journalEntries.id),
  amcosId: uuid().notNull().references(() => amcos.id),
  glAccountId: uuid().notNull().references(() => glAccounts.id),
  debit: money().notNull().default('0'),
  credit: money().notNull().default('0'),
  memo: text(),
  memberId: uuid(),
  supplierId: uuid(),
  lineNo: integer().notNull().default(1),
}, (t) => [index().on(t.journalEntryId), index().on(t.amcosId, t.glAccountId)]);

/** Vipindi vilivyofungwa: hakuna journal wala muamala unaoandikwa kwa tarehe hii au kabla yake (trigger ya DB). */
export const periodLocks = pgTable('period_locks', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  lockedThrough: date().notNull(),
  kind: text().notNull(),               // PERIOD | YEAR_END
  note: text(),
  approvalId: uuid(),
  journalEntryId: uuid(),               // journal ya kufunga mwaka (YEAR_END)
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [index().on(t.amcosId, t.lockedThrough)]);

// ------------------------------ MISHAHARA ------------------------------
export const employees = pgTable('employees', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  employeeNo: text().notNull(),
  fullName: text().notNull(),
  position: text().notNull(),
  phone: text(),
  basicSalary: money().notNull(),
  allowances: money().notNull().default('0'),
  otherDeductions: money().notNull().default('0'),   // mf. marejesho ya mkopo wa mshahara
  nssfNo: text(),
  tin: text(),
  paymentMethod: paymentMethodEnum().notNull().default('BANK'),
  bankName: text(),
  accountNumber: text(),
  startDate: date(),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.employeeNo)]);

export const payrollRuns = pgTable('payroll_runs', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  runNo: text().notNull(),
  period: text().notNull(),               // YYYY-MM
  status: payrollStatusEnum().notNull().default('PENDING_APPROVAL'),
  totalGross: money().notNull(),
  totalPaye: money().notNull(),
  totalNssfEmployee: money().notNull(),
  totalNssfEmployer: money().notNull(),
  totalWcf: money().notNull(),
  totalSdl: money().notNull(),
  totalOtherDeductions: money().notNull(),
  totalNet: money().notNull(),
  approvalId: uuid(),
  paidTxnId: uuid(),
  notes: text(),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex().on(t.amcosId, t.runNo),
  uniqueIndex('payroll_runs_one_per_period').on(t.amcosId, t.period).where(sql`status in ('PENDING_APPROVAL', 'APPROVED', 'PAID')`),
]);

export const payrollLines = pgTable('payroll_lines', {
  id: id(),
  payrollRunId: uuid().notNull().references(() => payrollRuns.id),
  employeeId: uuid().notNull().references(() => employees.id),
  basicSalary: money().notNull(),
  allowances: money().notNull(),
  gross: money().notNull(),
  nssfEmployee: money().notNull(),
  taxable: money().notNull(),
  paye: money().notNull(),
  otherDeductions: money().notNull(),
  net: money().notNull(),
  nssfEmployer: money().notNull(),
  wcf: money().notNull(),
  sdl: money().notNull(),
}, (t) => [uniqueIndex().on(t.payrollRunId, t.employeeId)]);

// ------------------------------ MALI ZA CHAMA ------------------------------
export const fixedAssets = pgTable('fixed_assets', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  assetNo: text().notNull(),
  name: text().notNull(),
  category: text().notNull(),             // BUILDING, VEHICLE, EQUIPMENT, FURNITURE, COMPUTER, LAND, OTHER
  acquisitionDate: date().notNull(),
  cost: money().notNull(),
  residualValue: money().notNull().default('0'),
  usefulLifeMonths: integer().notNull(),  // 0 = haichakai (mf. ardhi)
  location: text(),
  serialNo: text(),
  fundingTxnId: uuid(),                   // muamala uliolipia (kama haipo: ni mali iliyokuwepo -> salio la kuanzia)
  status: assetStatusEnum().notNull().default('ACTIVE'),
  disposedAt: date(),
  disposalNote: text(),
  disposalApprovalId: uuid(),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.assetNo)]);

export const depreciationRuns = pgTable('depreciation_runs', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  period: text().notNull(),               // YYYY-MM
  total: money().notNull(),
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.period)]);

export const depreciationLines = pgTable('depreciation_lines', {
  id: id(),
  runId: uuid().notNull().references(() => depreciationRuns.id),
  assetId: uuid().notNull().references(() => fixedAssets.id),
  amount: money().notNull(),
}, (t) => [uniqueIndex().on(t.runId, t.assetId), index().on(t.assetId)]);

// ------------------------------ USULUHISHO WA BENKI ------------------------------
export const bankReconciliations = pgTable('bank_reconciliations', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  accountId: uuid().notNull().references(() => financeAccounts.id),
  statementDate: date().notNull(),
  statementBalance: money().notNull(),
  bookBalance: money().notNull(),
  clearedBalance: money().notNull(),
  unclearedIn: money().notNull(),
  unclearedOut: money().notNull(),
  notes: text(),
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [index().on(t.amcosId, t.accountId, t.statementDate)]);

export const bankReconciliationItems = pgTable('bank_reconciliation_items', {
  id: id(),
  reconciliationId: uuid().notNull().references(() => bankReconciliations.id),
  financeTxnId: uuid().notNull().unique().references(() => financeTransactions.id), // muamala unasuluhishwa mara moja tu
});

// =====================================================================
//  VIKUNDI VYA WAKULIMA (dhamana ya pamoja)
//  Kila mkulima ana deni lake la pembejeo; kikundi kizima kinadhamini. Mwanachama akishindwa kumaliza
//  deni lake kwenye mauzo, salio linakatwa kwa wenzake wa kikundi (kwa uwiano wa malipo yao).
// =====================================================================
export const groupStatusEnum = pgEnum('group_status', ['PENDING', 'ACTIVE', 'REJECTED', 'INACTIVE']);

export const memberGroups = pgTable('member_groups', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  groupNo: text().notNull(),
  name: text().notNull(),
  village: text(),
  leaderMemberId: uuid(),
  status: groupStatusEnum().notNull().default('PENDING'),
  approvalId: uuid(),
  notes: text(),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.groupNo), uniqueIndex().on(t.amcosId, t.name)]);

export const memberGroupMembers = pgTable('member_group_members', {
  id: id(),
  groupId: uuid().notNull().references(() => memberGroups.id),
  memberId: uuid().notNull().references(() => members.id),
  joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp({ withTimezone: true }),
  addedById: uuid(),
  removedById: uuid(),
  removeReason: text(),
}, (t) => [
  index().on(t.groupId),
  // mkulima mmoja yuko kwenye kikundi kimoja tu kwa wakati mmoja
  uniqueIndex('member_one_active_group').on(t.memberId).where(sql`left_at is null`),
]);

// =====================================================================
//  PESA YA KUNI — mikopo ya fedha kwa wakulima (kuandaa kuni za kukaushia tumbaku)
//  Kikomo: ekari za makisio yaliyoidhinishwa x kiasi kwa ekari. Riba: asilimia moja kwa msimu.
//  Mhasibu anaandaa orodha -> Meneja anaidhinisha -> pesa zinatumwa kwenye akaunti za wakulima
//  -> Mhasibu anathibitisha waliolipwa. Deni (mkopo + riba) linakatwa kwenye mauzo pamoja na pembejeo.
// =====================================================================
export const kuniSettings = pgTable('kuni_settings', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  interestRate: numeric({ precision: 6, scale: 3 }).notNull().default('0'), // % kwa msimu
  amountPerAcre: money().notNull().default('0'),                           // kikomo: TZS kwa ekari
  isOpen: boolean().notNull().default(true),
  updatedById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.seasonId)]);

export const kuniBatches = pgTable('kuni_batches', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  batchNo: text().notNull(),
  status: paymentBatchStatusEnum().notNull().default('DRAFT'),
  interestRate: numeric({ precision: 6, scale: 3 }).notNull(),
  totalAmount: money().notNull(),
  totalInterest: money().notNull(),
  approvalId: uuid(),
  notes: text(),
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.amcosId, t.batchNo)]);

export const kuniLoans = pgTable('kuni_loans', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  batchId: uuid().notNull().references(() => kuniBatches.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  memberId: uuid().notNull().references(() => members.id),
  amount: money().notNull(),     // mkopo (principal)
  interest: money().notNull(),   // riba (inaongezwa kwenye deni pesa zikitumwa)
  method: paymentMethodEnum().notNull(),
  provider: text(),
  destination: text().notNull(),
  status: paymentStatusEnum().notNull().default('PENDING'),
  financeTxnId: uuid(),
  providerRef: text(),
  paidAt: timestamp({ withTimezone: true }),
  failureReason: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index().on(t.batchId), index().on(t.amcosId, t.seasonId, t.memberId)]);

// ---------------------------------------------------------------------
//  RELATIONS (kwa db.query.*)
// ---------------------------------------------------------------------
export const amcosRelations = relations(amcos, ({ one }) => ({
  union: one(unions, { fields: [amcos.unionId], references: [unions.id] }),
}));
export const membersRelations = relations(members, ({ one, many }) => ({
  amcos: one(amcos, { fields: [members.amcosId], references: [amcos.id] }),
  farms: many(farms),
}));
export const farmsRelations = relations(farms, ({ one }) => ({
  member: one(members, { fields: [farms.memberId], references: [members.id] }),
}));
export const inputIssuesRelations = relations(inputIssues, ({ one, many }) => ({
  member: one(members, { fields: [inputIssues.memberId], references: [members.id] }),
  lines: many(inputIssueLines),
}));
export const purchaseRequestsRelations = relations(purchaseRequests, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseRequests.supplierId], references: [suppliers.id] }),
  lines: many(purchaseRequestLines),
}));
export const purchaseRequestLinesRelations = relations(purchaseRequestLines, ({ one }) => ({
  purchaseRequest: one(purchaseRequests, { fields: [purchaseRequestLines.purchaseRequestId], references: [purchaseRequests.id] }),
  inputItem: one(inputItems, { fields: [purchaseRequestLines.inputItemId], references: [inputItems.id] }),
}));
export const inputIssueLinesRelations = relations(inputIssueLines, ({ one }) => ({
  inputIssue: one(inputIssues, { fields: [inputIssueLines.inputIssueId], references: [inputIssues.id] }),
  inputItem: one(inputItems, { fields: [inputIssueLines.inputItemId], references: [inputItems.id] }),
}));

// ---------------------------------------------------------------------
//  TIKETI ZA MSAADA — watumishi wa chama wanaomba msaada; timu ya DUKALANGU inajibu.
//  Muda wa jibu la kwanza (SLA, Mkataba Kifungu 9.4): Dharura saa 2, Kubwa saa 8, Kawaida siku 2.
// ---------------------------------------------------------------------
export const ticketCategoryEnum = pgEnum('ticket_category', ['PAYMENT', 'BUG', 'TRAINING', 'FEATURE', 'OTHER']);
export const ticketPriorityEnum = pgEnum('ticket_priority', ['URGENT', 'HIGH', 'NORMAL']);
export const ticketStatusEnum = pgEnum('ticket_status', ['OPEN', 'IN_PROGRESS', 'ANSWERED', 'CLOSED']);

export const supportTickets = pgTable('support_tickets', {
  id: id(),
  ticketNo: integer().generatedAlwaysAsIdentity({ startWith: 1001 }),
  amcosId: uuid().notNull().references(() => amcos.id),
  createdById: uuid().notNull().references(() => users.id),
  category: ticketCategoryEnum().notNull(),
  priority: ticketPriorityEnum().notNull().default('NORMAL'),
  status: ticketStatusEnum().notNull().default('OPEN'),
  subject: text().notNull(),
  context: jsonb(),                                  // ukurasa, toleo la mfumo, kivinjari
  assignedToId: uuid().references(() => users.id),   // mfanyakazi wa DUKALANGU
  dueAt: timestamp({ withTimezone: true }).notNull(), // mwisho wa jibu la kwanza
  firstResponseAt: timestamp({ withTimezone: true }),
  lastAmcosAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastPlatformAt: timestamp({ withTimezone: true }),
  amcosSeenAt: timestamp({ withTimezone: true }),
  closedAt: timestamp({ withTimezone: true }),
  closedById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex().on(t.ticketNo), index().on(t.amcosId, t.status), index().on(t.status, t.dueAt), index().on(t.assignedToId)]);

export const supportMessages = pgTable('support_messages', {
  id: id(),
  ticketId: uuid().notNull().references(() => supportTickets.id),
  authorId: uuid().notNull().references(() => users.id),
  side: text().notNull(),                            // AMCOS | PLATFORM
  internal: boolean().notNull().default(false),      // maelezo ya ndani ya timu ya DUKALANGU (chama hakioni)
  body: text().notNull(),
  createdAt: createdAt(),
}, (t) => [index().on(t.ticketId, t.createdAt)]);

/** Picha za skrini (JPEG iliyopunguzwa) — kwenye database kwa sababu diski ya Railway hufutika kila deploy. */
export const supportAttachments = pgTable('support_attachments', {
  id: id(),
  ticketId: uuid().notNull().references(() => supportTickets.id),
  messageId: uuid().notNull().references(() => supportMessages.id),
  mimeType: text().notNull(),
  data: text().notNull(),                            // base64
  sizeBytes: integer().notNull(),
  createdAt: createdAt(),
}, (t) => [index().on(t.messageId)]);
