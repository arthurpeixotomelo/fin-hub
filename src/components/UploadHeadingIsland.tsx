import { useEffect } from "react";
import Heading from "./Atoms/Heading.tsx";
import { useTeamStore } from "@stores/team.ts";

export default function UploadHeadingIsland() {
    const teams = useTeamStore((s) => s.teams);
    const currentTeamId = useTeamStore((s) => s.currentTeamId);
    const status = useTeamStore((s) => s.status);
    const error = useTeamStore((s) => s.error);
    const fetchTeams = useTeamStore((s) => s.fetchTeams);
    const setTeam = useTeamStore((s) => s.setTeam);

    console.log('[UploadHeadingIsland] RENDER - status:', status, 'teams:', teams.length, 'currentTeamId:', currentTeamId);

    useEffect(() => {
        console.log('[UploadHeadingIsland] Effect 1 - status:', status, 'teams.length:', teams.length);
        if (status === "idle" || (teams.length === 0 && status !== "loading")) {
            console.log('[UploadHeadingIsland] Triggering fetchTeams...');
            fetchTeams();
        }
    }, [status, teams.length, fetchTeams]);

    useEffect(() => {
        console.log('[UploadHeadingIsland] Effect 2 - teams:', teams.length, 'currentTeamId:', currentTeamId);
        if (teams.length > 0 && (currentTeamId == null)) {
            console.log('[UploadHeadingIsland] Auto-selecting team:', teams[0].id);
            setTeam(teams[0].id);
        }
    }, [teams, currentTeamId, setTeam]);

    const isLoading = status === "loading" || status === "idle";

    return (
        <Heading title="Upload" level={1}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                {isLoading && teams.length === 0 && (
                    <span style={{ fontSize: "0.75rem" }}>Loading…</span>
                )}
                {error && teams.length === 0 && (
                    <span style={{ color: "var(--color-danger)", fontSize: "0.75rem" }}>{error}</span>
                )}
                {teams.length > 0 && (
                    <select
                        value={currentTeamId ?? teams[0].id}
                        onChange={(e) => setTeam(e.target.value ? Number(e.target.value) : null)}
                        style={{ padding: "0.25rem 0.5rem" }}
                        aria-label="Select team"
                    >
                        {teams.map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                )}
                {/* <button
                    type="button"
                    onClick={() => fetchTeams({ force: true })}
                    disabled={status === "loading"}
                    style={{
                        fontSize: "0.65rem",
                        background: "transparent",
                        border: "1px solid var(--color-border, #ccc)",
                        padding: "0.15rem 0.4rem",
                        borderRadius: 4,
                        cursor: "pointer",
                        opacity: status === "loading" ? 0.5 : 1,
                    }}
                    title="Refresh teams"
                >↻</button> */}
            </div>
        </Heading>
    );
}
