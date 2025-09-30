import path from "node:path";
import { existsSync } from "node:fs";
import { resolveDbPath } from "../utils/file";
import { DuckDBInstance } from "@duckdb/node-api";
import type { Preview, Team, User } from "./schema";
import type { DuckDBConnection } from "@duckdb/node-api";
import { CREATE_TEAMS_TABLE, CREATE_USERS_TABLE } from "./schema";

export const AUTH_DB = "auth.duckdb";

export async function withDuckDB<T>(
    fn: (conn: DuckDBConnection) => Promise<T> | T,
    fileName?: string,
): Promise<T> {
    const filePath = fileName ? resolveDbPath(fileName) : ":memory:";
    const instance = await DuckDBInstance.fromCache(filePath);
    const conn = await instance.connect();
    try {
        return await fn(conn);
    } catch (err) {
        console.error("DuckDB error", { fileName, err });
        throw err;
    } finally {
        conn.disconnectSync();
    }
}

export async function initDb(
    mockData?: (conn: DuckDBConnection) => Promise<void>,
) {
    await withDuckDB(
        async (conn) => {
            await conn.run(CREATE_TEAMS_TABLE);
            await conn.run(CREATE_USERS_TABLE);
            if (mockData) {
                await mockData(conn);
            }
        },
        AUTH_DB,
    );
}

export async function getAllTeams(conn: DuckDBConnection): Promise<Team[]> {
    const result = await conn.run("SELECT * FROM teams");
    return await result.getRowObjectsJS() as Team[];
}

export async function getUsersByTeam(
    conn: DuckDBConnection,
    teamId: string,
): Promise<User[]> {
    const result = await conn.run("SELECT * FROM users WHERE team_id = ?", [
        teamId,
    ]);
    return await result.getRowObjectsJS() as User[];
}

export async function getPreviewData(
    conn: DuckDBConnection,
): Promise<Preview[]> {
    const result = await conn.run("SELECT * FROM preview");
    return await result.getRowObjectsJS() as Preview[];
}

export async function getUser(
    conn: DuckDBConnection,
    userId: string,
): Promise<User | null> {
    const result = await conn.run("SELECT * FROM users WHERE id = ?", [userId]);
    return await result.getRowObjectsJS() as User[];
}

export async function createOrUpdateUser(conn: DuckDBConnection, user: User) {
    const result = await conn.run(
        `INSERT INTO users (id, email, name, team_id, role) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET 
            email=excluded.email, name=excluded.name, 
            team_id=excluded.team_id, role=excluded.role
        `,
        [user.id, user.email, user.name, user.teamId, user.role],
    );
    return await result.getRowObjectsJS() as User[];
}

export async function createOrUpdateTeam(conn: DuckDBConnection, team: Team) {
    const result = await conn.run(
        `INSERT INTO teams (id, name) VALUES (?, ?)
        ON CONFLICT (id) DO UPDATE SET name=excluded.name`,
        [team.id, team.name],
    );
    return await result.getRowObjectsJS() as Team[];
}

export function getStageTableDDL(tableName: string, headers: string[]) {
    const cols = headers.map((h) => `"${h}" VARCHAR`).join(", ");
    return `CREATE TEMP TABLE "${tableName}" (sheet VARCHAR, ${cols})`;
}

export function getInsertSQL(tableName: string, headers: string[]) {
    const cols = headers.map((h) => `"${h}"`).join(", ");
    const qs = headers.map(() => "?").join(", ");
    return `INSERT INTO "${tableName}" (sheet, ${cols}) VALUES (?, ${qs})`;
}

// export async function writeTeamParquet(
//     teamId: string,
//     sheet: string,
//     headers: string[],
//     rows: Array<Record<string, unknown>>,
// ) {
//     const dir = path.join(TEAMS_DIR, teamId);
//     const parquetPath = path.join(dir, `${teamId}.parquet`);
//     const tmpPath = parquetPath + ".tmp";
//     const exists = fs.existsSync(parquetPath);

//     await withDuckDB(async (conn) => {
//         const stage = `stage_${Date.now()}`;
//         await conn.run(getStageTableDDL(stage, headers));
//         await conn.run("BEGIN");
//         const stg = await conn.prepare(getInsertSQL(stage, headers));
//         for (const row of rows) {
//             const values = headers.map((h) => row[h] ?? null);
//             stg.bind([
//                 sheet,
//                 ...values as (string | number | boolean | null)[],
//             ]);
//             await stg.run();
//         }
//         await conn.run("COMMIT");

//         if (exists) {
//             await conn.run(
//                 `COPY (
//             SELECT * FROM read_parquet('${parquetPath}')
//             UNION ALL
//             SELECT * FROM "${stage}"
//          ) TO '${tmpPath}' (FORMAT 'parquet')`,
//             );
//             fs.renameSync(tmpPath, parquetPath);
//         } else {
//             await conn.run(
//                 `COPY "${stage}" TO '${parquetPath}' (FORMAT 'parquet')`,
//             );
//         }
//     });
//     return { filePath: parquetPath };
// }
