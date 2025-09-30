import type { Team, User } from "./schema";
import type { DuckDBConnection } from "@duckdb/node-api";

export const mockTeams: Team[] = [
    {
        id: 0,
        name: "CFO",
    },
    {
        id: 1,
        name: "Creditos",
    },
    {
        id: 2,
        name: "Investimentos",
    }
];

export const mockUsers: User[] = [
    {
        id: "z123456",
        email: "z123456@example.com.br",
        name: "Arthur",
        team_id: 0,
        role: "admin",
    },
];

export async function seedMockData(conn: DuckDBConnection) {
    for (const team of mockTeams) {
        await conn.run(
            `INSERT INTO teams (id, name) VALUES (?, ?)
            ON CONFLICT (id) DO UPDATE SET name=excluded.name`,
            [team.id, team.name],
        );
    }
    for (const user of mockUsers) {
        await conn.run(
            `INSERT INTO users (id, email, name, team_id, role) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET 
                email=excluded.email, name=excluded.name, 
                team_id=excluded.team_id, role=excluded.role
            `,
            [user.id, user.email, user.name, user.team_id, user.role],
        );
    }
}