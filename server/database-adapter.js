import { loadLocalEnv } from './env.js';

loadLocalEnv();
const usePostgres = Boolean(process.env.DATABASE_URL);
const database = usePostgres
  ? await import('./database-postgres.js')
  : await import('./database.js');

export const databaseDriver = usePostgres ? 'postgres' : 'sqlite';

export const {
  createExtraction,
  countUsers,
  createAuditLog,
  createRelation,
  createReport,
  createSite,
  createUser,
  deleteRelation,
  deleteReport,
  getProduct,
  getReport,
  getSetting,
  getSite,
  getUser,
  initDatabase,
  findUserByUsername,
  latestExtraction,
  latestSuccessfulExtraction,
  listOwnProductsWithRelations,
  listProducts,
  listRelations,
  listReports,
  listSites,
  listSpecs,
  listSettings,
  listUsers,
  markUserLogin,
  setProductHidden,
  setOwnSite,
  unsetOwnSite,
  updateReportAnalysis,
  updateSite,
  updateSiteExtractRule,
  updateSpecManually,
  updateSpecsManually,
  updateUserPassword,
  upsertSetting,
  upsertProducts,
  upsertSpecs,
  setUserActive,
} = database;
