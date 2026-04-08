import { FastifyInstance } from "fastify";
import { databaseService } from "../../infrastructure/database";

export async function usersRoutes(fastify: FastifyInstance) {
    // Get all users
    fastify.get("/", async (request, reply) => {
        try {
            const {
                page = 1,
                limit = 10,
                role,
                search = "",
                banned,
            } = request.query as {
                page?: number;
                limit?: number;
                role?: string;
                search?: string;
                banned?: string;
            };

            const skip = (Number(page) - 1) * Number(limit);

            const { data: users, total } = await databaseService.findUsers({
                role: role as any,
                isBanned: banned === "banned" ? true : banned === "active" ? false : undefined,
                search: search || undefined,
                skip,
                take: Number(limit),
            });

            return {
                users: users.map((u) => ({
                    userId: u.userId,
                    name: u.name,
                    limit: u.limit,
                    role: u.role,
                    expired: u.expired,
                    isBanned: u.isBanned,
                    afk: u.afk,
                    isExpired: u.expired > 0 && u.expired < Date.now(),
                    expiresAt: u.expired > 0 ? new Date(u.expired).toISOString() : null,
                    afkSince:
                        u.afk?.since && u.afk.since > 0
                            ? new Date(u.afk.since).toISOString()
                            : null,
                })),
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
            };
        } catch (error) {
            reply.status(500).send({ error: "Failed to fetch users" });
        }
    });

    // Get single user details
    fastify.get("/:userId", async (request, reply) => {
        try {
            const { userId } = request.params as { userId: string };
            const user = await databaseService.getUser(userId);

            if (!user) {
                return reply.status(404).send({ error: "User not found" });
            }

            return {
                ...user,
                isExpired: user.expired > 0 && user.expired < Date.now(),
                expiresAt: user.expired > 0 ? new Date(user.expired).toISOString() : null,
                afkSince:
                    user.afk?.since && user.afk.since > 0
                        ? new Date(user.afk.since).toISOString()
                        : null,
            };
        } catch (error) {
            reply.status(500).send({ error: "Failed to fetch user" });
        }
    });

    // Get premium users
    fastify.get("/premium/list", async (request, reply) => {
        try {
            const { data: users } = await databaseService.findUsers({ role: "premium" });

            return {
                total: users.length,
                users: users.map((u) => ({
                    userId: u.userId,
                    name: u.name,
                    expired: u.expired,
                    limit: u.limit,
                    isExpired: u.expired > 0 && u.expired < Date.now(),
                    expiresAt: u.expired > 0 ? new Date(u.expired).toISOString() : null,
                })),
            };
        } catch (error) {
            reply.status(500).send({ error: "Failed to fetch premium users" });
        }
    });

    // Get AFK users
    fastify.get("/afk/list", async (request, reply) => {
        try {
            const allUsers = await databaseService.getAllUsers();
            const users = allUsers.filter((u) => u.afk?.status === true);

            return {
                total: users.length,
                users: users.map((u) => ({
                    userId: u.userId,
                    name: u.name,
                    reason: u.afk?.reason,
                    since:
                        u.afk?.since && u.afk.since > 0
                            ? new Date(u.afk.since).toISOString()
                            : null,
                })),
            };
        } catch (error) {
            reply.status(500).send({ error: "Failed to fetch AFK users" });
        }
    });

    // Get banned users
    fastify.get("/banned/list", async (request, reply) => {
        try {
            const { data: users } = await databaseService.findUsers({ isBanned: true });

            return {
                total: users.length,
                users: users.map((u) => ({
                    userId: u.userId,
                    name: u.name,
                    isBanned: u.isBanned,
                })),
            };
        } catch (error) {
            reply.status(500).send({ error: "Failed to fetch banned users" });
        }
    });

    // Get users statistics
    fastify.get("/stats/summary", async (request, reply) => {
        try {
            const users = await databaseService.getAllUsers();
            const now = Date.now();
            let totalLimit = 0;
            let maxLimit = 0;
            let minLimit = 0;

            if (users.length) {
                minLimit = users[0].limit;
                for (const user of users) {
                    totalLimit += user.limit;
                    if (user.limit > maxLimit) maxLimit = user.limit;
                    if (user.limit < minLimit) minLimit = user.limit;
                }
            }

            const stats = {
                totalUsers: users.length,
                byRole: {
                    free: users.filter((u) => u.role === "free").length,
                    premium: users.filter((u) => u.role === "premium").length,
                },
                premium: {
                    active: users.filter(
                        (u) => u.role === "premium" && (u.expired === 0 || u.expired > now)
                    ).length,
                    expired: users.filter(
                        (u) => u.role === "premium" && u.expired > 0 && u.expired < now
                    ).length,
                },
                afk: {
                    total: users.filter((u) => u.afk?.status).length,
                },
                limits: users.length
                    ? {
                        average: totalLimit / users.length,
                        max: maxLimit,
                        min: minLimit,
                    }
                    : { average: 0, max: 0, min: 0 },
            };

            return stats;
        } catch (error) {
            reply.status(500).send({ error: "Failed to fetch statistics" });
        }
    });

    // Create new user
    fastify.post("/", async (request, reply) => {
        try {
            const { userId, name, role, limit, expired } = request.body as {
                userId: string;
                name?: string;
                role?: "free" | "premium";
                limit?: number;
                expired?: number;
            };

            if (!userId) {
                return reply.status(400).send({ error: "userId is required" });
            }

            const existingUser = await databaseService.getUser(userId);
            if (existingUser) {
                return reply.status(409).send({ error: "User already exists" });
            }

            const user = await databaseService.createUser({
                userId,
                name: name ?? null,
                role: role ?? "free",
                limit: limit ?? 20,
                expired: expired ?? 0,
            });

            return { success: true, message: "User created successfully", user };
        } catch (error) {
            reply.status(500).send({ error: "Failed to create user" });
        }
    });

    // Update user
    fastify.put("/:userId", async (request, reply) => {
        try {
            const { userId } = request.params as { userId: string };
            const { name, role, limit, expired } = request.body as {
                name?: string;
                role?: "free" | "premium";
                limit?: number;
                expired?: number;
            };

            const existingUser = await databaseService.getUser(userId);
            if (!existingUser) {
                return reply.status(404).send({ error: "User not found" });
            }

            const updateData: any = {};
            if (name !== undefined) updateData.name = name;
            if (role !== undefined) updateData.role = role;
            if (limit !== undefined) updateData.limit = limit;
            if (expired !== undefined) updateData.expired = expired;

            const user = await databaseService.updateUser(userId, updateData);
            return { success: true, message: "User updated successfully", user };
        } catch (error) {
            reply.status(500).send({ error: "Failed to update user" });
        }
    });

    // Delete user
    fastify.delete("/:userId", async (request, reply) => {
        try {
            const { userId } = request.params as { userId: string };

            const existingUser = await databaseService.getUser(userId);
            if (!existingUser) {
                return reply.status(404).send({ error: "User not found" });
            }

            await databaseService.deleteUser(userId);
            return { success: true, message: "User deleted successfully" };
        } catch (error) {
            reply.status(500).send({ error: "Failed to delete user" });
        }
    });
}
