export type ReturnStatus = "pending" | "approved" | "rejected" | "refunded";

export interface ReturnRequest {
  id: string;
  order_id: string;
  user_id: string;
  reason: string;
  status: ReturnStatus;
  refund_amount: number | null;
  admin_notes: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface ReturnItem {
  id: string;
  return_id: string;
  order_item_id: string;
  quantity: number;
  reason: string | null;
  refund_amount: number | null;
  created_at: string;
}
