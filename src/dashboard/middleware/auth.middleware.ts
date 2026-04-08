import { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken } from "../routes/auth";
import { databaseService } from "../../infrastructure/database";

// Session expires after 30 minutes of inactivity
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const publicPaths = [
        "/login.html", 
        "/api/auth/login", 
        "/api/auth/logout",
        "/api/health"
    ];
    
    const staticPaths = ["/js/", "/css/", "/images/", "/favicon.ico"];
    
    if (publicPaths.some(path => request.url === path || request.url.startsWith(path))) {
        return;
    }
    
    if (staticPaths.some(path => request.url.startsWith(path))) {
        return;
    }
    
    if (request.url === "/" || request.url === "/index.html" || !request.url.startsWith("/api/")) {
        return;
    }

    // For API endpoints, enforce token authentication
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.status(401).send({
            success: false,
            message: "Unauthorized - No token provided",
        });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
        return reply.status(401).send({
            success: false,
            message: "Unauthorized - Invalid token",
        });
    }

    // Check session expiry based on lastActivity
    try {
        const admin = await databaseService.getAdminById(decoded.id);

        if (!admin) {
            return reply.status(401).send({
                success: false,
                message: "Unauthorized - User not found",
            });
        }

        const timeSinceLastActivity = Date.now() - admin.lastActivity.getTime();

        if (timeSinceLastActivity > SESSION_TIMEOUT_MS) {
            return reply.status(401).send({
                success: false,
                message: "Session expired due to inactivity",
                sessionExpired: true,
            });
        }

        // Update last activity timestamp
        await databaseService.updateAdmin(admin.id, { lastActivity: new Date() });

        // Attach user info to request
        (request as any).admin = decoded;
    } catch (error) {
        return reply.status(500).send({
            success: false,
            message: "Internal server error",
        });
    }
}
