import { verifyJWT } from "./jwt";
import type { APIContext } from "astro";
import type { User } from "../server/db/schema";

export interface AuthenticatedContext extends APIContext {
    locals: APIContext["locals"] & {
        user: User;
        loginTime: number;
    };
}

export const withAuth = async (
    context: APIContext,
): Promise<AuthenticatedContext | null> => {
    const authToken = context.cookies.get("auth-token")?.value;

    if (!authToken) {
        return null;
    }

    const payload = await verifyJWT(authToken);

    if (!payload) {
        context.cookies.delete("auth-token", { path: "/" });
        return null;
    }

    context.locals.user = payload.user;
    context.locals.loginTime = payload.loginTime;

    return context as AuthenticatedContext;
};

export const requireAuth = async (
    context: APIContext,
): Promise<AuthenticatedContext> => {
    const authenticatedContext = await withAuth(context);

    if (!authenticatedContext) {
        throw new Response("Unauthorized", { status: 401 });
    }

    return authenticatedContext;
};
