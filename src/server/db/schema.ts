export const CREATE_USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,  
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  team_id SMALLINT DEFAULT NULL REFERENCES teams(id),
  role TEXT DEFAULT 'user',                 -- 'admin' | 'user'
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export interface User {
  id: string;
  email: string;
  name: string;
  teamId: number | null;
  role: "admin" | "user";
  updatedAt?: Date;
}

export const CREATE_TEAMS_TABLE = `
CREATE TABLE IF NOT EXISTS teams (
  id SMALLINT PRIMARY KEY,
  name TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export interface Team {
  id: number;
  name: string;
  updatedAt?: Date;
}

export const CREATE_PREVIEW_TABLE = `
CREATE TABLE IF NOT EXISTS preview (
  cod SMALLINT NOT NULL,
  itens_periodo TEXT NOT NULL,
  segmentos TEXT NOT NULL,
  file_paths TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  team_name TEXT NOT NULL,
  dat_ref DATE NOT NULL,
  value DECIMAL(38, 10) NOT NULL,
  version SMALLINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- PRIMARY KEY (cod, team_name, dat_ref, version)
);
`;

export interface Preview {
  cod: number;
  itens_periodo: string;
  segmentos: string;
  file_paths: string;
  sheet_name: string;
  team_name: string;
  dat_ref: Date;
  value: number;
  version: number;
  updated_at?: Date;
}

// export const CREATE_ROLE_PERMISSIONS_TABLE = `
// CREATE TABLE IF NOT EXISTS role_permissions (
//   id TEXT PRIMARY KEY,
//   auth_group TEXT NOT NULL,                -- 'CFO' | 'Internal' | 'Commercial'
//   action TEXT NOT NULL,
//   allowed BIT DEFAULT 0
// );
// `;

// export interface RolePermissions {
//   id: string;
//   authGroup: string;
//   action: string;
//   allowed: boolean;
// }
