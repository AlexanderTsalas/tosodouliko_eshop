export type ErrorLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export interface ErrorEvent {
  id: string;
  fingerprint: string;
  message: string;
  stack_trace: string | null;
  level: ErrorLevel;
  severity: ErrorSeverity;
  type: string | null;
  context: Record<string, unknown> | null;
  user_id: string | null;
  resolved: boolean;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
}

export interface CaptureErrorInput {
  message: string;
  stack?: string;
  level?: ErrorLevel;
  severity?: ErrorSeverity;
  type?: string;
  context?: Record<string, unknown>;
  userId?: string | null;
}
