import { createClient } from '@supabase/supabase-js'

const env = import.meta.env ?? {}
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
function isPublicKey(value) {
  if (value?.startsWith('sb_publishable_')) return true
  try {
    return JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'
  } catch { return false }
}
export let supabase = null
export let configurationError = null
if (!url || !key) {
  configurationError = 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in attendance-dashboard-web/.env, then restart the dashboard.'
} else if (!isPublicKey(key)) {
  configurationError = 'Use a Supabase publishable key (or legacy anon key), never a secret or service_role key.'
} else {
  try { supabase = createClient(url, key) }
  catch { configurationError = 'Check the Supabase project URL and publishable key in attendance-dashboard-web/.env.' }
}
export function client() {
  if (!supabase) throw new Error(configurationError)
  return supabase
}
