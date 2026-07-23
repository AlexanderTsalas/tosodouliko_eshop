export interface AuditEvent {
  id: string;
  actor_id: string | null;
  actor_type: "user" | "system" | "service" | string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditEventInput {
  actor_id?: string | null;
  actor_type: "user" | "system" | "service" | string;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  metadata?: Record<string, unknown> | null;
  ip_address?: string | null;
}
