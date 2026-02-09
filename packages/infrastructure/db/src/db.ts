import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Database connection - expects DATABASE_URL environment variable
const connectionString = process.env.DATABASE_URL || '';

if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
}

// Create postgres client
const client = postgres(connectionString);

// Create drizzle instance with schema
export const db = drizzle(client, { schema });

// Export schema for use in repositories
export { schema };
