/**
 * PostgreSQL adapter — uses Prisma with a PostgreSQL-compatible schema.
 *
 * Setup instructions:
 *   1. Copy `prisma/schema.postgres.prisma` → `prisma/schema.prisma`
 *   2. Set `DATABASE_URL=postgresql://user:password@host:5432/dbname` in .env
 *   3. Run `npx prisma migrate dev` to create the tables
 *
 * The API is identical to MongoDBAdapter; only the underlying schema differs.
 */
import { MongoDBAdapter } from "./mongodb.adapter";

export class PostgresAdapter extends MongoDBAdapter {
    constructor() {
        // PrismaClient is instantiated via the parent; Prisma reads DATABASE_URL
        // automatically. Simply ensure schema.postgres.prisma has been used to
        // generate @prisma/client before running with this adapter.
        super();
    }
}
