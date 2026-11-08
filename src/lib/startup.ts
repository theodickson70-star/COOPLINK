// Hali ya kuwaka kwa server (migrations + uhakiki wa schema) — kwa /health na System Control Center.
import type { MigrationReport } from '../db/migrator';
import type { SchemaCheck } from '../db/verify-schema';

let state: { migrations?: MigrationReport; schema?: SchemaCheck; at?: string } = {};
export const setStartupState = (s: { migrations: MigrationReport; schema: SchemaCheck }) => { state = { ...s, at: new Date().toISOString() }; };
export const startupState = () => state;
