// export const prerender = false;
// import app from "../../server/index";
// import type { APIRoute } from "astro";

// export const ALL: APIRoute = async ({ request, session }) => {
//   const url = new URL(request.url);
//   const sessionData = {
//     user: await session?.get("user"),
//     loginTime: await session?.get("loginTime"),
//   };

//   const init: RequestInit = {
//     method: request.method,
//     headers: {
//       ...Object.fromEntries(request.headers.entries()),
//       "x-session-data": JSON.stringify(sessionData),
//     },
//   };

//   if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
//     (init as any).duplex = "half";
//     init.body = request.body;
//   }

//   const modifiedRequest = new Request(url, init);

//   const response = await app.fetch(modifiedRequest);
//   const clonedResponse = response.clone();

//   if (!response.ok) {
//     const bodyText = await clonedResponse.text().catch(() => "<no body>");
//     console.error(
//       "Proxy -> Hono non-OK response",
//       response.status,
//       response.statusText,
//       bodyText,
//     );
//     return response;
//   }

//   if (url.pathname.startsWith("/api/auth/")) {
//     const contentType = response.headers.get("content-type") ?? "";
//     if (contentType.includes("application/json")) {
//       try {
//         const data = await clonedResponse.json();
//         if (data?.sessionUpdate) {
//           await session?.set("user", data.user ?? null);
//           await session?.set("loginTime", data.sessionUpdate.loginTime);
//         }
//       } catch (err) {
//         console.error("Failed to parse JSON from auth response:", err);
//       }
//     }
//   }

//   return response;
// };

// export type App = typeof app;

export const prerender = false
import type { APIRoute } from 'astro'
import app from '../../server/index'

export const ALL: APIRoute = async ({ request }) => {
  if (
    request.method !== 'GET' &&
    request.method !== 'HEAD' &&
    request.body
  ) {
    return app.fetch(request)
  }
  return app.fetch(request)
}

export type App = typeof app