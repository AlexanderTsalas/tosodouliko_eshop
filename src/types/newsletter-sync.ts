export type NewsletterStatus = "subscribed" | "unsubscribed" | "pending";

export interface NewsletterSubscriber {
  id: string;
  email: string;
  user_id: string | null;
  status: NewsletterStatus;
  provider_id: string | null;
  consent_at: string;
  unsubscribed_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
