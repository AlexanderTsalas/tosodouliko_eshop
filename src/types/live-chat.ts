export type ChatStatus = "waiting" | "active" | "closed";
export type ChatSenderType = "visitor" | "user" | "agent" | "system";

export interface ChatSession {
  id: string;
  user_id: string | null;
  agent_id: string | null;
  status: ChatStatus;
  messages: ChatMessage[];
  visitor_name: string | null;
  visitor_email: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  sender_id: string | null;
  sender_type: ChatSenderType;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
