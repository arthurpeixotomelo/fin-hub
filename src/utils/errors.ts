export type ErrorSeverity = 'critical' | 'warning'

export interface StructuredError {
  severity: ErrorSeverity
  message: string
  details?: string
  context?: Record<string, unknown>
}

export class CriticalError extends Error {
  readonly severity: ErrorSeverity = 'critical'
  readonly details?: string
  readonly context?: Record<string, unknown>

  constructor(message: string, details?: string, context?: Record<string, unknown>) {
    super(message)
    this.name = 'CriticalError'
    this.details = details
    this.context = context
    Object.setPrototypeOf(this, CriticalError.prototype)
  }

  toStructured(): StructuredError {
    return {
      severity: this.severity,
      message: this.message,
      details: this.details,
      context: this.context
    }
  }
}

export class WarningError extends Error {
  readonly severity: ErrorSeverity = 'warning'
  readonly details?: string
  readonly context?: Record<string, unknown>

  constructor(message: string, details?: string, context?: Record<string, unknown>) {
    super(message)
    this.name = 'WarningError'
    this.details = details
    this.context = context
    Object.setPrototypeOf(this, WarningError.prototype)
  }

  toStructured(): StructuredError {
    return {
      severity: this.severity,
      message: this.message,
      details: this.details,
      context: this.context
    }
  }
}

export function parseError(error: unknown): StructuredError {
  if (error instanceof CriticalError || error instanceof WarningError) {
    return error.toStructured()
  }

  if (error instanceof Error) {
    return {
      severity: 'critical',
      message: error.message,
      details: error.stack
    }
  }

  if (typeof error === 'string') {
    return {
      severity: 'critical',
      message: error
    }
  }

  return {
    severity: 'critical',
    message: 'An unknown error occurred',
    details: JSON.stringify(error, null, 2)
  }
}

export function formatErrorForDisplay(error: StructuredError): string {
  const parts: string[] = [error.message]
  
  if (error.details) {
    parts.push('\n\nDetails:', error.details)
  }

  if (error.context && Object.keys(error.context).length > 0) {
    parts.push('\n\nContext:', JSON.stringify(error.context, null, 2))
  }

  return parts.join('')
}
