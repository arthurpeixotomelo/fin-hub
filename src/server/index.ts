import { Hono } from "hono";
import data from "./routes/data";
import upload from "./routes/upload";
import dbQuery from "./routes/dbQuery";
import { initDb } from "./db/index.ts";

await initDb(import.meta.env.SEED_MOCK === "true");

const app = new Hono().basePath(`${import.meta.env.BASE_URL ?? ""}/api`);

app.route("/data", data);
app.route("/upload", upload);
app.route("/db-query", dbQuery);
app.use("/", async (ctx) => ctx.text("Hono backend is running!"));

export default app;
