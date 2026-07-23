export type ShipmentStatus =
  | "pending"
  | "label_created"
  | "in_transit"
  | "delivered"
  | "failed";

export interface Shipment {
  id: string;
  order_id: string;
  courier: string;
  tracking_number: string | null;
  tracking_url: string | null;
  status: ShipmentStatus;
  label_url: string | null;
  estimated_delivery: string | null;
  shipped_at: string | null;
  created_at: string;
}

export interface ShipmentEvent {
  id: string;
  shipment_id: string;
  event_type: string;
  status: string | null;
  description: string | null;
  location: string | null;
  occurred_at: string;
  created_at: string;
}
