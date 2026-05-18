import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set');
}

// Node < 22 has no native WebSocket; provide the `ws` package as the
// realtime transport. The `unknown` intermediate cast bridges the
// constructor-signature mismatch between `ws` types and the SDK's
// `WebSocketLikeConstructor` — runtime behaviour is identical.
const wsTransport = ws as unknown as typeof globalThis.WebSocket;

// Admin client — service role key, used for user management
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: wsTransport },
});

// Anon client — used for password verification (signInWithPassword)
export const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: wsTransport },
});
