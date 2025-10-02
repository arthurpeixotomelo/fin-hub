import { Hono } from "hono";
import data from "./routes/data";
import upload from "./routes/upload";
import dbQuery from "./routes/dbQuery";
import { initDb } from "./db/index.ts";
import { seedMockData } from "./db/mock.ts";

await initDb(seedMockData);

const BASE_URL = import.meta.env.BASE_URL ? import.meta.env.BASE_URL : "";
const app = new Hono().basePath(`${BASE_URL}/api`);

app.route("/data", data);
app.route("/upload", upload);
app.route("/db-query", dbQuery);
app.use("/", async (ctx) => ctx.text("Hono backend is running!"));

export default app;
