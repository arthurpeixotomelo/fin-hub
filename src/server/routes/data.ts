import { Hono } from "hono";
import { AUTH_DB, getAllTeams, withDuckDB } from "../db/index.ts";
import { resolveDbPath } from "../utils/file.ts";

const data = new Hono();

data.get("/teams", async (ctx) => {
    const teams = await withDuckDB(async (conn) => {
        return await getAllTeams(conn);
    }, AUTH_DB);
    return ctx.json(teams);
});

data.get("/temp/:fileName", async (ctx) => {
    const fileName = ctx.req.param("fileName");
    const result = await withDuckDB(async (conn) => {
        const res = await conn.run(
            `SELECT * FROM read_parquet('${resolveDbPath(fileName)}')`,
        );
        return await res.getRowObjectsJS();
    });
    return ctx.json(result);
});

export default data;
