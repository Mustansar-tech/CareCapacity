import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Configure connection pool with retry logic and timeouts
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Wait 10 seconds for a connection
});

// Handle pool errors gracefully
pool.on('error', (err) => {
  console.error('❌ Unexpected database pool error:', err);
});

// Add connection retry wrapper
export const db = drizzle({ client: pool, schema });

// Helper function for query retry logic
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`❌ Database operation failed (attempt ${attempt}/${maxRetries}):`, error);

      if (attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      const waitTime = delay * Math.pow(2, attempt - 1);
      console.log(`⏳ Retrying in ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  throw new Error('Database operation failed after all retries');
}