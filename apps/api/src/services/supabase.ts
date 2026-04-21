import { createClient } from "@supabase/supabase-js";
import { getRequiredEnv } from "../lib/env";

let client: ReturnType<typeof createClient> | null = null;

export function getSupabaseServiceClient() {
  if (!client) {
    client = createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
  }
  return client;
}
