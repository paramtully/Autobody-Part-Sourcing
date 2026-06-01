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
    const sql = process.env.VERCEL
        ? postgres(connectionString, { max: 1, idle_timeout: 20, connect_timeout: 10 })
        : postgres(connectionString);
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
