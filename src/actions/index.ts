import { z } from "astro:schema";
import type { AstroCookies } from "astro";
import { defineAction } from "astro:actions";
import type { User } from "@db/schema";
import { generateJWT, verifyJWT } from "../utils/jwt";
import { createOrUpdateUser, getUser, withDuckDB } from "@db";

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
      const user = await withDuckDB(async (conn) => {
        return await getUser(conn, userId.toLowerCase().trim());
      });

      if (!user) {
        return {
          success: false,
          error: "User not found. Please complete registration.",
          needsRegistration: true,
          userId,
        };
      }

      const token = await generateJWT(user);

      setAuthCookie(cookies, token);

      return { success: true, user: user, token };
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
        const user = await withDuckDB(
          async (conn) => {
            return await createOrUpdateUser(conn, {
              id: userData.id.trim(),
              email: userData.email.trim(),
              name: userData.name.trim(),
              team: userData.team.trim(),
            });
          },
        );

        if (!user) {
          throw new Error("User creation failed");
        }

        const token = await generateJWT(user);

        setAuthCookie(cookies, token);

        return { success: true, user: user, token };
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
