import DataTable from "../DataTable.tsx"
import { useQuery } from "@tanstack/react-query"
import type { ChangeEvent, ReactNode } from "react"
import { formatFileSize } from "@utils/helper.ts"
import { Dialog, Progress } from "radix-ui"
import Button from "../Atoms/Button.tsx"
import styles from "@styles/UploadFlow.module.css"
import { useUploadStore } from "@stores/upload.ts"
import { useTeamStore } from "@stores/team.ts"
import type { ErrorSeverity } from "@utils/errors"
import { useShallow } from "zustand/shallow"
import Heading from "@components/Atoms/Heading.tsx"

export default function UploadFlow(): ReactNode {
  const { fileName, status } = useUploadStore(useShallow(s => ({
    fileName: s.fileName,
    status: s.status
  })))
  const hasError = status === "error"

  const parquetQuery = useQuery({
    queryKey: ["parquet-data", fileName],
    enabled: !!fileName,
    queryFn: async () => {
      if (!fileName) return []
      const res = await fetch(
        `${import.meta.env.BASE_URL}/api/data/temp/${encodeURIComponent(fileName)}`
      )
      if (!res.ok) throw new Error("Failed to fetch data")
      return await res.json() as Record<string, unknown>[]
    }
  })

  return (
    <section className={styles.uploadFlow}>
      <FileInput />
      {status === "processing" && <ProgressBar />}
      {fileName && (
        <DataTable
          rows={parquetQuery.data || []}
          loading={parquetQuery.isLoading}
          error={parquetQuery.error}
          pageSize={10}
        />
      )}
      {status !== "idle" && <Actions />}
      {hasError && <ErrorModal />}
    </section>
  )
}

export function FileInput(): ReactNode {
  const { file, start, status } = useUploadStore(useShallow(s => ({
    file: s.file,
    start: s.start,
    status: s.status
  })))

  const isUploading = status === "processing"
  const hasFile = !!file

  const isValidXlsx = (candidate: File) =>
    candidate.name.endsWith(".xlsx") &&
    candidate.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    if (!selected) return
    if (!isValidXlsx(selected)) {
      window.alert("Invalid file format. Please select an .xlsx file.")
      event.target.value = ""
      return
    }
    start(selected)
    event.target.value = ""
  }

  const title = hasFile ? file.name : "Upload your Excel file"
  const subtitle = hasFile && file ? formatFileSize(file.size) : "Supported format: .xlsx"

  return (
    <label
      className={styles.uploadArea}
      data-state={hasFile ? "selected" : "empty"}
      aria-disabled={isUploading}
    >
      <input
        className={styles.hiddenInput}
        type="file"
        accept=".xlsx"
        onChange={handleFileChange}
        disabled={isUploading}
        required
      />
      <Heading
        level={2}
        title={title}
        className={[
          styles.uploadTitle,
          hasFile ? styles.uploadTitleSelected : ""
        ].filter(Boolean).join(" ")}
      />
      <p
        className={[
          styles.uploadSubtitle,
          hasFile ? styles.uploadSubtitleSelected : ""
        ].filter(Boolean).join(" ")}
      >
        {subtitle}
      </p>
      {/* <h2 className={styles.uploadTitle}>{title}</h2>
      <p className={styles.uploadSubtitle}>{subtitle}</p> */}
    </label>
  )
}

export function ProgressBar(): ReactNode {
  const { jobId, status, progress, setProgress } = useUploadStore(useShallow(s => ({
    jobId: s.jobId,
    status: s.status,
    progress: s.progress,
    setProgress: s.setProgress
  })))

  useQuery<{
    progress: number
    status: "idle" | "processing" | "done" | "error"
    error?: string
    errorSeverity?: ErrorSeverity
  }>({
    queryKey: ["upload-progress", jobId],
    enabled: !!jobId && status === "processing",
    refetchInterval: query => {
      const current = query.state.data
      return current?.status === "processing" ? 250 : false
    },
    queryFn: async () => {
      if (!jobId) return { progress: 0, status: "idle" as const }
      const res = await fetch(
        `${import.meta.env.BASE_URL}/api/upload/progress/${jobId}`
      )
      if (!res.ok) throw new Error(`Failed to fetch progress (${res.status})`)
      const data = await res.json() as {
        progress: number
        status: "idle" | "processing" | "done" | "error"
        error?: string
        errorSeverity?: ErrorSeverity
      }
      setProgress(data)
      return data
    }
  })

  if (status !== "processing") return null

  return (
    <section className={styles.progressSection} aria-busy={status === "processing"}>
      <p className={styles.progressLabel}>Stage: {status} • {progress}%</p>
      <Progress.Root className={styles.progressRoot} value={progress} max={100}>
        <Progress.Indicator
          className={styles.progressIndicator}
          style={{ width: `${progress}%` }}
        />
      </Progress.Root>
    </section>
  )
}

export function Actions(): ReactNode {
  const currentTeamId = useTeamStore(s => s.currentTeamId)
  const { reset, finalize, canSubmit, isSubmitting } = useUploadStore(useShallow(s => ({
    reset: s.reset,
    finalize: s.finalize,
    canSubmit: s.status === "done",
    isSubmitting: s.status === "submitting"
  })))

  const handleFinalize = () => {
    if (canSubmit && currentTeamId != null) finalize(currentTeamId)
  }

  if (useUploadStore.getState().status === "idle") return null

  return (
    <div className={styles.actionButtons}>
      <Button
        type="button"
        variant="outline"
        disabled={isSubmitting}
        onClick={reset}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant="primary"
        disabled={!canSubmit || isSubmitting}
        onClick={handleFinalize}
        title={!currentTeamId ? "Select a team first" : undefined}
      >
        {isSubmitting ? "Submitting..." : "Submit"}
      </Button>
    </div>
  )
}

export function ErrorModal(): ReactNode {
  const { reset, error, severity } = useUploadStore(useShallow(s => ({
    reset: s.reset,
    error: s.error,
    severity: s.errorSeverity
  })))

  const config = {
    critical: { title: "Upload Failed", color: "#ef4444", icon: "🚨" },
    warning: { title: "Upload Warning", color: "#f59e0b", icon: "⚠️" }
  }[severity ?? "critical"]

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content className={styles.dialogContent}>
          <header className={styles.dialogHeader} style={{ color: config.color }}>
            <span className={styles.dialogIcon}>{config.icon}</span>
            <Dialog.Title className={styles.dialogTitle}>{config.title}</Dialog.Title>
          </header>
          <Dialog.Description className={styles.dialogDescription}>
            The file could not be processed due to the following
            {severity === "critical" ? " error" : " issue"}:
          </Dialog.Description>
          <pre className={styles.dialogErrorText}>{error}</pre>
          <Dialog.Close asChild>
            <button type="button" onClick={reset} className={styles.dialogButton}>
              Try Again
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
