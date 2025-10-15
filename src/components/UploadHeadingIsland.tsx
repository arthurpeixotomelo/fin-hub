import { useEffect } from "react"
import Heading from "./Atoms/Heading.tsx"
import { useTeamStore } from "@stores/team.ts"

export default function UploadHeadingIsland() {
  const teams = useTeamStore(state => state.teams)
  const currentTeamId = useTeamStore(state => state.currentTeamId)
  const status = useTeamStore(state => state.status)
  const error = useTeamStore(state => state.error)
  const fetchTeams = useTeamStore(state => state.fetchTeams)
  const setTeam = useTeamStore(state => state.setTeam)

  // Fetch on first idle OR if we have teams but no selection (rehydration case)
  useEffect(() => {
    if (status === "idle" || currentTeamId == null) {
      void fetchTeams()
    }
  }, [status, currentTeamId, fetchTeams])

  // Ensure selection if teams present and still null (fallback)
  useEffect(() => {
    if (teams.length > 0 && currentTeamId == null) {
      setTeam(teams[0].id)
    }
  }, [teams, currentTeamId, setTeam])

  const isLoading = status === "loading" || status === "idle"

  const selectValue = currentTeamId ?? (teams.length > 0 ? teams[0].id : '')

  return (
    <Heading title="Upload" level={1} id="header-center">
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        {isLoading && teams.length === 0 && (
          <span style={{ fontSize: "0.75rem" }}>Loading teams…</span>
        )}
        {status === "error" && (
          <span style={{ color: "var(--color-danger)", fontSize: "0.75rem" }}>
            {error}
          </span>
        )}
        {teams.length > 0 && (
          <select
            value={selectValue}
            onChange={event =>
              setTeam(event.target.value ? Number(event.target.value) : null)
            }
            aria-label="Select team"
          >
            {teams.map(team => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </Heading>
  )
}
