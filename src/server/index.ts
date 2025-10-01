import { Hono } from "hono";
import data from "./routes/data";
import upload from "./routes/upload";
import dbQuery from "./routes/dbQuery";
import { initDb } from "./db/index.ts";
import { seedMockData } from "./db/mock.ts";

await initDb(seedMockData);

const app = new Hono().basePath(`/api`);

app.route("/data", data);
app.route("/upload", upload);
app.route("/db-query", dbQuery);
// app.use("/", (ctx) => ctx.text("Hono backend is running!"));
// app.route('/upload-to-db', uploadToDB)

export default app;
