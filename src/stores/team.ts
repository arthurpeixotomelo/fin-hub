import { create } from "zustand";

export interface Team {
  id: number;
  name: string;
}

export type TeamStatus = "idle" | "loading" | "done" | "error";

interface TeamState {
  teams: Team[];
  currentTeamId: number | null;
  status: TeamStatus;
  error: string | null;
  fetchTeams: () => Promise<void>;
  setTeam: (id: number | null) => void;
  clear: () => void;
}

export const useTeamStore = create<TeamState>((set, get) => ({
  teams: [],
  currentTeamId: null,
  status: "idle",
  error: null,

  fetchTeams: async () => {
    const { status, teams, currentTeamId } = get();
    if (status === "loading" || (teams.length > 0 && currentTeamId != null)) return;

    set({ status: "loading", error: null });

    try {
    //   const url = new URL("/api/data/teams", import.meta.env.BASE_URL).toString();
      const res = await fetch(`${import.meta.env.BASE_URL}/api/data/teams`);
      if (!res.ok) throw new Error(`Failed to fetch teams (${res.status})`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) throw new Error("No teams returned");

      const clean = data.filter(
        (team) => team && typeof team.id === "number" && typeof team.name === "string"
      ) as Team[];

      if (clean.length === 0) throw new Error("No valid teams returned");

      set((state) => ({
        teams: clean,
        status: "done",
        currentTeamId: state.currentTeamId ?? clean[0].id,
      }));
    } catch (error) {
      set({
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        teams: [],
        currentTeamId: null,
      });
    }
  },

  setTeam: (id) => set({ currentTeamId: id }),

  clear: () =>
    set({
      teams: [],
      currentTeamId: null,
      status: "idle",
      error: null,
    }),
}));
