// Per-deployment Supabase configuration.
//
// Fill these in from your Supabase project: Dashboard → Settings → API.
// The anon (publishable) key is safe to ship to browsers — every table is
// protected by Row-Level Security; the anon key grants nothing by itself.
// NEVER put the service_role key anywhere in src/.

export const SUPABASE_URL = 'https://grywkrpsrsxohurpemiz.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyeXdrcnBzcnN4b2h1cnBlbWl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MTAxNTEsImV4cCI6MjA5ODQ4NjE1MX0.iKOmuBh6_NfwM7LmnDIgAooaH5IWCHJdpkJrpvfMOhQ';

// Usernames are mapped onto synthesized auth emails (username@<domain>).
// Must match AUTH_EMAIL_DOMAIN in scripts/setup-supabase-admin.js.
export const AUTH_EMAIL_DOMAIN = 'bentoos.local';
