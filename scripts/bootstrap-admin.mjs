#!/usr/bin/env node
/**
 * Bootstrap a superadmin account for the kids_eshop CMS.
 *
 *   # Promote an existing user to admin:
 *   npm run admin:grant -- --email you@example.com
 *
 *   # Create a new admin user from scratch (creates the auth row, confirms email,
 *   # then assigns the admin role):
 *   npm run admin:create -- --email you@example.com --password 'SuperSecret123'
 *
 *   # Revoke admin access:
 *   npm run admin:revoke -- --email someone@example.com
 *
 * Requirements: real Supabase credentials in `.env.local` (the npm scripts
 * pass `--env-file=.env.local` to Node automatically).
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  options: {
    email: { type: "string", short: "e" },
    password: { type: "string", short: "p" },
    create: { type: "boolean", default: false },
    revoke: { type: "boolean", default: false },
    role: { type: "string", default: "admin" },
  },
  allowPositionals: true,
  strict: false,
});

const subcommand = positionals[0];

if (!values.email) {
  console.error(
    "Usage: node --env-file=.env.local scripts/bootstrap-admin.mjs --email <addr> [--create --password <pw>] [--revoke] [--role <name>]"
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || url.includes("placeholder")) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL is not set or still a placeholder.");
  process.exit(1);
}
if (!serviceKey || serviceKey.startsWith("placeholder") || serviceKey === "your-service-role-key") {
  console.error("✗ SUPABASE_SERVICE_ROLE_KEY is not set or still a placeholder.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const role = values.role ?? "admin";

if (values.revoke || subcommand === "revoke") {
  const { error } = await supabase.rpc("revoke_role_by_email", {
    p_email: values.email,
    p_role_name: role,
  });
  if (error) {
    console.error(`✗ Revoke failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`✓ Revoked role '${role}' from ${values.email}`);
  process.exit(0);
}

if (values.create || subcommand === "create") {
  if (!values.password) {
    console.error("✗ --create requires --password");
    process.exit(1);
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email: values.email,
    password: values.password,
    email_confirm: true,
  });

  if (error) {
    // Tolerate "already registered" — we'll just elevate the existing user.
    const msg = error.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      console.log(`ℹ ${values.email} already exists — proceeding to grant role.`);
    } else {
      console.error(`✗ createUser failed: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log(`✓ Created user ${values.email} (id: ${data.user.id})`);
  }
}

const { error: rpcError } = await supabase.rpc("grant_role_by_email", {
  p_email: values.email,
  p_role_name: role,
});

if (rpcError) {
  console.error(`✗ Grant failed: ${rpcError.message}`);
  if (rpcError.message.includes("No auth.users row")) {
    console.error("  Hint: pass --create --password to create the user first.");
  }
  process.exit(1);
}

console.log(`✓ Granted role '${role}' to ${values.email}`);
console.log(`  Sign in at /auth/signin and visit /admin to verify access.`);
