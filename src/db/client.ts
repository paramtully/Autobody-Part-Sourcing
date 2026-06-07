import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './models/index.js';

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let dbInstance: DrizzleDb | undefined;

function createDb(): DrizzleDb {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is required');
    }
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    // Supavisor transaction pooler (:6543) rejects prepared statements and long interactive txs.
    const isTxPooler = connectionString.includes(':6543');
    const sql = postgres(connectionString, {
        ...(isServerless ? { max: 1, idle_timeout: 20, connect_timeout: 10 } : {}),
        ...(isTxPooler ? { prepare: false } : {}),
    });
    return drizzle(sql, { schema });
}

function getDb(): DrizzleDb {
    if (!dbInstance) {
        dbInstance = createDb();
    }
    return dbInstance;
}

/** Lazy DB handle — does not connect until first query (allows /health without DATABASE_URL). */
export const db = new Proxy({} as DrizzleDb, {
    get(_target, prop, receiver) {
        return Reflect.get(getDb() as object, prop, receiver);
    },
});

export type Db = DrizzleDb;
