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
import { relations } from 'drizzle-orm';

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
]);
export const genderEnum = pgEnum('gender', ['MALE', 'FEMALE']);
export const memberStatusEnum = pgEnum('member_status', ['ACTIVE', 'SUSPENDED', 'EXITED', 'DECEASED']);
export const mobileMoneyProviderEnum = pgEnum('mobile_money_provider', ['MPESA', 'AIRTEL_MONEY', 'MIXX_BY_YAS', 'HALOPESA', 'TPESA']);
export const seasonStatusEnum = pgEnum('season_status', ['PLANNING', 'ACTIVE', 'MARKETING', 'CLOSED']);
export const estimateStatusEnum = pgEnum('estimate_status', ['DRAFT', 'APPROVED', 'REJECTED']);
export const inputCategoryEnum = pgEnum('input_category', ['FERTILIZER', 'SEED', 'CHEMICAL', 'PACKAGING', 'EQUIPMENT', 'OTHER']);
export const inputUnitEnum = pgEnum('input_unit', ['BAG', 'KG', 'LITRE', 'ROLL', 'PIECE', 'PACKET']);
export const stockMovementTypeEnum = pgEnum('stock_movement_type', ['RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT']);
export const inputIssueStatusEnum = pgEnum('input_issue_status', ['ISSUED', 'CANCELLED']);
export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', [
  'INPUT_LOAN',      // Deni la pembejeo (debit)
  'CASH_LOAN',       // Mkopo wa fedha (debit)
  'TOBACCO_SALE',    // Mauzo ya tumbaku (credit)
  'DEDUCTION',       // Makato (debit)
  'PAYMENT',         // Malipo aliyopokea mkulima (debit)
  'ADJUSTMENT',
  'REVERSAL',
  'OPENING_BALANCE',
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
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index().on(t.unionId)]);

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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index().on(t.amcosId), index().on(t.unionId)]);

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
  createdById: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex().on(t.amcosId, t.memberNo),
  uniqueIndex().on(t.amcosId, t.nidaNumber),
  index().on(t.amcosId, t.lastName),
  index().on(t.amcosId, t.phone),
  index().on(t.amcosId, t.status),
]);

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
  createdById: uuid(),
  createdAt: createdAt(),
}, (t) => [index().on(t.amcosId, t.seasonId, t.inputItemId)]);

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
}, (t) => [index().on(t.settlementId)]);

export const paymentBatches = pgTable('payment_batches', {
  id: id(),
  amcosId: uuid().notNull().references(() => amcos.id),
  seasonId: uuid().notNull().references(() => seasons.id),
  batchNo: text().notNull(),
  totalAmount: money().notNull(),
  status: paymentBatchStatusEnum().notNull().default('DRAFT'),
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
export const inputIssueLinesRelations = relations(inputIssueLines, ({ one }) => ({
  inputIssue: one(inputIssues, { fields: [inputIssueLines.inputIssueId], references: [inputIssues.id] }),
  inputItem: one(inputItems, { fields: [inputIssueLines.inputItemId], references: [inputItems.id] }),
}));
