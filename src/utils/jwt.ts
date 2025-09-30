import { type JWTPayload, jwtVerify, SignJWT } from "jose";
import type { User } from "../server/db/schema";

const JWT_SECRET = new TextEncoder().encode(
    import.meta.env.JWT_SECRET,
);

export interface JWTUserPayload extends JWTPayload {
    user: User;
    loginTime: number;
}

export const generateJWT = async (user: User): Promise<string> => {
    const token = await new SignJWT({
        user,
        loginTime: Date.now(),
    })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("7d")
        .sign(JWT_SECRET);

    return token;
};

export const verifyJWT = async (
    token: string,
): Promise<JWTUserPayload | null> => {
    try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        return payload as JWTUserPayload;
    } catch (error) {
        console.error("JWT verification failed:", error);
        return null;
    }
};

export const extractJWTFromCookies = (
    cookieHeader: string | null,
): string | null => {
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
    const authCookie = cookies.find((cookie) =>
        cookie.startsWith("auth-token=")
    );

    if (!authCookie) return null;

    return authCookie.split("=")[1];
};

export const createJWTCookie = (token: string): string => {
    const maxAge = 7 * 24 * 60 * 60;
    return `auth-token=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}; Path=/`;
};
