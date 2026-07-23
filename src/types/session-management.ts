export interface UserSession {
  id: string;
  user_id: string;
  session_token: string;
  device_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  active: boolean;
  last_active_at: string;
  expires_at: string;
  created_at: string;
}
