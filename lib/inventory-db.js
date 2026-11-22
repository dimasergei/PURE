'use strict';
const { createClient } = require('@supabase/supabase-js');
function inventoryDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.VERCEL_ENV === 'preview' && url === 'https://sjkctzhxytraaxeyfsea.supabase.co'
    ? process.env.QA_SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('Inventory database unavailable.');
  return createClient(url, key,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
module.exports = { inventoryDb };
