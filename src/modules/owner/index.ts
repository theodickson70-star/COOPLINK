// OWNER CONTROL PANEL — /api/v1/owner/*
// Kila njia: lazima uwe mtumiaji wa jukwaa (requirePlatform) + ruhusa maalum (requirePermission).
import { Router } from 'express';
import { requirePlatform } from '../../middleware/auth';
import { dashboardRouter } from './dashboard.routes';
import { ownerAmcosRouter } from './amcos.routes';
import { subscriptionsRouter } from './subscriptions.routes';
import { financeRouter } from './finance.routes';
import { financeDeskRouter } from './finance-desk.routes';
import { staffRouter } from './staff.routes';
import { systemRouter } from './system.routes';
import { commsRouter } from './comms.routes';
import { securityRouter } from './security.routes';
import { backupRouter } from './backup.routes';
import { businessRouter } from './business.routes';
import { ownerFeesRouter } from './fees.routes';
import { ownerSupportRouter } from './support.routes';
import { ownerSmsRouter } from './sms.routes';
import { leadsRouter } from './leads.routes';
import { customersRouter } from './customers.routes';

export const ownerRouter = Router();
ownerRouter.use(requirePlatform);
ownerRouter.use('/dashboard', dashboardRouter);
ownerRouter.use('/amcos', ownerAmcosRouter);
ownerRouter.use('/subscriptions', subscriptionsRouter);
ownerRouter.use('/finance', financeDeskRouter);   // dashibodi ya kazi, madeni, bajeti, taarifa ya mteja
ownerRouter.use('/finance', financeRouter);
ownerRouter.use('/staff', staffRouter);
ownerRouter.use('/system', systemRouter);
ownerRouter.use('/comms', commsRouter);
ownerRouter.use('/security', securityRouter);
ownerRouter.use('/backup', backupRouter);
ownerRouter.use('/business', businessRouter);
ownerRouter.use('/fees', ownerFeesRouter);
ownerRouter.use('/support', ownerSupportRouter);
ownerRouter.use('/sms', ownerSmsRouter);
ownerRouter.use('/leads', leadsRouter);           // CRM: Huduma kwa Wateja na Masoko
ownerRouter.use('/customers', customersRouter);   // afya ya wateja, makundi, maelezo ya timu, msaada wa akaunti
