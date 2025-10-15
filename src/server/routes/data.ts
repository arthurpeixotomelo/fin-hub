import { Hono } from "hono";
import { getAllTeams, resolveDbPath, withDuckDB } from "../db/index.ts";

const data = new Hono();

data.get("/teams", async (ctx) => {
    try {
        const teams = await withDuckDB(async (conn) => await getAllTeams(conn));
        return ctx.json(teams);
    } catch (e) {
        return ctx.json({ error: (e as Error).message }, 500);
    }
});

// Get available versions for a team
data.get("/teams/:teamName/versions", async (ctx) => {
    const teamName = ctx.req.param("teamName");
    
    try {
        const versions = await withDuckDB(async (conn) => {
            const result = await conn.run(
                `SELECT DISTINCT version, MAX(updated_at) as last_updated
                 FROM preview 
                 WHERE team_name = ? 
                 GROUP BY version 
                 ORDER BY version DESC`,
                [teamName]
            );
            return await result.getRowObjectsJS();
        });
        return ctx.json({ versions });
    } catch (err) {
        return ctx.json({ error: (err as Error).message }, 500);
    }
});

// Get preview data with filters
data.get("/preview", async (ctx) => {
    const teamName = ctx.req.query("teamName");
    const version = ctx.req.query("version");
    const limit = parseInt(ctx.req.query("limit") || "1000");
    const offset = parseInt(ctx.req.query("offset") || "0");

    try {
        const result = await withDuckDB(async (conn) => {
            let query = `
                SELECT 
                    cod,
                    itens_periodo,
                    segmentos,
                    file_paths,
                    sheet_name,
                    team_name,
                    dat_ref,
                    value,
                    version,
                    updated_at
                FROM preview
                WHERE 1=1
            `;
            const params: (string | number)[] = [];

            if (teamName) {
                query += " AND team_name = ?";
                params.push(teamName);
            }

            if (version) {
                query += " AND version = ?";
                params.push(parseInt(version));
            }

            query += " ORDER BY dat_ref DESC, cod ASC LIMIT ? OFFSET ?";
            params.push(limit, offset);

            const result = await conn.run(query, params);
            const rows = await result.getRowObjectsJS();

            // Get total count
            let countQuery = "SELECT COUNT(*)::INT as total FROM preview WHERE 1=1";
            const countParams: (string | number)[] = [];
            
            if (teamName) {
                countQuery += " AND team_name = ?";
                countParams.push(teamName);
            }
            
            if (version) {
                countQuery += " AND version = ?";
                countParams.push(parseInt(version));
            }

            const countResult = await conn.run(countQuery, countParams);
            const countRows = await countResult.getRowObjectsJS();
            const total = (countRows[0] as any)?.total || 0;

            return { rows, total };
        });

        return ctx.json(result);
    } catch (err) {
        return ctx.json({ error: (err as Error).message }, 500);
    }
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
