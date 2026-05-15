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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      allowlist: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_at: string
          invited_by: string | null
          notes: string | null
          redeemed_at: string | null
          redeemed_by: string | null
          role: Database["public"]["Enums"]["allowlist_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          notes?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          role?: Database["public"]["Enums"]["allowlist_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          notes?: string | null
          redeemed_at?: string | null
          redeemed_by?: string | null
          role?: Database["public"]["Enums"]["allowlist_role"]
          updated_at?: string
        }
        Relationships: []
      }
      exchange_catalog: {
        Row: {
          auth_mode: string
          code: string
          created_at: string
          display_name: string
          is_active: boolean
          supports_options: boolean
          supports_perp: boolean
          supports_spot: boolean
          venue_type: string
        }
        Insert: {
          auth_mode: string
          code: string
          created_at?: string
          display_name: string
          is_active?: boolean
          supports_options?: boolean
          supports_perp?: boolean
          supports_spot?: boolean
          venue_type: string
        }
        Update: {
          auth_mode?: string
          code?: string
          created_at?: string
          display_name?: string
          is_active?: boolean
          supports_options?: boolean
          supports_perp?: boolean
          supports_spot?: boolean
          venue_type?: string
        }
        Relationships: []
      }
      exchange_connections: {
        Row: {
          api_key_ciphertext: string | null
          api_key_hint: string | null
          api_key_nonce: string | null
          api_passphrase_ciphertext: string | null
          api_passphrase_nonce: string | null
          api_secret_ciphertext: string | null
          api_secret_nonce: string | null
          connection_type: string
          created_at: string
          deleted_at: string | null
          encryption_key_version: number
          exchange_code: string
          fills_synced: number
          id: string
          label: string
          last_fill_at: string | null
          last_sync_at: string | null
          last_sync_cursor: string | null
          permissions_json: Json
          status: Database["public"]["Enums"]["connection_status"]
          status_message: string | null
          updated_at: string
          user_id: string
          wallet_address_ciphertext: string | null
          wallet_address_nonce: string | null
          wallet_chain: string | null
        }
        Insert: {
          api_key_ciphertext?: string | null
          api_key_hint?: string | null
          api_key_nonce?: string | null
          api_passphrase_ciphertext?: string | null
          api_passphrase_nonce?: string | null
          api_secret_ciphertext?: string | null
          api_secret_nonce?: string | null
          connection_type: string
          created_at?: string
          deleted_at?: string | null
          encryption_key_version?: number
          exchange_code: string
          fills_synced?: number
          id?: string
          label: string
          last_fill_at?: string | null
          last_sync_at?: string | null
          last_sync_cursor?: string | null
          permissions_json?: Json
          status?: Database["public"]["Enums"]["connection_status"]
          status_message?: string | null
          updated_at?: string
          user_id: string
          wallet_address_ciphertext?: string | null
          wallet_address_nonce?: string | null
          wallet_chain?: string | null
        }
        Update: {
          api_key_ciphertext?: string | null
          api_key_hint?: string | null
          api_key_nonce?: string | null
          api_passphrase_ciphertext?: string | null
          api_passphrase_nonce?: string | null
          api_secret_ciphertext?: string | null
          api_secret_nonce?: string | null
          connection_type?: string
          created_at?: string
          deleted_at?: string | null
          encryption_key_version?: number
          exchange_code?: string
          fills_synced?: number
          id?: string
          label?: string
          last_fill_at?: string | null
          last_sync_at?: string | null
          last_sync_cursor?: string | null
          permissions_json?: Json
          status?: Database["public"]["Enums"]["connection_status"]
          status_message?: string | null
          updated_at?: string
          user_id?: string
          wallet_address_ciphertext?: string | null
          wallet_address_nonce?: string | null
          wallet_chain?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exchange_connections_exchange_code_fkey"
            columns: ["exchange_code"]
            isOneToOne: false
            referencedRelation: "exchange_catalog"
            referencedColumns: ["code"]
          },
        ]
      }
      fills: {
        Row: {
          created_at: string
          exchange_connection_id: string
          executed_at: string
          fee: number
          fee_currency: string
          fee_kind: Database["public"]["Enums"]["fee_kind"]
          id: string
          ingested_at: string
          instrument: string
          instrument_type: Database["public"]["Enums"]["instrument_type"]
          is_maker: boolean
          liquidity_role: string | null
          notional: number
          order_id: string | null
          position_id: string | null
          position_side: Database["public"]["Enums"]["position_side"] | null
          price: number
          qty: number
          raw_exchange_id: string
          raw_payload: Json
          reduce_only: boolean | null
          side: Database["public"]["Enums"]["fill_side"]
          trade_metadata: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          exchange_connection_id: string
          executed_at: string
          fee?: number
          fee_currency: string
          fee_kind?: Database["public"]["Enums"]["fee_kind"]
          id?: string
          ingested_at?: string
          instrument: string
          instrument_type: Database["public"]["Enums"]["instrument_type"]
          is_maker?: boolean
          liquidity_role?: string | null
          notional: number
          order_id?: string | null
          position_id?: string | null
          position_side?: Database["public"]["Enums"]["position_side"] | null
          price: number
          qty: number
          raw_exchange_id: string
          raw_payload?: Json
          reduce_only?: boolean | null
          side: Database["public"]["Enums"]["fill_side"]
          trade_metadata?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          exchange_connection_id?: string
          executed_at?: string
          fee?: number
          fee_currency?: string
          fee_kind?: Database["public"]["Enums"]["fee_kind"]
          id?: string
          ingested_at?: string
          instrument?: string
          instrument_type?: Database["public"]["Enums"]["instrument_type"]
          is_maker?: boolean
          liquidity_role?: string | null
          notional?: number
          order_id?: string | null
          position_id?: string | null
          position_side?: Database["public"]["Enums"]["position_side"] | null
          price?: number
          qty?: number
          raw_exchange_id?: string
          raw_payload?: Json
          reduce_only?: boolean | null
          side?: Database["public"]["Enums"]["fill_side"]
          trade_metadata?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fills_exchange_connection_id_fkey"
            columns: ["exchange_connection_id"]
            isOneToOne: false
            referencedRelation: "exchange_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fills_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "position_pnl"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "fills_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      funding_events: {
        Row: {
          amount: number
          created_at: string
          currency: string
          event_time: string
          exchange_connection_id: string
          funding_rate: number
          id: string
          ingested_at: string
          instrument: string
          position_id: string | null
          position_qty: number
          raw_exchange_id: string
          raw_payload: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency: string
          event_time: string
          exchange_connection_id: string
          funding_rate: number
          id?: string
          ingested_at?: string
          instrument: string
          position_id?: string | null
          position_qty?: number
          raw_exchange_id: string
          raw_payload?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          event_time?: string
          exchange_connection_id?: string
          funding_rate?: number
          id?: string
          ingested_at?: string
          instrument?: string
          position_id?: string | null
          position_qty?: number
          raw_exchange_id?: string
          raw_payload?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_events_exchange_connection_id_fkey"
            columns: ["exchange_connection_id"]
            isOneToOne: false
            referencedRelation: "exchange_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_events_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "position_pnl"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "funding_events_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      mark_prices: {
        Row: {
          exchange_code: string
          instrument: string
          price: number
          ts: string
        }
        Insert: {
          exchange_code: string
          instrument: string
          price: number
          ts: string
        }
        Update: {
          exchange_code?: string
          instrument?: string
          price?: number
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "mark_prices_exchange_code_fkey"
            columns: ["exchange_code"]
            isOneToOne: false
            referencedRelation: "exchange_catalog"
            referencedColumns: ["code"]
          },
        ]
      }
      note_attachments: {
        Row: {
          created_at: string
          filename: string
          id: string
          mime_type: string
          note_id: string
          size_bytes: number
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          mime_type: string
          note_id: string
          size_bytes: number
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          mime_type?: string
          note_id?: string
          size_bytes?: number
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_attachments_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          entry_rationale: string | null
          exit_conclusion: string | null
          id: string
          spread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          entry_rationale?: string | null
          exit_conclusion?: string | null
          id?: string
          spread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          entry_rationale?: string | null
          exit_conclusion?: string | null
          id?: string
          spread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_spread_id_fkey"
            columns: ["spread_id"]
            isOneToOne: true
            referencedRelation: "spread_pnl"
            referencedColumns: ["spread_id"]
          },
          {
            foreignKeyName: "notes_spread_id_fkey"
            columns: ["spread_id"]
            isOneToOne: true
            referencedRelation: "spreads"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          avg_entry_price: number
          avg_exit_price: number | null
          closed_at: string | null
          created_at: string
          deleted_at: string | null
          exchange_connection_id: string
          id: string
          instrument: string
          instrument_type: Database["public"]["Enums"]["instrument_type"]
          leverage: number | null
          margin_mode: Database["public"]["Enums"]["margin_mode"]
          opened_at: string
          qty_open: number
          quote_currency: string
          realized_pnl_quote: number
          side: Database["public"]["Enums"]["position_side"]
          status: Database["public"]["Enums"]["position_status"]
          total_fees_quote: number
          total_funding_quote: number
          total_qty: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_entry_price: number
          avg_exit_price?: number | null
          closed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          exchange_connection_id: string
          id?: string
          instrument: string
          instrument_type: Database["public"]["Enums"]["instrument_type"]
          leverage?: number | null
          margin_mode?: Database["public"]["Enums"]["margin_mode"]
          opened_at: string
          qty_open?: number
          quote_currency?: string
          realized_pnl_quote?: number
          side: Database["public"]["Enums"]["position_side"]
          status?: Database["public"]["Enums"]["position_status"]
          total_fees_quote?: number
          total_funding_quote?: number
          total_qty: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_entry_price?: number
          avg_exit_price?: number | null
          closed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          exchange_connection_id?: string
          id?: string
          instrument?: string
          instrument_type?: Database["public"]["Enums"]["instrument_type"]
          leverage?: number | null
          margin_mode?: Database["public"]["Enums"]["margin_mode"]
          opened_at?: string
          qty_open?: number
          quote_currency?: string
          realized_pnl_quote?: number
          side?: Database["public"]["Enums"]["position_side"]
          status?: Database["public"]["Enums"]["position_status"]
          total_fees_quote?: number
          total_funding_quote?: number
          total_qty?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_exchange_connection_id_fkey"
            columns: ["exchange_connection_id"]
            isOneToOne: false
            referencedRelation: "exchange_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          base_currency: string
          created_at: string
          display_name: string | null
          email: string
          id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      saved_views: {
        Row: {
          columns: string[]
          created_at: string
          filters: Json
          id: string
          is_default: boolean
          name: string
          scope: string
          sort: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          columns?: string[]
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name: string
          scope: string
          sort?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          columns?: string[]
          created_at?: string
          filters?: Json
          id?: string
          is_default?: boolean
          name?: string
          scope?: string
          sort?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      spread_candidates: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          earliest_fill_at: string
          expires_at: string
          id: string
          match_confidence: number
          match_reasons: string[]
          primary_base: string
          proposed_legs: Json
          rejection_reason: string | null
          resulting_spread_id: string | null
          state: Database["public"]["Enums"]["candidate_state"]
          suggested_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          earliest_fill_at: string
          expires_at?: string
          id?: string
          match_confidence: number
          match_reasons?: string[]
          primary_base: string
          proposed_legs: Json
          rejection_reason?: string | null
          resulting_spread_id?: string | null
          state?: Database["public"]["Enums"]["candidate_state"]
          suggested_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          earliest_fill_at?: string
          expires_at?: string
          id?: string
          match_confidence?: number
          match_reasons?: string[]
          primary_base?: string
          proposed_legs?: Json
          rejection_reason?: string | null
          resulting_spread_id?: string | null
          state?: Database["public"]["Enums"]["candidate_state"]
          suggested_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spread_candidates_resulting_spread_id_fkey"
            columns: ["resulting_spread_id"]
            isOneToOne: false
            referencedRelation: "spread_pnl"
            referencedColumns: ["spread_id"]
          },
          {
            foreignKeyName: "spread_candidates_resulting_spread_id_fkey"
            columns: ["resulting_spread_id"]
            isOneToOne: false
            referencedRelation: "spreads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spread_candidates_suggested_type_fkey"
            columns: ["suggested_type"]
            isOneToOne: false
            referencedRelation: "spread_type_catalog"
            referencedColumns: ["code"]
          },
        ]
      }
      spread_legs: {
        Row: {
          created_at: string
          id: string
          leg_index: number
          position_id: string
          role: string
          spread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          leg_index: number
          position_id: string
          role: string
          spread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          leg_index?: number
          position_id?: string
          role?: string
          spread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spread_legs_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: true
            referencedRelation: "position_pnl"
            referencedColumns: ["position_id"]
          },
          {
            foreignKeyName: "spread_legs_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: true
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spread_legs_spread_id_fkey"
            columns: ["spread_id"]
            isOneToOne: false
            referencedRelation: "spread_pnl"
            referencedColumns: ["spread_id"]
          },
          {
            foreignKeyName: "spread_legs_spread_id_fkey"
            columns: ["spread_id"]
            isOneToOne: false
            referencedRelation: "spreads"
            referencedColumns: ["id"]
          },
        ]
      }
      spread_tags: {
        Row: {
          created_at: string
          spread_id: string
          tag_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          spread_id: string
          tag_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          spread_id?: string
          tag_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spread_tags_spread_id_fkey"
            columns: ["spread_id"]
            isOneToOne: false
            referencedRelation: "spread_pnl"
            referencedColumns: ["spread_id"]
          },
          {
            foreignKeyName: "spread_tags_spread_id_fkey"
            columns: ["spread_id"]
            isOneToOne: false
            referencedRelation: "spreads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spread_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      spread_type_catalog: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_name: string
          is_active: boolean
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_name: string
          is_active?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_name?: string
          is_active?: boolean
        }
        Relationships: []
      }
      spreads: {
        Row: {
          apr: number | null
          capital_deployed_usd: number | null
          closed_at: string | null
          created_at: string
          custom_tags: string[]
          deleted_at: string | null
          exchanges: string[]
          fees_pnl_quote: number
          funding_pnl_quote: number
          gross_pnl_quote: number
          hold_duration_ms: number | null
          id: string
          leg_count: number
          match_confidence: number | null
          name: string
          net_pnl_quote: number
          notes_summary: string | null
          opened_at: string | null
          origin: Database["public"]["Enums"]["spread_origin"]
          primary_base: string
          regime_tags: string[]
          source: string
          spread_type: string
          status: Database["public"]["Enums"]["spread_status"]
          system_proposal_metadata: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          apr?: number | null
          capital_deployed_usd?: number | null
          closed_at?: string | null
          created_at?: string
          custom_tags?: string[]
          deleted_at?: string | null
          exchanges?: string[]
          fees_pnl_quote?: number
          funding_pnl_quote?: number
          gross_pnl_quote?: number
          hold_duration_ms?: number | null
          id?: string
          leg_count?: number
          match_confidence?: number | null
          name: string
          net_pnl_quote?: number
          notes_summary?: string | null
          opened_at?: string | null
          origin?: Database["public"]["Enums"]["spread_origin"]
          primary_base: string
          regime_tags?: string[]
          source?: string
          spread_type: string
          status?: Database["public"]["Enums"]["spread_status"]
          system_proposal_metadata?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          apr?: number | null
          capital_deployed_usd?: number | null
          closed_at?: string | null
          created_at?: string
          custom_tags?: string[]
          deleted_at?: string | null
          exchanges?: string[]
          fees_pnl_quote?: number
          funding_pnl_quote?: number
          gross_pnl_quote?: number
          hold_duration_ms?: number | null
          id?: string
          leg_count?: number
          match_confidence?: number | null
          name?: string
          net_pnl_quote?: number
          notes_summary?: string | null
          opened_at?: string | null
          origin?: Database["public"]["Enums"]["spread_origin"]
          primary_base?: string
          regime_tags?: string[]
          source?: string
          spread_type?: string
          status?: Database["public"]["Enums"]["spread_status"]
          system_proposal_metadata?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spreads_spread_type_fkey"
            columns: ["spread_type"]
            isOneToOne: false
            referencedRelation: "spread_type_catalog"
            referencedColumns: ["code"]
          },
        ]
      }
      sync_jobs: {
        Row: {
          created_at: string
          cursor_from: string | null
          cursor_to: string | null
          error_code: string | null
          error_message: string | null
          exchange_connection_id: string
          fills_pulled: number
          finished_at: string | null
          funding_pulled: number
          id: string
          started_at: string | null
          state: Database["public"]["Enums"]["sync_job_state"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cursor_from?: string | null
          cursor_to?: string | null
          error_code?: string | null
          error_message?: string | null
          exchange_connection_id: string
          fills_pulled?: number
          finished_at?: string | null
          funding_pulled?: number
          id?: string
          started_at?: string | null
          state?: Database["public"]["Enums"]["sync_job_state"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cursor_from?: string | null
          cursor_to?: string | null
          error_code?: string | null
          error_message?: string | null
          exchange_connection_id?: string
          fills_pulled?: number
          finished_at?: string | null
          funding_pulled?: number
          id?: string
          started_at?: string | null
          state?: Database["public"]["Enums"]["sync_job_state"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_exchange_connection_id_fkey"
            columns: ["exchange_connection_id"]
            isOneToOne: false
            referencedRelation: "exchange_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      daily_pnl: {
        Row: {
          day: string | null
          fees_pnl: number | null
          funding_pnl: number | null
          net_pnl: number | null
          realized_pnl: number | null
          user_id: string | null
        }
        Relationships: []
      }
      my_daily_pnl: {
        Row: {
          day: string | null
          fees_pnl: number | null
          funding_pnl: number | null
          net_pnl: number | null
          realized_pnl: number | null
          user_id: string | null
        }
        Relationships: []
      }
      position_pnl: {
        Row: {
          avg_entry_price: number | null
          avg_exit_price: number | null
          closed_at: string | null
          exchange_connection_id: string | null
          instrument: string | null
          instrument_type: Database["public"]["Enums"]["instrument_type"] | null
          last_mark_at: string | null
          last_mark_price: number | null
          net_pnl_quote: number | null
          opened_at: string | null
          position_id: string | null
          qty_open: number | null
          realized_pnl_quote: number | null
          side: Database["public"]["Enums"]["position_side"] | null
          status: Database["public"]["Enums"]["position_status"] | null
          total_fees_quote: number | null
          total_funding_quote: number | null
          total_qty: number | null
          unrealized_pnl_quote: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "positions_exchange_connection_id_fkey"
            columns: ["exchange_connection_id"]
            isOneToOne: false
            referencedRelation: "exchange_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      spread_pnl: {
        Row: {
          apr_computed: number | null
          capital_deployed_usd: number | null
          closed_at: string | null
          created_at: string | null
          custom_tags: string[] | null
          days_held: number | null
          exchanges: string[] | null
          fees_quote: number | null
          funding_pnl_quote: number | null
          gross_pnl_quote: number | null
          leg_count: number | null
          name: string | null
          net_pnl_quote: number | null
          opened_at: string | null
          primary_base: string | null
          realized_pnl_quote: number | null
          regime_tags: string[] | null
          spread_id: string | null
          spread_type: string | null
          status: Database["public"]["Enums"]["spread_status"] | null
          unrealized_pnl_quote: number | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spreads_spread_type_fkey"
            columns: ["spread_type"]
            isOneToOne: false
            referencedRelation: "spread_type_catalog"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Functions: {
      is_admin: { Args: { p_user_id: string }; Returns: boolean }
      recompute_position_aggregates: {
        Args: { p_position_id: string }
        Returns: undefined
      }
      refresh_daily_pnl: { Args: never; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      allowlist_role: "user" | "admin"
      candidate_state: "pending" | "accepted" | "rejected" | "expired"
      connection_status:
        | "pending"
        | "active"
        | "syncing"
        | "auth_failed"
        | "rate_limited"
        | "error"
        | "disabled"
      fee_kind: "maker" | "taker" | "funding" | "withdrawal" | "gas"
      fill_side: "buy" | "sell"
      instrument_type: "spot" | "perp" | "dated_future" | "option"
      margin_mode: "cross" | "isolated" | "spot"
      position_side: "long" | "short"
      position_status: "open" | "closed"
      spread_origin: "auto_matched" | "manual" | "auto_confirmed"
      spread_status: "candidate" | "open" | "closed" | "rejected"
      sync_job_state: "queued" | "running" | "succeeded" | "failed"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      allowlist_role: ["user", "admin"],
      candidate_state: ["pending", "accepted", "rejected", "expired"],
      connection_status: [
        "pending",
        "active",
        "syncing",
        "auth_failed",
        "rate_limited",
        "error",
        "disabled",
      ],
      fee_kind: ["maker", "taker", "funding", "withdrawal", "gas"],
      fill_side: ["buy", "sell"],
      instrument_type: ["spot", "perp", "dated_future", "option"],
      margin_mode: ["cross", "isolated", "spot"],
      position_side: ["long", "short"],
      position_status: ["open", "closed"],
      spread_origin: ["auto_matched", "manual", "auto_confirmed"],
      spread_status: ["candidate", "open", "closed", "rejected"],
      sync_job_state: ["queued", "running", "succeeded", "failed"],
    },
  },
} as const
