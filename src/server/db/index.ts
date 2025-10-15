import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import type { Preview, Team, User } from "./schema.ts";
import {
    CREATE_PREVIEW_TABLE,
    CREATE_TEAMS_TABLE,
    CREATE_USERS_TABLE,
} from "./schema.ts";
import TEAMS from "./data/teams.json" with { type: "json" };
import USERS from "./data/users.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function resolveDbPath(fileName?: string): string {
    const dbPath = resolve(__dirname, "data");
    
    if (!existsSync(dbPath)) {
        mkdirSync(dbPath, { recursive: true });
    }

    return fileName ? resolve(dbPath, fileName) : dbPath;
}

export async function withDuckDB<T>(
    fn: (conn: DuckDBConnection) => Promise<T> | T,
    inMemory?: boolean,
): Promise<T> {
    const filePath = inMemory ? ":memory:" : resolveDbPath("db.duckdb");
    const instance = await DuckDBInstance.fromCache(filePath);
    const conn = await instance.connect();
    try {
        return await fn(conn);
    } catch (err) {
        console.error("DuckDB error", { filePath, err });
        throw err;
    } finally {
        conn.disconnectSync();
    }
}

export async function initDb(mockData?: boolean) {
    await withDuckDB(async (conn) => {
        await conn.run(CREATE_TEAMS_TABLE);
        await conn.run(CREATE_USERS_TABLE);
        await conn.run(CREATE_PREVIEW_TABLE);
        if (mockData) {
            for (const team of TEAMS) {
                await createOrUpdateTeam(conn, {
                    id: team.id,
                    name: team.name,
                } as Team);
            }
            for (const user of USERS as Array<Record<string, unknown>>) {
                const mapped: User = {
                    id: String(user.id),
                    email: String(user.email),
                    name: String(user.name),
                    teamId: Number(user.team_id),
                    role: (user.role as User["role"]) || "user",
                };
                await createOrUpdateUser(conn, mapped);
            }
        }
    });
}

export async function getAllTeams(conn: DuckDBConnection): Promise<Team[]> {
    const result = await conn.run("SELECT id, name, updated_at FROM teams");
    const rows = await result.getRowObjectsJS() as unknown as Array<
        { id: number; name: string; updated_at?: string }
    >;
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        updatedAt: r.updated_at ? new Date(r.updated_at) : undefined,
    }));
}

export async function getUsersByTeam(
    conn: DuckDBConnection,
    teamId: string,
): Promise<User[]> {
    const result = await conn.run(
        "SELECT id, email, name, team_id, role, updated_at FROM users WHERE team_id = ?",
        [teamId],
    );
    const rows = await result.getRowObjectsJS() as unknown as Array<
        {
            id: string;
            email: string;
            name: string;
            team_id: number;
            role: string;
            updated_at?: string;
        }
    >;
    return rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        teamId: r.team_id,
        role: r.role as User["role"],
        updatedAt: r.updated_at ? new Date(r.updated_at) : undefined,
    }));
}

export async function getPreviewData(
    conn: DuckDBConnection,
): Promise<Preview[]> {
    const result = await conn.run(
        "SELECT cod, itens_periodo, segmentos, file_paths, sheet_name, team_name, dat_ref, value, version, updated_at FROM preview",
    );
    const rows = await result.getRowObjectsJS() as unknown as Array<
        {
            cod: number;
            itens_periodo: string;
            segmentos: string;
            file_paths: string;
            sheet_name: string;
            team_name: string;
            dat_ref: string;
            value: number;
            version: number;
            updated_at?: string;
        }
    >;
    return rows.map((r) => ({
        ...r,
        dat_ref: new Date(r.dat_ref),
        updated_at: r.updated_at ? new Date(r.updated_at) : undefined,
    }));
}

export async function getUser(
    conn: DuckDBConnection,
    userId: string,
): Promise<User | null> {
    const result = await conn.run(
        "SELECT id, email, name, team_id, role FROM users WHERE id = ?",
        [userId],
    );
    const rows = await result.getRowObjectsJS() as Array<{
        id: string;
        email: string;
        name: string;
        team_id: number;
        role: string;
    }>;
    const r = rows[0];
    if (!r) return null;
    return {
        id: r.id,
        email: r.email,
        name: r.name,
        teamId: r.team_id,
        role: r.role as User["role"],
    };
}

export async function createOrUpdateUser(
    conn: DuckDBConnection,
    user: User,
): Promise<void> {
    await conn.run(
        `INSERT INTO users (id, email, name, team_id, role) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET 
                email=excluded.email, name=excluded.name, 
                team_id=excluded.team_id, role=excluded.role`,
        [user.id, user.email, user.name, user.teamId ?? null, user.role],
    );
}

export async function createOrUpdateTeam(
    conn: DuckDBConnection,
    team: Team,
): Promise<void> {
    await conn.run(
        `INSERT INTO teams (id, name) VALUES (?, ?)
            ON CONFLICT (id) DO UPDATE SET name=excluded.name`,
        [team.id, team.name],
    );
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
