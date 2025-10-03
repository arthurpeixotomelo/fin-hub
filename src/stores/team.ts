import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Team {
    id: number;
    name: string;
}

type TeamStatus = "idle" | "loading" | "ready" | "error";

interface TeamState {
    teams: Team[];
    currentTeamId: number | null;
    status: TeamStatus;
    error: string | null;
    lastFetched: number | null;
    fetchTeams: (opts?: { force?: boolean }) => Promise<void>;
    setTeam: (id: number | null) => void;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const useTeamStore = create<TeamState>()(persist(
    (set, get) => ({
        teams: [],
        currentTeamId: null,
        status: "idle",
        error: null,
        lastFetched: null,
        fetchTeams: async ({ force } = {}) => {
            const { status, lastFetched, teams: currentTeams, currentTeamId } = get();
            const now = Date.now();
            console.log('[TeamStore] fetchTeams called - force:', force, 'status:', status, 'currentTeamId:', currentTeamId, 'teams:', currentTeams.length);
            
            if (!force && status === "loading") return;
            if (!force && lastFetched && (now - lastFetched) < CACHE_TTL_MS && currentTeams.length > 0) {
                // Cache still fresh - ensure a team is selected
                const nextTeamId = currentTeamId ?? currentTeams[0]?.id ?? null;
                console.log('[TeamStore] Using cached teams, setting teamId to:', nextTeamId);
                set({ 
                    status: "ready",
                    currentTeamId: nextTeamId
                });
                return;
            }
            set({ status: "loading", error: null });
            try {
                console.log('[TeamStore] Fetching teams from API...');
                const r = await fetch("/api/data/teams");
                if (!r.ok) throw new Error("Failed to fetch teams");
                const data = await r.json();
                const teams = Array.isArray(data) ? data : Array.isArray(data?.teams) ? data.teams : [];
                const nextTeamId = currentTeamId ?? teams[0]?.id ?? null;
                console.log('[TeamStore] Fetched teams:', teams.length, 'setting teamId to:', nextTeamId);
                set({
                    teams,
                    status: "ready",
                    lastFetched: Date.now(),
                    currentTeamId: nextTeamId
                });
            } catch (e) {
                console.error('[TeamStore] Error fetching teams:', e);
                set({ error: (e as Error).message, status: "error" });
            }
        },
        setTeam: (id) => {
            console.log('[TeamStore] setTeam called with:', id);
            set({ currentTeamId: id });
        },
    }),
    {
        name: 'team-store',
        partialize: (s) => ({
            teams: s.teams,
            currentTeamId: s.currentTeamId,
            lastFetched: s.lastFetched,
        }),
        onRehydrateStorage: () => (state) => {
            // After rehydration, ensure a team is selected if we have teams
            if (state && state.teams.length > 0 && state.currentTeamId == null) {
                // Use setTimeout to avoid state mutation during rehydration
                setTimeout(() => {
                    const current = useTeamStore.getState();
                    if (current.teams.length > 0 && current.currentTeamId == null) {
                        useTeamStore.setState({ currentTeamId: current.teams[0].id });
                    }
                }, 0);
            }
        }
    }
));
