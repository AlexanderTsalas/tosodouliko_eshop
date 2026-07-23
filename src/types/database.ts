export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      acs_postcode_cache: {
        Row: {
          area_label: string | null
          branch_id: number | null
          cached_at: string
          country: string
          is_inaccessible: boolean
          station_id: string | null
          zipcode: string
        }
        Insert: {
          area_label?: string | null
          branch_id?: number | null
          cached_at?: string
          country: string
          is_inaccessible?: boolean
          station_id?: string | null
          zipcode: string
        }
        Update: {
          area_label?: string | null
          branch_id?: number | null
          cached_at?: string
          country?: string
          is_inaccessible?: boolean
          station_id?: string | null
          zipcode?: string
        }
        Relationships: []
      }
      acs_station_cache: {
        Row: {
          address: string | null
          area_descr: string | null
          area_id: number | null
          branch_id: number
          cached_at: string
          country: string
          description: string | null
          email: string | null
          lat: number | null
          lng: number | null
          phones: string | null
          services: string | null
          shop_kind: number | null
          station_id: string
          station_id_en: string | null
          truck_pickup_hours: string | null
          working_hours: string | null
          working_hours_sat: string | null
          zipcode: string | null
        }
        Insert: {
          address?: string | null
          area_descr?: string | null
          area_id?: number | null
          branch_id?: number
          cached_at?: string
          country?: string
          description?: string | null
          email?: string | null
          lat?: number | null
          lng?: number | null
          phones?: string | null
          services?: string | null
          shop_kind?: number | null
          station_id: string
          station_id_en?: string | null
          truck_pickup_hours?: string | null
          working_hours?: string | null
          working_hours_sat?: string | null
          zipcode?: string | null
        }
        Update: {
          address?: string | null
          area_descr?: string | null
          area_id?: number | null
          branch_id?: number
          cached_at?: string
          country?: string
          description?: string | null
          email?: string | null
          lat?: number | null
          lng?: number | null
          phones?: string | null
          services?: string | null
          shop_kind?: number | null
          station_id?: string
          station_id_en?: string | null
          truck_pickup_hours?: string | null
          working_hours?: string | null
          working_hours_sat?: string | null
          zipcode?: string | null
        }
        Relationships: []
      }
      addresses: {
        Row: {
          address_line1: string
          address_line2: string | null
          city: string
          country_code: string
          created_at: string
          customer_id: string
          first_name: string
          id: string
          is_default: boolean
          is_default_billing: boolean
          is_default_shipping: boolean
          label: string | null
          last_name: string
          phone: string | null
          postal_code: string
          state: string | null
        }
        Insert: {
          address_line1: string
          address_line2?: string | null
          city: string
          country_code: string
          created_at?: string
          customer_id: string
          first_name: string
          id?: string
          is_default?: boolean
          is_default_billing?: boolean
          is_default_shipping?: boolean
          label?: string | null
          last_name: string
          phone?: string | null
          postal_code: string
          state?: string | null
        }
        Update: {
          address_line1?: string
          address_line2?: string | null
          city?: string
          country_code?: string
          created_at?: string
          customer_id?: string
          first_name?: string
          id?: string
          is_default?: boolean
          is_default_billing?: boolean
          is_default_shipping?: boolean
          label?: string | null
          last_name?: string
          phone?: string | null
          postal_code?: string
          state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          active: boolean
          commission_rate: number
          commission_type: string
          contact_phone: string | null
          created_at: string
          email: string | null
          flat_commission: number | null
          id: string
          name: string
          notes: string | null
          payout_method: string | null
        }
        Insert: {
          active?: boolean
          commission_rate?: number
          commission_type?: string
          contact_phone?: string | null
          created_at?: string
          email?: string | null
          flat_commission?: number | null
          id?: string
          name: string
          notes?: string | null
          payout_method?: string | null
        }
        Update: {
          active?: boolean
          commission_rate?: number
          commission_type?: string
          contact_phone?: string | null
          created_at?: string
          email?: string | null
          flat_commission?: number | null
          id?: string
          name?: string
          notes?: string | null
          payout_method?: string | null
        }
        Relationships: []
      }
      attribute_values: {
        Row: {
          attribute_id: string
          created_at: string
          display_order: number
          id: string
          price_modifier: number
          slug: string
          value: string
        }
        Insert: {
          attribute_id: string
          created_at?: string
          display_order?: number
          id?: string
          price_modifier?: number
          slug: string
          value: string
        }
        Update: {
          attribute_id?: string
          created_at?: string
          display_order?: number
          id?: string
          price_modifier?: number
          slug?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "attribute_values_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "attribute_usage"
            referencedColumns: ["attribute_id"]
          },
          {
            foreignKeyName: "attribute_values_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "attributes"
            referencedColumns: ["id"]
          },
        ]
      }
      attributes: {
        Row: {
          affects_price: boolean
          created_at: string
          id: string
          name: string
          slug: string
          splits_listing: boolean
          type: string
        }
        Insert: {
          affects_price?: boolean
          created_at?: string
          id?: string
          name: string
          slug: string
          splits_listing?: boolean
          type?: string
        }
        Update: {
          affects_price?: boolean
          created_at?: string
          id?: string
          name?: string
          slug?: string
          splits_listing?: boolean
          type?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json | null
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: []
      }
      carrier_provider_configs: {
        Row: {
          carrier: string
          config: Json
          created_at: string
          created_by: string | null
          display_name: string
          id: string
          is_active: boolean
          last_test_at: string | null
          last_test_message: string | null
          last_test_status: string | null
          secrets_encrypted: string | null
          updated_at: string
        }
        Insert: {
          carrier: string
          config?: Json
          created_at?: string
          created_by?: string | null
          display_name: string
          id?: string
          is_active?: boolean
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_status?: string | null
          secrets_encrypted?: string | null
          updated_at?: string
        }
        Update: {
          carrier?: string
          config?: Json
          created_at?: string
          created_by?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_status?: string | null
          secrets_encrypted?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_provider_configs_carrier_fkey"
            columns: ["carrier"]
            isOneToOne: false
            referencedRelation: "delivery_carriers"
            referencedColumns: ["slug"]
          },
        ]
      }
      cart_checkout_sessions: {
        Row: {
          applied_codes: Json
          cart_id: string | null
          created_at: string
          customer_id: string
          expires_at: string | null
          id: string
          last_heartbeat_at: string
          last_interaction_at: string
          offer_snapshot: Json | null
          order_id: string | null
          payment_intent_id: string | null
          signup_detour_at: string | null
          snapshot_taken_at: string | null
          state: string
          updated_at: string
        }
        Insert: {
          applied_codes?: Json
          cart_id?: string | null
          created_at?: string
          customer_id: string
          expires_at?: string | null
          id?: string
          last_heartbeat_at?: string
          last_interaction_at?: string
          offer_snapshot?: Json | null
          order_id?: string | null
          payment_intent_id?: string | null
          signup_detour_at?: string | null
          snapshot_taken_at?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          applied_codes?: Json
          cart_id?: string | null
          created_at?: string
          customer_id?: string
          expires_at?: string | null
          id?: string
          last_heartbeat_at?: string
          last_interaction_at?: string
          offer_snapshot?: Json | null
          order_id?: string | null
          payment_intent_id?: string | null
          signup_detour_at?: string | null
          snapshot_taken_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_checkout_sessions_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_checkout_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_checkout_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_checkout_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_checkout_sessions_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_item_custom_fields: {
        Row: {
          cart_item_id: string
          contributed_price: number
          created_at: string
          field_id: string
          id: string
          unit_index: number | null
          value: Json
        }
        Insert: {
          cart_item_id: string
          contributed_price?: number
          created_at?: string
          field_id: string
          id?: string
          unit_index?: number | null
          value: Json
        }
        Update: {
          cart_item_id?: string
          contributed_price?: number
          created_at?: string
          field_id?: string
          id?: string
          unit_index?: number | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cart_item_custom_fields_cart_item_id_fkey"
            columns: ["cart_item_id"]
            isOneToOne: false
            referencedRelation: "cart_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_item_custom_fields_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          modifier_total: number
          product_id: string
          quantity: number
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          modifier_total?: number
          product_id: string
          quantity?: number
          unit_price: number
          variant_id?: string | null
        }
        Update: {
          cart_id?: string
          created_at?: string
          id?: string
          modifier_total?: number
          product_id?: string
          quantity?: number
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_with_product_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string
          guest_token: string | null
          id: string
          item_count: number
          status: string
          subtotal: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          guest_token?: string | null
          id?: string
          item_count?: number
          status?: string
          subtotal?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          guest_token?: string | null
          id?: string
          item_count?: number
          status?: string
          subtotal?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          active: boolean
          auto_rules: Json | null
          created_at: string
          description: string | null
          display_order: number
          id: string
          image_url: string | null
          mode: string
          name: string
          parent_id: string | null
          slug: string
          vat_rate_id: string | null
        }
        Insert: {
          active?: boolean
          auto_rules?: Json | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          image_url?: string | null
          mode?: string
          name: string
          parent_id?: string | null
          slug: string
          vat_rate_id?: string | null
        }
        Update: {
          active?: boolean
          auto_rules?: Json | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          image_url?: string | null
          mode?: string
          name?: string
          parent_id?: string | null
          slug?: string
          vat_rate_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_vat_rate_id_fkey"
            columns: ["vat_rate_id"]
            isOneToOne: false
            referencedRelation: "vat_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          metadata: Json | null
          sender_id: string | null
          sender_type: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          metadata?: Json | null
          sender_id?: string | null
          sender_type: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          sender_id?: string | null
          sender_type?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          agent_id: string | null
          ended_at: string | null
          id: string
          messages: Json
          started_at: string
          status: string
          user_id: string | null
          visitor_email: string | null
          visitor_name: string | null
        }
        Insert: {
          agent_id?: string | null
          ended_at?: string | null
          id?: string
          messages?: Json
          started_at?: string
          status?: string
          user_id?: string | null
          visitor_email?: string | null
          visitor_name?: string | null
        }
        Update: {
          agent_id?: string | null
          ended_at?: string | null
          id?: string
          messages?: Json
          started_at?: string
          status?: string
          user_id?: string | null
          visitor_email?: string | null
          visitor_name?: string | null
        }
        Relationships: []
      }
      code_attachments: {
        Row: {
          added_at: string
          added_by: string | null
          code_id: string
          id: string
          target_id: string
          target_kind: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          code_id: string
          id?: string
          target_id: string
          target_kind: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          code_id?: string
          id?: string
          target_id?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "code_attachments_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "codes"
            referencedColumns: ["id"]
          },
        ]
      }
      code_customer_usage: {
        Row: {
          code_id: string
          customer_id: string
          id: string
          last_used_at: string
          use_count: number
        }
        Insert: {
          code_id: string
          customer_id: string
          id?: string
          last_used_at?: string
          use_count?: number
        }
        Update: {
          code_id?: string
          customer_id?: string
          id?: string
          last_used_at?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "rule_code_customer_usage_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_code_customer_usage_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_code_customer_usage_rule_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "codes"
            referencedColumns: ["id"]
          },
        ]
      }
      code_customers: {
        Row: {
          added_at: string
          added_by: string | null
          auto_apply: boolean
          code_id: string
          customer_id: string
          id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          auto_apply?: boolean
          code_id: string
          customer_id: string
          id?: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          auto_apply?: boolean
          code_id?: string
          customer_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_code_customers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_code_customers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_code_customers_rule_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "codes"
            referencedColumns: ["id"]
          },
        ]
      }
      codes: {
        Row: {
          active: boolean
          affiliate_id: string | null
          code: string
          created_at: string
          created_by: string | null
          current_uses: number
          enforce_limits: boolean
          id: string
          max_uses_per_customer: number | null
          max_uses_total: number | null
        }
        Insert: {
          active?: boolean
          affiliate_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          current_uses?: number
          enforce_limits?: boolean
          id?: string
          max_uses_per_customer?: number | null
          max_uses_total?: number | null
        }
        Update: {
          active?: boolean
          affiliate_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          current_uses?: number
          enforce_limits?: boolean
          id?: string
          max_uses_per_customer?: number | null
          max_uses_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rule_codes_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      collapse_notifications: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          customer_id: string
          id: string
          product_id: string
          product_name: string
          product_slug: string
          variant_id: string
          variant_label: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          customer_id: string
          id?: string
          product_id: string
          product_name: string
          product_slug: string
          variant_id: string
          variant_label?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          product_id?: string
          product_name?: string
          product_slug?: string
          variant_id?: string
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collapse_notifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collapse_notifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collapse_notifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_with_product_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "collapse_notifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collapse_notifications_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      couriers_location_cache: {
        Row: {
          address: string | null
          area_label: string | null
          cached_at: string
          carrier: string
          country: string
          kind: string
          lat: number | null
          lng: number | null
          location_id: string
          name: string | null
          phones: string | null
          raw: Json | null
          sub_location_id: string
          working_hours: string | null
          zipcode: string | null
        }
        Insert: {
          address?: string | null
          area_label?: string | null
          cached_at?: string
          carrier: string
          country: string
          kind: string
          lat?: number | null
          lng?: number | null
          location_id: string
          name?: string | null
          phones?: string | null
          raw?: Json | null
          sub_location_id?: string
          working_hours?: string | null
          zipcode?: string | null
        }
        Update: {
          address?: string | null
          area_label?: string | null
          cached_at?: string
          carrier?: string
          country?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          location_id?: string
          name?: string | null
          phones?: string | null
          raw?: Json | null
          sub_location_id?: string
          working_hours?: string | null
          zipcode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couriers_location_cache_carrier_fkey"
            columns: ["carrier"]
            isOneToOne: false
            referencedRelation: "delivery_carriers"
            referencedColumns: ["slug"]
          },
        ]
      }
      couriers_postcode_cache: {
        Row: {
          area_label: string | null
          cached_at: string
          carrier: string
          country: string
          is_inaccessible: boolean
          raw: Json | null
          station_id: string | null
          sub_station_id: string | null
          zipcode: string
        }
        Insert: {
          area_label?: string | null
          cached_at?: string
          carrier: string
          country: string
          is_inaccessible?: boolean
          raw?: Json | null
          station_id?: string | null
          sub_station_id?: string | null
          zipcode: string
        }
        Update: {
          area_label?: string | null
          cached_at?: string
          carrier?: string
          country?: string
          is_inaccessible?: boolean
          raw?: Json | null
          station_id?: string | null
          sub_station_id?: string | null
          zipcode?: string
        }
        Relationships: [
          {
            foreignKeyName: "couriers_postcode_cache_carrier_fkey"
            columns: ["carrier"]
            isOneToOne: false
            referencedRelation: "delivery_carriers"
            referencedColumns: ["slug"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          created_at: string
          crm_id: string
          crm_provider: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          last_synced_at: string | null
          metadata: Json | null
          sync_status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          crm_id: string
          crm_provider: string
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          last_synced_at?: string | null
          metadata?: Json | null
          sync_status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          crm_id?: string
          crm_provider?: string
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          last_synced_at?: string | null
          metadata?: Json | null
          sync_status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      currencies: {
        Row: {
          active: boolean
          code: string
          decimal_digits: number
          exchange_rate: number
          name: string
          symbol: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          decimal_digits?: number
          exchange_rate?: number
          name: string
          symbol: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          decimal_digits?: number
          exchange_rate?: number
          name?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      custom_delivery_methods: {
        Row: {
          base_method: string
          carrier_slug: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          display_order: number
          id: string
          is_active: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          base_method: string
          carrier_slug?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name: string
          display_order?: number
          id?: string
          is_active?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          base_method?: string
          carrier_slug?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name?: string
          display_order?: number
          id?: string
          is_active?: boolean
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_delivery_methods_carrier_slug_fkey"
            columns: ["carrier_slug"]
            isOneToOne: false
            referencedRelation: "delivery_carriers"
            referencedColumns: ["slug"]
          },
        ]
      }
      custom_field_bindings: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          field_id: string | null
          group_id: string | null
          id: string
          override_required: boolean | null
          scope_kind: string
          scope_resource_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          field_id?: string | null
          group_id?: string | null
          id?: string
          override_required?: boolean | null
          scope_kind: string
          scope_resource_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          field_id?: string | null
          group_id?: string | null
          id?: string
          override_required?: boolean | null
          scope_kind?: string
          scope_resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_bindings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_field_bindings_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_field_bindings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "custom_field_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_group_members: {
        Row: {
          added_at: string
          field_id: string
          group_id: string
          sort_order: number
        }
        Insert: {
          added_at?: string
          field_id: string
          group_id: string
          sort_order?: number
        }
        Update: {
          added_at?: string
          field_id?: string
          group_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_group_members_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_field_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "custom_field_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_groups: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name_translations: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name_translations?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name_translations?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_value_subfields: {
        Row: {
          child_field_id: string
          created_at: string
          id: string
          parent_value_id: string
          sort_order: number
        }
        Insert: {
          child_field_id: string
          created_at?: string
          id?: string
          parent_value_id: string
          sort_order?: number
        }
        Update: {
          child_field_id?: string
          created_at?: string
          id?: string
          parent_value_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_value_subfields_child_field_id_fkey"
            columns: ["child_field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_field_value_subfields_parent_value_id_fkey"
            columns: ["parent_value_id"]
            isOneToOne: false
            referencedRelation: "custom_field_values"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_values: {
        Row: {
          created_at: string
          field_id: string
          id: string
          label_translations: Json
          message_translations: Json | null
          modifier_amount: number
          modifier_kind: string
          sort_order: number
          value: Json
        }
        Insert: {
          created_at?: string
          field_id: string
          id?: string
          label_translations?: Json
          message_translations?: Json | null
          modifier_amount?: number
          modifier_kind?: string
          sort_order?: number
          value: Json
        }
        Update: {
          created_at?: string
          field_id?: string
          id?: string
          label_translations?: Json
          message_translations?: Json | null
          modifier_amount?: number
          modifier_kind?: string
          sort_order?: number
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          created_at: string
          created_by: string | null
          data_type: string
          edit_policy: string
          id: string
          key: string
          label_translations: Json
          per_unit: boolean
          required_default: boolean
          updated_at: string
          validation: Json
          visible: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data_type: string
          edit_policy?: string
          id?: string
          key: string
          label_translations?: Json
          per_unit?: boolean
          required_default?: boolean
          updated_at?: string
          validation?: Json
          visible?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data_type?: string
          edit_policy?: string
          id?: string
          key?: string
          label_translations?: Json
          per_unit?: boolean
          required_default?: boolean
          updated_at?: string
          validation?: Json
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          auth_user_id: string | null
          created_at: string
          created_by: string | null
          email: string | null
          email_normalized: string | null
          first_name: string | null
          id: string
          last_name: string | null
          marketing_opt_in: boolean
          notes: string | null
          phone: string | null
          phone_normalized: string | null
          preferred_currency: string
          preferred_locale: string
          source: Database["public"]["Enums"]["customer_source"]
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_normalized?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          marketing_opt_in?: boolean
          notes?: string | null
          phone?: string | null
          phone_normalized?: string | null
          preferred_currency?: string
          preferred_locale?: string
          source?: Database["public"]["Enums"]["customer_source"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_normalized?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          marketing_opt_in?: boolean
          notes?: string | null
          phone?: string | null
          phone_normalized?: string | null
          preferred_currency?: string
          preferred_locale?: string
          source?: Database["public"]["Enums"]["customer_source"]
          updated_at?: string
        }
        Relationships: []
      }
      delivery_carriers: {
        Row: {
          created_at: string
          created_by: string | null
          display_name: string
          display_order: number
          id: string
          is_active: boolean
          is_custom: boolean
          slug: string
          supported_delivery_methods: string[]
          timeline_preset: string | null
          tracking_url_template: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_name: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_custom?: boolean
          slug: string
          supported_delivery_methods: string[]
          timeline_preset?: string | null
          tracking_url_template?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_name?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_custom?: boolean
          slug?: string
          supported_delivery_methods?: string[]
          timeline_preset?: string | null
          tracking_url_template?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      discount_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          type: string
          usage_count: number
          usage_limit: number | null
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          type: string
          usage_count?: number
          usage_limit?: number | null
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          type?: string
          usage_count?: number
          usage_limit?: number | null
          value?: number
        }
        Relationships: []
      }
      discount_usage: {
        Row: {
          amount_applied: number
          created_at: string
          discount_id: string
          id: string
          order_id: string | null
          user_id: string | null
        }
        Insert: {
          amount_applied: number
          created_at?: string
          discount_id: string
          id?: string
          order_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount_applied?: number
          created_at?: string
          discount_id?: string
          id?: string
          order_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discount_usage_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      email_provider_configs: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          display_name: string
          from_address: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["email_provider_kind"]
          last_test_at: string | null
          last_test_message: string | null
          last_test_status: string | null
          reply_to: string | null
          secrets_encrypted: string | null
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          display_name: string
          from_address: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["email_provider_kind"]
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_status?: string | null
          reply_to?: string | null
          secrets_encrypted?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          display_name?: string
          from_address?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["email_provider_kind"]
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_status?: string | null
          reply_to?: string | null
          secrets_encrypted?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      error_events: {
        Row: {
          context: Json | null
          created_at: string
          fingerprint: string
          first_seen_at: string
          id: string
          last_seen_at: string
          level: string
          message: string
          occurrence_count: number
          resolved: boolean
          severity: string
          stack_trace: string | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          fingerprint: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          level?: string
          message: string
          occurrence_count?: number
          resolved?: boolean
          severity?: string
          stack_trace?: string | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          fingerprint?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          level?: string
          message?: string
          occurrence_count?: number
          resolved?: boolean
          severity?: string
          stack_trace?: string | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      fee_categories: {
        Row: {
          active: boolean
          applies_when: Json
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          id: string
          is_system: boolean
          label: string
          percentage_base: string
          pricing_source: string
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          applies_when?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_system?: boolean
          label: string
          percentage_base?: string
          pricing_source?: string
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          applies_when?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_system?: boolean
          label?: string
          percentage_base?: string
          pricing_source?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      fee_rules: {
        Row: {
          active: boolean
          amount: number
          applies_to_carriers: string[] | null
          applies_to_delivery_methods: string[] | null
          applies_to_payment_methods: string[] | null
          combination: string
          created_at: string
          created_by: string | null
          fee_category_id: string
          id: string
          priority: number
          rate_type: string
          scope_id: string | null
          scope_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount: number
          applies_to_carriers?: string[] | null
          applies_to_delivery_methods?: string[] | null
          applies_to_payment_methods?: string[] | null
          combination?: string
          created_at?: string
          created_by?: string | null
          fee_category_id: string
          id?: string
          priority?: number
          rate_type: string
          scope_id?: string | null
          scope_type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount?: number
          applies_to_carriers?: string[] | null
          applies_to_delivery_methods?: string[] | null
          applies_to_payment_methods?: string[] | null
          combination?: string
          created_at?: string
          created_by?: string | null
          fee_category_id?: string
          id?: string
          priority?: number
          rate_type?: string
          scope_id?: string | null
          scope_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_rules_fee_category_id_fkey"
            columns: ["fee_category_id"]
            isOneToOne: false
            referencedRelation: "fee_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        Insert: {
          id?: string
          low_stock_threshold?: number
          quantity_available?: number
          quantity_priority_held?: number
          quantity_reserved?: number
          quantity_soft_held?: number
          updated_at?: string
          variant_id: string
        }
        Update: {
          id?: string
          low_stock_threshold?: number
          quantity_available?: number
          quantity_priority_held?: number
          quantity_reserved?: number
          quantity_soft_held?: number
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: true
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_listings: {
        Row: {
          created_at: string
          external_id: string | null
          id: string
          last_synced_at: string | null
          marketplace: string
          product_id: string
          status: string
          sync_errors: Json | null
        }
        Insert: {
          created_at?: string
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          marketplace: string
          product_id: string
          status?: string
          sync_errors?: Json | null
        }
        Update: {
          created_at?: string
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          marketplace?: string
          product_id?: string
          status?: string
          sync_errors?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_with_product_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "marketplace_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          alt_text: string | null
          bucket: string
          created_at: string
          filename: string
          folder: string | null
          id: string
          is_public: boolean
          mime_type: string
          size_bytes: number
          storage_key: string
          uploader_id: string | null
        }
        Insert: {
          alt_text?: string | null
          bucket: string
          created_at?: string
          filename: string
          folder?: string | null
          id?: string
          is_public?: boolean
          mime_type: string
          size_bytes: number
          storage_key: string
          uploader_id?: string | null
        }
        Update: {
          alt_text?: string | null
          bucket?: string
          created_at?: string
          filename?: string
          folder?: string | null
          id?: string
          is_public?: boolean
          mime_type?: string
          size_bytes?: number
          storage_key?: string
          uploader_id?: string | null
        }
        Relationships: []
      }
      mfa_enrollment_tokens: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          issued_by: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          issued_by?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          issued_by?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      mfa_recovery_codes: {
        Row: {
          code_hash: string
          consumed_at: string | null
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          consent_at: string
          created_at: string
          email: string
          id: string
          metadata: Json | null
          provider_id: string | null
          status: string
          unsubscribed_at: string | null
          user_id: string | null
        }
        Insert: {
          consent_at?: string
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          provider_id?: string | null
          status?: string
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Update: {
          consent_at?: string
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          provider_id?: string | null
          status?: string
          unsubscribed_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          id: string
          updated_at: string
          updated_by: string | null
          wishlist_notification_mode: string
        }
        Insert: {
          id?: string
          updated_at?: string
          updated_by?: string | null
          wishlist_notification_mode?: string
        }
        Update: {
          id?: string
          updated_at?: string
          updated_by?: string | null
          wishlist_notification_mode?: string
        }
        Relationships: []
      }
      offer_rule_memberships: {
        Row: {
          added_at: string
          added_by: string | null
          id: string
          offer_id: string
          rule_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          id?: string
          offer_id: string
          rule_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          id?: string
          offer_id?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_rule_memberships_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offer_rule_memberships_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      order_item_custom_fields: {
        Row: {
          contributed_price: number
          created_at: string
          field_id: string
          id: string
          order_item_id: string
          unit_index: number | null
          value: Json
        }
        Insert: {
          contributed_price?: number
          created_at?: string
          field_id: string
          id?: string
          order_item_id: string
          unit_index?: number | null
          value: Json
        }
        Update: {
          contributed_price?: number
          created_at?: string
          field_id?: string
          id?: string
          order_item_id?: string
          unit_index?: number | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "order_item_custom_fields_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_custom_fields_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          modifier_total: number
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          sku: string | null
          total: number
          unit_cost_at_sale: number | null
          unit_cost_at_sale_currency: string | null
          unit_price: number
          variant_id: string | null
          variant_label: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          modifier_total?: number
          order_id: string
          product_id: string
          product_name: string
          quantity: number
          sku?: string | null
          total: number
          unit_cost_at_sale?: number | null
          unit_cost_at_sale_currency?: string | null
          unit_price: number
          variant_id?: string | null
          variant_label?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          modifier_total?: number
          order_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          sku?: string | null
          total?: number
          unit_cost_at_sale?: number | null
          unit_cost_at_sale_currency?: string | null
          unit_price?: number
          variant_id?: string | null
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_with_product_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_rule_applications: {
        Row: {
          affiliate_id: string | null
          amount_off: number
          applied_at: string
          code_id: string | null
          currency: string
          id: string
          line_allocations: Json
          offer_id: string | null
          order_id: string
          rule_id: string
        }
        Insert: {
          affiliate_id?: string | null
          amount_off: number
          applied_at?: string
          code_id?: string | null
          currency: string
          id?: string
          line_allocations?: Json
          offer_id?: string | null
          order_id: string
          rule_id: string
        }
        Update: {
          affiliate_id?: string | null
          amount_off?: number
          applied_at?: string
          code_id?: string | null
          currency?: string
          id?: string
          line_allocations?: Json
          offer_id?: string | null
          order_id?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_offer_applications_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_offer_applications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_offer_applications_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_rule_applications_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_rule_applications_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          billing_address: Json | null
          carrier: Database["public"]["Enums"]["order_carrier"] | null
          carrier_raw_status: string | null
          carrier_slug: string | null
          carrier_status_label: string | null
          carrier_status_updated_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          custom_delivery_method_slug: string | null
          customer_email_at_order: string | null
          customer_id: string
          customer_name_at_order: string | null
          customer_phone_at_order: string | null
          delivery_method: Database["public"]["Enums"]["order_delivery_method"]
          discount_amount: number
          fees_breakdown: Json
          fees_breakdown_version: number
          fees_total: number
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          id: string
          notes: string | null
          order_number: string
          payment_method: Database["public"]["Enums"]["order_payment_method"]
          payment_status: Database["public"]["Enums"]["order_payment_status"]
          pickup_branch_id: number | null
          pickup_carrier: string | null
          pickup_station_id: string | null
          pickup_type: string | null
          shipping_address: Json | null
          shipping_amount: number
          source: Database["public"]["Enums"]["order_source"]
          status_set_by: string | null
          subtotal: number
          tax_amount: number
          total: number
          tracking_number: string | null
          tracking_url_override: string | null
          updated_at: string
        }
        Insert: {
          billing_address?: Json | null
          carrier?: Database["public"]["Enums"]["order_carrier"] | null
          carrier_raw_status?: string | null
          carrier_slug?: string | null
          carrier_status_label?: string | null
          carrier_status_updated_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_delivery_method_slug?: string | null
          customer_email_at_order?: string | null
          customer_id: string
          customer_name_at_order?: string | null
          customer_phone_at_order?: string | null
          delivery_method: Database["public"]["Enums"]["order_delivery_method"]
          discount_amount?: number
          fees_breakdown?: Json
          fees_breakdown_version?: number
          fees_total?: number
          fulfillment_status?: Database["public"]["Enums"]["order_fulfillment_status"]
          id?: string
          notes?: string | null
          order_number?: string
          payment_method: Database["public"]["Enums"]["order_payment_method"]
          payment_status?: Database["public"]["Enums"]["order_payment_status"]
          pickup_branch_id?: number | null
          pickup_carrier?: string | null
          pickup_station_id?: string | null
          pickup_type?: string | null
          shipping_address?: Json | null
          shipping_amount?: number
          source?: Database["public"]["Enums"]["order_source"]
          status_set_by?: string | null
          subtotal: number
          tax_amount?: number
          total: number
          tracking_number?: string | null
          tracking_url_override?: string | null
          updated_at?: string
        }
        Update: {
          billing_address?: Json | null
          carrier?: Database["public"]["Enums"]["order_carrier"] | null
          carrier_raw_status?: string | null
          carrier_slug?: string | null
          carrier_status_label?: string | null
          carrier_status_updated_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_delivery_method_slug?: string | null
          customer_email_at_order?: string | null
          customer_id?: string
          customer_name_at_order?: string | null
          customer_phone_at_order?: string | null
          delivery_method?: Database["public"]["Enums"]["order_delivery_method"]
          discount_amount?: number
          fees_breakdown?: Json
          fees_breakdown_version?: number
          fees_total?: number
          fulfillment_status?: Database["public"]["Enums"]["order_fulfillment_status"]
          id?: string
          notes?: string | null
          order_number?: string
          payment_method?: Database["public"]["Enums"]["order_payment_method"]
          payment_status?: Database["public"]["Enums"]["order_payment_status"]
          pickup_branch_id?: number | null
          pickup_carrier?: string | null
          pickup_station_id?: string | null
          pickup_type?: string | null
          shipping_address?: Json | null
          shipping_amount?: number
          source?: Database["public"]["Enums"]["order_source"]
          status_set_by?: string | null
          subtotal?: number
          tax_amount?: number
          total?: number
          tracking_number?: string | null
          tracking_url_override?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_carrier_slug_fkey"
            columns: ["carrier_slug"]
            isOneToOne: false
            referencedRelation: "delivery_carriers"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "orders_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "orders_custom_delivery_method_fkey"
            columns: ["custom_delivery_method_slug"]
            isOneToOne: false
            referencedRelation: "custom_delivery_methods"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_pickup_carrier_fkey"
            columns: ["pickup_carrier"]
            isOneToOne: false
            referencedRelation: "delivery_carriers"
            referencedColumns: ["slug"]
          },
        ]
      }
      payment_intents: {
        Row: {
          amount: number
          checkout_session_expires_at: string | null
          checkout_session_url: string | null
          client_secret: string | null
          created_at: string
          currency: string
          id: string
          metadata: Json | null
          order_id: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount: number
          checkout_session_expires_at?: string | null
          checkout_session_url?: string | null
          client_secret?: string | null
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          order_id?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          checkout_session_expires_at?: string | null
          checkout_session_url?: string | null
          client_secret?: string | null
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          order_id?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          created_at: string
          failure_reason: string | null
          id: string
          metadata: Json | null
          payment_intent_id: string
          status: string
          stripe_charge_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          metadata?: Json | null
          payment_intent_id: string
          status: string
          stripe_charge_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          metadata?: Json | null
          payment_intent_id?: string
          status?: string
          stripe_charge_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_wishlist_notifications: {
        Row: {
          admin_action_at: string | null
          admin_action_by: string | null
          admin_message: string | null
          customer_id: string
          id: string
          quantity_to_offer: number
          status: string
          triggered_at: string
          triggered_by: string
          variant_id: string
          wishlist_item_id: string
        }
        Insert: {
          admin_action_at?: string | null
          admin_action_by?: string | null
          admin_message?: string | null
          customer_id: string
          id?: string
          quantity_to_offer: number
          status?: string
          triggered_at?: string
          triggered_by: string
          variant_id: string
          wishlist_item_id: string
        }
        Update: {
          admin_action_at?: string | null
          admin_action_by?: string | null
          admin_message?: string | null
          customer_id?: string
          id?: string
          quantity_to_offer?: number
          status?: string
          triggered_at?: string
          triggered_by?: string
          variant_id?: string
          wishlist_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_wishlist_notifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_wishlist_notifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_wishlist_notifications_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_wishlist_notifications_wishlist_item_id_fkey"
            columns: ["wishlist_item_id"]
            isOneToOne: false
            referencedRelation: "wishlist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          action: string
          created_at: string
          description: string | null
          id: string
          name: string
          resource: string
        }
        Insert: {
          action: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          resource: string
        }
        Update: {
          action?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          resource?: string
        }
        Relationships: []
      }
      priority_holds: {
        Row: {
          consumed_at: string | null
          customer_id: string
          expires_at: string
          granted_at: string
          id: string
          origin_soft_wait_id: string | null
          quantity: number
          source: string
          variant_id: string
        }
        Insert: {
          consumed_at?: string | null
          customer_id: string
          expires_at: string
          granted_at?: string
          id?: string
          origin_soft_wait_id?: string | null
          quantity: number
          source: string
          variant_id: string
        }
        Update: {
          consumed_at?: string | null
          customer_id?: string
          expires_at?: string
          granted_at?: string
          id?: string
          origin_soft_wait_id?: string | null
          quantity?: number
          source?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "priority_holds_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_holds_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_holds_origin_soft_wait_id_fkey"
            columns: ["origin_soft_wait_id"]
            isOneToOne: false
            referencedRelation: "soft_waits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "priority_holds_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_id: string
          created_at: string
          product_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          product_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_with_product_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_categories_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt_text: string | null
          alt_text_is_auto: boolean
          attribute_combo: Json | null
          bucket: string | null
          created_at: string
          display_order: number
          id: string
          is_cover: boolean
          media_asset_id: string | null
          product_id: string
          storage_key: string | null
          url: string | null
        }
        Insert: {
          alt_text?: string | null
          alt_text_is_auto?: boolean
          attribute_combo?: Json | null
          bucket?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_cover?: boolean
          media_asset_id?: string | null
          product_id: string
          storage_key?: string | null
          url?: string | null
        }
        Update: {
          alt_text?: string | null
          alt_text_is_auto?: boolean
          attribute_combo?: Json | null
          bucket?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_cover?: boolean
          media_asset_id?: string | null
          product_id?: string
          storage_key?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_with_product_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_specifications: {
        Row: {
          attribute_id: string
          created_at: string
          display_order: number
          id: string
          product_id: string
          updated_at: string
          value: string
        }
        Insert: {
          attribute_id: string
          created_at?: string
          display_order?: number
          id?: string
          product_id: string
          updated_at?: string
          value: string
        }
        Update: {
          attribute_id?: string
          created_at?: string
          display_order?: number
          id?: string
          product_id?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_specifications_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "attribute_usage"
            referencedColumns: ["attribute_id"]
          },
          {
            foreignKeyName: "product_specifications_attribute_id_fkey"
            columns: ["attribute_id"]
            isOneToOne: false
            referencedRelation: "attributes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_specifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_with_product_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_specifications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          attribute_combo: Json | null
          created_at: string
          id: string
          is_active: boolean
          price: number
          product_id: string
          show_when_oos: boolean | null
          sku: string
          track_supply: boolean
          weight_kg: number
        }
        Insert: {
          attribute_combo?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          price: number
          product_id: string
          show_when_oos?: boolean | null
          sku: string
          track_supply?: boolean
          weight_kg?: number
        }
        Update: {
          attribute_combo?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          price?: number
          product_id?: string
          show_when_oos?: boolean | null
          sku?: string
          track_supply?: boolean
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_with_product_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          age_max: number | null
          age_min: number | null
          base_price: number
          base_sku: string | null
          brand: string | null
          cost_currency: string | null
          cost_price: number | null
          created_at: string
          currency: string
          default_supplier_id: string | null
          description: string | null
          height_mm: number | null
          id: string
          image_axes: string[]
          length_mm: number | null
          metadata: Json | null
          name: string
          show_when_oos: boolean | null
          slug: string
          split_overrides: Json | null
          updated_at: string
          vat_rate_id: string | null
          volumetric_prefix_id: string | null
          weight_g: number | null
          width_mm: number | null
        }
        Insert: {
          active?: boolean
          age_max?: number | null
          age_min?: number | null
          base_price: number
          base_sku?: string | null
          brand?: string | null
          cost_currency?: string | null
          cost_price?: number | null
          created_at?: string
          currency?: string
          default_supplier_id?: string | null
          description?: string | null
          height_mm?: number | null
          id?: string
          image_axes?: string[]
          length_mm?: number | null
          metadata?: Json | null
          name: string
          show_when_oos?: boolean | null
          slug: string
          split_overrides?: Json | null
          updated_at?: string
          vat_rate_id?: string | null
          volumetric_prefix_id?: string | null
          weight_g?: number | null
          width_mm?: number | null
        }
        Update: {
          active?: boolean
          age_max?: number | null
          age_min?: number | null
          base_price?: number
          base_sku?: string | null
          brand?: string | null
          cost_currency?: string | null
          cost_price?: number | null
          created_at?: string
          currency?: string
          default_supplier_id?: string | null
          description?: string | null
          height_mm?: number | null
          id?: string
          image_axes?: string[]
          length_mm?: number | null
          metadata?: Json | null
          name?: string
          show_when_oos?: boolean | null
          slug?: string
          split_overrides?: Json | null
          updated_at?: string
          vat_rate_id?: string | null
          volumetric_prefix_id?: string | null
          weight_g?: number | null
          width_mm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "products_default_supplier_id_fkey"
            columns: ["default_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_vat_rate_id_fkey"
            columns: ["vat_rate_id"]
            isOneToOne: false
            referencedRelation: "vat_rates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_volumetric_prefix_id_fkey"
            columns: ["volumetric_prefix_id"]
            isOneToOne: false
            referencedRelation: "volumetric_prefixes"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_lots: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          received_at: string
          received_qty: number
          supplier_id: string | null
          supply_order_id: string | null
          unit_cost: number
          unit_cost_currency: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          received_at: string
          received_qty: number
          supplier_id?: string | null
          supply_order_id?: string | null
          unit_cost: number
          unit_cost_currency: string
          variant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          received_at?: string
          received_qty?: number
          supplier_id?: string | null
          supply_order_id?: string | null
          unit_cost?: number
          unit_cost_currency?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_lots_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_lots_supply_order_id_fkey"
            columns: ["supply_order_id"]
            isOneToOne: false
            referencedRelation: "supply_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_lots_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      related_products_associations: {
        Row: {
          active: boolean
          bidirectional: boolean
          card_granularity: string
          created_at: string
          created_by: string | null
          display_order: number
          exclude_oos: boolean
          id: string
          max_results: number
          message_title_translations: Json
          name: string
          selection_strategy: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          bidirectional?: boolean
          card_granularity?: string
          created_at?: string
          created_by?: string | null
          display_order?: number
          exclude_oos?: boolean
          id?: string
          max_results?: number
          message_title_translations?: Json
          name: string
          selection_strategy?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          bidirectional?: boolean
          card_granularity?: string
          created_at?: string
          created_by?: string | null
          display_order?: number
          exclude_oos?: boolean
          id?: string
          max_results?: number
          message_title_translations?: Json
          name?: string
          selection_strategy?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "related_products_associations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      related_products_filter_conditions: {
        Row: {
          config: Json
          created_at: string
          filter_group_id: string
          id: string
          kind: string
          negate: boolean
          sort_order: number
        }
        Insert: {
          config?: Json
          created_at?: string
          filter_group_id: string
          id?: string
          kind: string
          negate?: boolean
          sort_order?: number
        }
        Update: {
          config?: Json
          created_at?: string
          filter_group_id?: string
          id?: string
          kind?: string
          negate?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "related_products_filter_conditions_filter_group_id_fkey"
            columns: ["filter_group_id"]
            isOneToOne: false
            referencedRelation: "related_products_filter_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      related_products_filter_groups: {
        Row: {
          association_id: string
          created_at: string
          id: string
          side: string
          sort_order: number
        }
        Insert: {
          association_id: string
          created_at?: string
          id?: string
          side: string
          sort_order?: number
        }
        Update: {
          association_id?: string
          created_at?: string
          id?: string
          side?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "related_products_filter_groups_association_id_fkey"
            columns: ["association_id"]
            isOneToOne: false
            referencedRelation: "related_products_associations"
            referencedColumns: ["id"]
          },
        ]
      }
      related_products_manual_picks: {
        Row: {
          added_at: string
          association_id: string
          id: string
          product_id: string
          sort_order: number
        }
        Insert: {
          added_at?: string
          association_id: string
          id?: string
          product_id: string
          sort_order?: number
        }
        Update: {
          added_at?: string
          association_id?: string
          id?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "related_products_manual_picks_association_id_fkey"
            columns: ["association_id"]
            isOneToOne: false
            referencedRelation: "related_products_associations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "related_products_manual_picks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_with_product_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "related_products_manual_picks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      return_items: {
        Row: {
          created_at: string
          id: string
          order_item_id: string
          quantity: number
          reason: string | null
          refund_amount: number | null
          return_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_item_id: string
          quantity: number
          reason?: string | null
          refund_amount?: number | null
          return_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_item_id?: string
          quantity?: number
          reason?: string | null
          refund_amount?: number | null
          return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "return_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      return_requests: {
        Row: {
          admin_notes: string | null
          created_at: string
          id: string
          order_id: string
          reason: string
          refund_amount: number | null
          resolved_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          id?: string
          order_id: string
          reason: string
          refund_amount?: number | null
          resolved_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          id?: string
          order_id?: string
          reason?: string
          refund_amount?: number | null
          resolved_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      rule_actions: {
        Row: {
          config: Json
          created_at: string
          id: string
          kind: string
          rule_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          kind: string
          rule_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          kind?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_actions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: true
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_conditions: {
        Row: {
          config: Json
          created_at: string
          id: string
          kind: string
          rule_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          kind: string
          rule_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          kind?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_conditions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_scopes: {
        Row: {
          created_at: string
          id: string
          resource_id: string | null
          rule_id: string
          scope_kind: string
        }
        Insert: {
          created_at?: string
          id?: string
          resource_id?: string | null
          rule_id: string
          scope_kind: string
        }
        Update: {
          created_at?: string
          id?: string
          resource_id?: string | null
          rule_id?: string
          scope_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_scopes_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      rules: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          kind: string
          name: string
          priority: number
          requires_code: boolean
          stacking_mode: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          kind: string
          name: string
          priority?: number
          requires_code?: boolean
          stacking_mode?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          name?: string
          priority?: number
          requires_code?: boolean
          stacking_mode?: string
        }
        Relationships: []
      }
      seo_metadata: {
        Row: {
          canonical_url: string | null
          description: string | null
          id: string
          no_index: boolean
          og_image_url: string | null
          resource_id: string
          resource_type: string
          robots: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          canonical_url?: string | null
          description?: string | null
          id?: string
          no_index?: boolean
          og_image_url?: string | null
          resource_id: string
          resource_type: string
          robots?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          canonical_url?: string | null
          description?: string | null
          id?: string
          no_index?: boolean
          og_image_url?: string | null
          resource_id?: string
          resource_type?: string
          robots?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shipment_events: {
        Row: {
          created_at: string
          description: string | null
          event_type: string
          id: string
          location: string | null
          occurred_at: string
          shipment_id: string
          status: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_type: string
          id?: string
          location?: string | null
          occurred_at?: string
          shipment_id: string
          status?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          event_type?: string
          id?: string
          location?: string | null
          occurred_at?: string
          shipment_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          courier: string
          created_at: string
          estimated_delivery: string | null
          id: string
          label_url: string | null
          order_id: string
          shipped_at: string | null
          status: string
          tracking_number: string | null
          tracking_url: string | null
        }
        Insert: {
          courier: string
          created_at?: string
          estimated_delivery?: string | null
          id?: string
          label_url?: string | null
          order_id: string
          shipped_at?: string | null
          status?: string
          tracking_number?: string | null
          tracking_url?: string | null
        }
        Update: {
          courier?: string
          created_at?: string
          estimated_delivery?: string | null
          id?: string
          label_url?: string | null
          order_id?: string
          shipped_at?: string | null
          status?: string
          tracking_number?: string | null
          tracking_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_rates: {
        Row: {
          active: boolean
          carrier: string
          created_at: string
          free_above: number | null
          id: string
          max_weight_g: number | null
          min_order_amount: number | null
          min_weight_g: number
          rate: number
          zone: string
          zone_id: string | null
        }
        Insert: {
          active?: boolean
          carrier: string
          created_at?: string
          free_above?: number | null
          id?: string
          max_weight_g?: number | null
          min_order_amount?: number | null
          min_weight_g?: number
          rate: number
          zone: string
          zone_id?: string | null
        }
        Update: {
          active?: boolean
          carrier?: string
          created_at?: string
          free_above?: number | null
          id?: string
          max_weight_g?: number | null
          min_order_amount?: number | null
          min_weight_g?: number
          rate?: number
          zone?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_rates_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "shipping_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_rates_tiers: {
        Row: {
          created_at: string
          id: string
          max_value: number | null
          min_value: number
          price: number
          rate_id: string
          unit: string
        }
        Insert: {
          created_at?: string
          id?: string
          max_value?: number | null
          min_value: number
          price: number
          rate_id: string
          unit?: string
        }
        Update: {
          created_at?: string
          id?: string
          max_value?: number | null
          min_value?: number
          price?: number
          rate_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_rates_tiers_rate_id_fkey"
            columns: ["rate_id"]
            isOneToOne: false
            referencedRelation: "shipping_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_zones: {
        Row: {
          active: boolean
          code: string
          country_codes: string[]
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          country_codes?: string[]
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          country_codes?: string[]
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      soft_waits: {
        Row: {
          cart_item_id: string
          checkout_session_id: string
          created_at: string
          customer_id: string
          id: string
          last_seen_at: string
          promoted_at: string | null
          quantity: number
          variant_id: string
        }
        Insert: {
          cart_item_id: string
          checkout_session_id: string
          created_at?: string
          customer_id: string
          id?: string
          last_seen_at?: string
          promoted_at?: string | null
          quantity: number
          variant_id: string
        }
        Update: {
          cart_item_id?: string
          checkout_session_id?: string
          created_at?: string
          customer_id?: string
          id?: string
          last_seen_at?: string
          promoted_at?: string | null
          quantity?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "soft_waits_cart_item_id_fkey"
            columns: ["cart_item_id"]
            isOneToOne: false
            referencedRelation: "cart_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soft_waits_checkout_session_id_fkey"
            columns: ["checkout_session_id"]
            isOneToOne: false
            referencedRelation: "cart_checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soft_waits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soft_waits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soft_waits_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      storefront_settings: {
        Row: {
          id: number
          show_when_oos_default: boolean
          updated_at: string
        }
        Insert: {
          id?: number
          show_when_oos_default?: boolean
          updated_at?: string
        }
        Update: {
          id?: number
          show_when_oos_default?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      stripe_events_processed: {
        Row: {
          event_id: string
          event_type: string
          outcome: string
          processed_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          outcome?: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          outcome?: string
          processed_at?: string
        }
        Relationships: []
      }
      supplier_products: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_preferred: boolean
          lead_time_days: number | null
          notes: string | null
          supplier_id: string
          supplier_sku: string | null
          unit_cost: number | null
          unit_cost_currency: string | null
          updated_at: string
          variant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_preferred?: boolean
          lead_time_days?: number | null
          notes?: string | null
          supplier_id: string
          supplier_sku?: string | null
          unit_cost?: number | null
          unit_cost_currency?: string | null
          updated_at?: string
          variant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_preferred?: boolean
          lead_time_days?: number | null
          notes?: string | null
          supplier_id?: string
          supplier_sku?: string | null
          unit_cost?: number | null
          unit_cost_currency?: string | null
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          city: string | null
          country_code: string | null
          created_at: string
          default_currency: string
          id: string
          name: string
          notes: string | null
          postal_code: string | null
          primary_email: string | null
          primary_phone: string | null
          receipt_column_map: Json | null
          street: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          country_code?: string | null
          created_at?: string
          default_currency?: string
          id?: string
          name: string
          notes?: string | null
          postal_code?: string | null
          primary_email?: string | null
          primary_phone?: string | null
          receipt_column_map?: Json | null
          street?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          country_code?: string | null
          created_at?: string
          default_currency?: string
          id?: string
          name?: string
          notes?: string | null
          postal_code?: string | null
          primary_email?: string | null
          primary_phone?: string | null
          receipt_column_map?: Json | null
          street?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      supply_order_lines: {
        Row: {
          business_sku_at_draft: string
          created_at: string
          id: string
          notes: string | null
          ordered_qty: number
          qty_at_draft: number | null
          received_qty: number | null
          received_unit_cost: number | null
          supplier_sku_at_draft: string | null
          supply_order_id: string
          threshold_at_draft: number | null
          unit_cost: number | null
          unit_cost_currency: string | null
          variant_id: string
          variant_label: string | null
        }
        Insert: {
          business_sku_at_draft: string
          created_at?: string
          id?: string
          notes?: string | null
          ordered_qty: number
          qty_at_draft?: number | null
          received_qty?: number | null
          received_unit_cost?: number | null
          supplier_sku_at_draft?: string | null
          supply_order_id: string
          threshold_at_draft?: number | null
          unit_cost?: number | null
          unit_cost_currency?: string | null
          variant_id: string
          variant_label?: string | null
        }
        Update: {
          business_sku_at_draft?: string
          created_at?: string
          id?: string
          notes?: string | null
          ordered_qty?: number
          qty_at_draft?: number | null
          received_qty?: number | null
          received_unit_cost?: number | null
          supplier_sku_at_draft?: string | null
          supply_order_id?: string
          threshold_at_draft?: number | null
          unit_cost?: number | null
          unit_cost_currency?: string | null
          variant_id?: string
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supply_order_lines_supply_order_id_fkey"
            columns: ["supply_order_id"]
            isOneToOne: false
            referencedRelation: "supply_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_order_lines_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_orders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          placed_at: string | null
          receipt_file_storage_key: string | null
          received_at: string | null
          status: Database["public"]["Enums"]["supply_order_status"]
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          placed_at?: string | null
          receipt_file_storage_key?: string | null
          received_at?: string | null
          status?: Database["public"]["Enums"]["supply_order_status"]
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          placed_at?: string | null
          receipt_file_storage_key?: string | null
          received_at?: string | null
          status?: Database["public"]["Enums"]["supply_order_status"]
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      system_errors: {
        Row: {
          entity_id: string | null
          entity_kind: string | null
          id: string
          metadata: Json | null
          occurred_at: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source: string
          sqlerrm: string
          sqlstate: string
        }
        Insert: {
          entity_id?: string | null
          entity_kind?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          source: string
          sqlerrm: string
          sqlstate: string
        }
        Update: {
          entity_id?: string | null
          entity_kind?: string | null
          id?: string
          metadata?: Json | null
          occurred_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source?: string
          sqlerrm?: string
          sqlstate?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_errors_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          properties: Json | null
          referrer: string | null
          session_id: string
          url: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          properties?: Json | null
          referrer?: string | null
          session_id: string
          url?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          properties?: Json | null
          referrer?: string | null
          session_id?: string
          url?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      translations: {
        Row: {
          id: string
          key: string
          locale: string
          namespace: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          locale: string
          namespace: string
          updated_at?: string
          value: string
        }
        Update: {
          id?: string
          key?: string
          locale?: string
          namespace?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          avatar_url: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          marketing_opt_in: boolean
          phone: string | null
          preferred_currency: string
          preferred_locale: string
          updated_at: string
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"]
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          marketing_opt_in?: boolean
          phone?: string | null
          preferred_currency?: string
          preferred_locale?: string
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          marketing_opt_in?: boolean
          phone?: string | null
          preferred_currency?: string
          preferred_locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          active: boolean
          created_at: string
          device_name: string | null
          expires_at: string
          id: string
          ip_address: unknown
          last_active_at: string
          session_token: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          device_name?: string | null
          expires_at: string
          id?: string
          ip_address?: unknown
          last_active_at?: string
          session_token: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          device_name?: string | null
          expires_at?: string
          id?: string
          ip_address?: unknown
          last_active_at?: string
          session_token?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      vat_rates: {
        Row: {
          code: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          rate: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          rate: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      volumetric_prefixes: {
        Row: {
          active: boolean
          carrier_codes: Json
          created_at: string
          description: string | null
          display_name: string
          display_order: number
          id: string
          max_height_mm: number | null
          max_length_mm: number | null
          max_weight_g: number | null
          max_width_mm: number | null
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          carrier_codes?: Json
          created_at?: string
          description?: string | null
          display_name: string
          display_order?: number
          id?: string
          max_height_mm?: number | null
          max_length_mm?: number | null
          max_weight_g?: number | null
          max_width_mm?: number | null
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          carrier_codes?: Json
          created_at?: string
          description?: string | null
          display_name?: string
          display_order?: number
          id?: string
          max_height_mm?: number | null
          max_length_mm?: number | null
          max_weight_g?: number | null
          max_width_mm?: number | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      wishlist_items: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          last_notification_kind: string | null
          last_notified_at: string | null
          notify_on_restock: boolean
          notify_on_sale: boolean
          product_id: string
          quantity: number
          source: string
          updated_at: string
          variant_id: string | null
          wishlist_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          last_notification_kind?: string | null
          last_notified_at?: string | null
          notify_on_restock?: boolean
          notify_on_sale?: boolean
          product_id: string
          quantity?: number
          source?: string
          updated_at?: string
          variant_id?: string | null
          wishlist_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          last_notification_kind?: string | null
          last_notified_at?: string | null
          notify_on_restock?: boolean
          notify_on_sale?: boolean
          product_id?: string
          quantity?: number
          source?: string
          updated_at?: string
          variant_id?: string | null
          wishlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_with_product_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_wishlist_id_fkey"
            columns: ["wishlist_id"]
            isOneToOne: false
            referencedRelation: "wishlists"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlists: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          is_default: boolean
          is_public: boolean
          name: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          is_default?: boolean
          is_public?: boolean
          name?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          is_default?: boolean
          is_public?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlists_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlists_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      attribute_usage: {
        Row: {
          attribute_id: string | null
          created_at: string | null
          is_spec: boolean | null
          is_variant_axis: boolean | null
          name: string | null
          slug: string | null
          type: string | null
          value_count: number | null
        }
        Insert: {
          attribute_id?: string | null
          created_at?: string | null
          is_spec?: never
          is_variant_axis?: never
          name?: string | null
          slug?: string | null
          type?: string | null
          value_count?: never
        }
        Update: {
          attribute_id?: string | null
          created_at?: string | null
          is_spec?: never
          is_variant_axis?: never
          name?: string | null
          slug?: string | null
          type?: string | null
          value_count?: never
        }
        Relationships: []
      }
      customer_summary: {
        Row: {
          auth_user_id: string | null
          created_at: string | null
          email: string | null
          email_normalized: string | null
          first_name: string | null
          id: string | null
          last_name: string | null
          last_order_at: string | null
          last_order_currency: string | null
          lifetime_total: number | null
          order_count: number | null
          phone: string | null
          phone_normalized: string | null
          source: Database["public"]["Enums"]["customer_source"] | null
          updated_at: string | null
        }
        Relationships: []
      }
      inventory_with_product_status: {
        Row: {
          attribute_combo: Json | null
          currency: string | null
          default_supplier_id: string | null
          inventory_id: string | null
          inventory_updated_at: string | null
          low_stock_threshold: number | null
          product_active: boolean | null
          product_id: string | null
          product_name: string | null
          product_slug: string | null
          quantity_available: number | null
          quantity_priority_held: number | null
          quantity_reserved: number | null
          quantity_soft_held: number | null
          show_when_oos: boolean | null
          sku: string | null
          stock_status: string | null
          track_supply: boolean | null
          variant_active: boolean | null
          variant_id: string | null
          variant_price: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: true
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "products_default_supplier_id_fkey"
            columns: ["default_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      product_stock_rollup: {
        Row: {
          active_variant_count: number | null
          low_variant_count: number | null
          oos_variant_count: number | null
          product_id: string | null
          rolled_up_status: string | null
          total_available: number | null
          total_reserved: number | null
          total_soft_held: number | null
          variant_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_with_product_status"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _documentation_custom_sqlstates: { Args: never; Returns: undefined }
      advance_soft_wait_queue_after_priority_expiry: {
        Args: { p_priority_hold_id: string }
        Returns: boolean
      }
      advance_soft_wait_queue_for_session: {
        Args: { p_session_id: string }
        Returns: number
      }
      apply_contention_timer: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      attribute_value_in_use: { Args: { p_value_id: string }; Returns: boolean }
      cleanup_expired_sessions: { Args: never; Returns: undefined }
      cleanup_expired_sessions_for_variant: {
        Args: { p_variant_id: string }
        Returns: number
      }
      collapse_soft_wait_queue_for_session: {
        Args: { p_session_id: string }
        Returns: number
      }
      commit_order_with_lines: {
        Args: { p_lines: Json; p_order: Json }
        Returns: {
          order_id: string
          order_number: string
        }[]
      }
      consume_priority_holds_for_checkout: {
        Args: {
          p_customer_id: string
          p_quantities: number[]
          p_variant_ids: string[]
        }
        Returns: string[]
      }
      consume_priority_to_soft: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_reservation: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contestable_available_for: {
        Args: { p_variant_id: string }
        Returns: number
      }
      contestable_available_for_many: {
        Args: { p_variant_ids: string[] }
        Returns: {
          qty: number
          variant_id: string
        }[]
      }
      decrement_inventory: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_order_safe: {
        Args: { p_actor_id: string; p_order_id: string }
        Returns: Json
      }
      effective_available_for: {
        Args: { p_variant_id: string; p_viewer_id?: string }
        Returns: number
      }
      effective_available_for_many: {
        Args: { p_variant_ids: string[]; p_viewer_id?: string }
        Returns: {
          qty: number
          variant_id: string
        }[]
      }
      eligible_rules: {
        Args: {
          p_category_ids: string[]
          p_product_ids: string[]
          p_variant_ids: string[]
        }
        Returns: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          kind: string
          name: string
          priority: number
          requires_code: boolean
          stacking_mode: string
        }[]
        SetofOptions: {
          from: "*"
          to: "rules"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      extend_for_signup_detour: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      fulfill_order_atomic: { Args: { p_order_id: string }; Returns: Json }
      generate_order_number: { Args: never; Returns: string }
      grant_admin_by_email: { Args: { p_email: string }; Returns: string }
      grant_role_by_email: {
        Args: { p_email: string; p_role_name: string }
        Returns: string
      }
      handle_session_completed_atomic: {
        Args: {
          p_provider: string
          p_provider_intent_id?: string
          p_provider_session_id: string
        }
        Returns: Json
      }
      has_permission: { Args: { perm: string }; Returns: boolean }
      is_internal_user: { Args: Record<PropertyKey, never>; Returns: boolean }
      hold_soft: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      hold_soft_batch: { Args: { p_lines: Json }; Returns: Json }
      increment_inventory: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: undefined
      }
      log_audit_event: {
        Args: {
          p_action: string
          p_actor_id: string
          p_actor_type: string
          p_ip_address?: unknown
          p_metadata?: Json
          p_resource_id?: string
          p_resource_type: string
        }
        Returns: string
      }
      log_system_error: {
        Args: {
          p_entity_id?: string
          p_entity_kind?: string
          p_metadata?: Json
          p_severity: string
          p_source: string
          p_sqlerrm: string
          p_sqlstate: string
        }
        Returns: string
      }
      merge_offline_customer: {
        Args: { p_source_id: string; p_target_id: string }
        Returns: Json
      }
      mint_mfa_enrollment_token: {
        Args: { p_pepper: string; p_ttl_hours?: number; p_user_id: string }
        Returns: {
          plaintext_token: string
        }[]
      }
      normalize_phone: { Args: { p_phone: string }; Returns: string }
      promote_soft_to_reserved: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      promote_soft_to_reserved_batch: { Args: { p_lines: Json }; Returns: Json }
      promote_to_priority: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reap_abandoned_soft_waits: { Args: never; Returns: number }
      reap_orphaned_anon_customers: { Args: never; Returns: number }
      reap_stale_soft_sessions: { Args: never; Returns: number }
      reconcile_orphan_soft_held: { Args: never; Returns: number }
      record_code_usage: {
        Args: { p_code_ids: string[]; p_customer_id: string }
        Returns: undefined
      }
      refund_order_atomic: {
        Args: {
          p_actor_id: string
          p_currency: string
          p_expected_updated_at?: string
          p_next_fulfillment: string
          p_order_id: string
          p_payment_method: string
          p_reason?: string
          p_refund_amount_minor: number
          p_refund_id: string
          p_restore_inventory: boolean
        }
        Returns: Json
      }
      release_expired_priority_holds: { Args: never; Returns: number }
      release_idle_soft_sessions: { Args: never; Returns: number }
      release_priority: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_reservation: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_reservation_batch: { Args: { p_lines: Json }; Returns: Json }
      release_soft: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_soft_batch: { Args: { p_lines: Json }; Returns: Json }
      release_soft_session: { Args: { p_session_id: string }; Returns: boolean }
      release_stale_heartbeat_sessions: { Args: never; Returns: number }
      reserve_inventory: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_inventory_batch: { Args: { p_lines: Json }; Returns: Json }
      resolve_show_when_oos: {
        Args: { p_variant_id: string }
        Returns: boolean
      }
      restore_inventory: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: {
          id: string
          low_stock_threshold: number
          quantity_available: number
          quantity_priority_held: number
          quantity_reserved: number
          quantity_soft_held: number
          updated_at: string
          variant_id: string
        }
        SetofOptions: {
          from: "*"
          to: "inventory_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_inventory_batch: { Args: { p_lines: Json }; Returns: Json }
      revoke_role_by_email: {
        Args: { p_email: string; p_role_name: string }
        Returns: string
      }
      set_inventory_level:
        | {
            Args: {
              p_quantity_available: number
              p_quantity_reserved?: number
              p_variant_id: string
            }
            Returns: {
              id: string
              low_stock_threshold: number
              quantity_available: number
              quantity_priority_held: number
              quantity_reserved: number
              quantity_soft_held: number
              updated_at: string
              variant_id: string
            }
            SetofOptions: {
              from: "*"
              to: "inventory_items"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_low_stock_threshold?: number
              p_quantity_available: number
              p_quantity_reserved?: number
              p_variant_id: string
            }
            Returns: {
              id: string
              low_stock_threshold: number
              quantity_available: number
              quantity_priority_held: number
              quantity_reserved: number
              quantity_soft_held: number
              updated_at: string
              variant_id: string
            }
            SetofOptions: {
              from: "*"
              to: "inventory_items"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      account_type: "customer" | "internal"
      customer_source: "eshop_signup" | "admin_manual" | "phone" | "in_store"
      email_provider_kind: "smtp" | "resend"
      order_carrier: "acs" | "elta" | "box_now" | "speedex" | "geniki" | "other"
      order_delivery_method:
        | "home_delivery"
        | "store_pickup"
        | "delivery_station_pickup"
        | "carrier_pickup"
      order_fulfillment_status:
        | "draft"
        | "pending"
        | "confirmed"
        | "preparing"
        | "shipped"
        | "ready_for_pickup"
        | "delivered"
        | "picked_up"
        | "cancelled"
        | "label_created"
        | "awaiting_carrier"
        | "in_transit"
        | "out_for_delivery"
        | "arrived_at_pickup"
        | "on_hold"
        | "collected"
        | "delivery_attempted_absent"
        | "delivery_attempted_refused"
        | "delivery_attempted_wrong_address"
        | "delivery_attempted_damaged"
        | "returning"
        | "returned"
        | "lost"
      order_payment_method:
        | "stripe"
        | "cod"
        | "cash_on_pickup"
        | "bank_transfer"
      order_payment_status: "pending" | "paid" | "refunded" | "failed"
      order_source: "eshop" | "phone" | "in_store"
      supply_order_status: "draft" | "placed" | "received" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["customer", "internal"],
      customer_source: ["eshop_signup", "admin_manual", "phone", "in_store"],
      email_provider_kind: ["smtp", "resend"],
      order_carrier: ["acs", "elta", "box_now", "speedex", "geniki", "other"],
      order_delivery_method: [
        "home_delivery",
        "store_pickup",
        "delivery_station_pickup",
        "carrier_pickup",
      ],
      order_fulfillment_status: [
        "draft",
        "pending",
        "confirmed",
        "preparing",
        "shipped",
        "ready_for_pickup",
        "delivered",
        "picked_up",
        "cancelled",
        "label_created",
        "awaiting_carrier",
        "in_transit",
        "out_for_delivery",
        "arrived_at_pickup",
        "on_hold",
        "collected",
        "delivery_attempted_absent",
        "delivery_attempted_refused",
        "delivery_attempted_wrong_address",
        "delivery_attempted_damaged",
        "returning",
        "returned",
        "lost",
      ],
      order_payment_method: [
        "stripe",
        "cod",
        "cash_on_pickup",
        "bank_transfer",
      ],
      order_payment_status: ["pending", "paid", "refunded", "failed"],
      order_source: ["eshop", "phone", "in_store"],
      supply_order_status: ["draft", "placed", "received", "cancelled"],
    },
  },
} as const
