/**
 * SQLite adapter — uses Prisma with a SQLite-compatible schema.
 *
 * Setup instructions:
 *   1. Copy `prisma/schema.sqlite.prisma` → `prisma/schema.prisma`
 *   2. Set `DATABASE_URL=file:./data/chisato.db` in .env
 *   3. Run `npx prisma migrate dev` to create the database file
 *
 * Great choice for local development or lightweight self-hosting.
 */
import { MongoDBAdapter } from "./mongodb.adapter";

export class SQLiteAdapter extends MongoDBAdapter {
    constructor() {
        // PrismaClient is instantiated via the parent; Prisma reads DATABASE_URL
        // automatically. Ensure schema.sqlite.prisma has been used to generate
        // @prisma/client before running with this adapter.
        super();
    }
}
