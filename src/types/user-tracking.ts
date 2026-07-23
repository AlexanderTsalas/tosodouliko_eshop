export interface TrackingEvent {
  id: string;
  session_id: string;
  user_id: string | null;
  event_name: string;
  properties: Record<string, unknown> | null;
  url: string | null;
  referrer: string | null;
  created_at: string;
}

export interface TrackEventInput {
  sessionId: string;
  userId?: string | null;
  eventName: string;
  properties?: Record<string, unknown>;
  url?: string;
  referrer?: string;
}
