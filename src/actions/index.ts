import type { AstroCookies } from "astro";
import { z } from "astro:schema";
import { defineAction } from "astro:actions";
import { AUTH_DB, createOrUpdateUser, getUser, withDuckDB } from "../server/db";
import type { User } from "../server/db/schema";
import { generateJWT, verifyJWT } from "../utils/jwt";

const setAuthCookie = (cookies: AstroCookies, token: string) => {
  cookies.set("auth-token", token, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });
};

export const server = {
  login: defineAction({
    accept: "form",
    input: z.object({
      userId: z.string().min(1).max(9),
    }),
    handler: async ({ userId }, { cookies }) => {
      const users = await withDuckDB(async (conn) => {
        return await getUser(conn, userId.toLowerCase().trim());
      }, AUTH_DB);

      const authenticatedUser = users?.[0];

      if (!authenticatedUser) {
        return {
          success: false,
          error: "User not found. Please complete registration.",
          needsRegistration: true,
          userId,
        };
      }

      const token = await generateJWT(authenticatedUser);

      setAuthCookie(cookies, token);

      return { success: true, user: authenticatedUser, token };
    },
  }),

  register: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1).max(9),
      email: z.string().email(),
      name: z.string().min(2),
      team: z.enum(["CFO", "Internal"]),
    }),
    handler: async (userData: User, { cookies }) => {
      try {
        const users = await withDuckDB(
          async (conn) => {
            return await createOrUpdateUser(conn, {
              id: userData.id.trim(),
              email: userData.email.trim(),
              name: userData.name.trim(),
              team: userData.team.trim(),
            });
          },
          AUTH_DB,
        );

        const createdUser = users?.[0];

        if (!createdUser) {
          throw new Error("User creation failed");
        }

        const token = await generateJWT(createdUser);

        setAuthCookie(cookies, token);

        return { success: true, user: createdUser, token };
      } catch (_err) {
        return {
          success: false,
          error:
            "Registration failed. This User ID or email might already be taken.",
          needsRegistration: true,
          userId: userData.id,
        };
      }
    },
  }),

  checkAuth: defineAction({
    accept: "json",
    handler: async (_input, { cookies }) => {
      const token = cookies.get("auth-token")?.value;
      if (!token) return { user: null };

      const payload = await verifyJWT(token);
      if (!payload) {
        cookies.delete("auth-token", { path: "/" });
        return { user: null };
      }

      return { user: payload.user };
    },
  }),
};
