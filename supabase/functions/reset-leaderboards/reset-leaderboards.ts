
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://dudewolf925.github.io",
  "Access-Control-Allow-Headers":
    "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders
  });
}

Deno.serve(async (req) => {
  // Handle Safari's CORS preflight request.
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  if (req.method !== "POST") {
    return json({
      ok: false,
      error: "Method not allowed"
    }, 405);
  }

  // Private values stored in Supabase, never GitHub.
  const expectedPassword =
    Deno.env.get("D12_ADMIN_RESET_PASSWORD");

  const supabaseUrl =
    Deno.env.get("SUPABASE_URL");

  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!expectedPassword || !supabaseUrl || !serviceKey) {
    return json({
      ok: false,
      error: "Server configuration missing"
    }, 500);
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return json({
      ok: false,
      error: "Invalid JSON"
    }, 400);
  }

  if (
    typeof body?.password !== "string" ||
    body.password !== expectedPassword
  ) {
    return json({
      ok: false,
      error: "Incorrect admin password"
    }, 403);
  }

  if (body.confirmation !== "RESET") {
    return json({
      ok: false,
      error: "Reset confirmation required"
    }, 400);
  }

  const supabase = createClient(
    supabaseUrl,
    serviceKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  const { error } = await supabase
    .from("d12_scores")
    .delete()
    .not("id", "is", null);

  if (error) {
    console.error("Leaderboard reset failed:", error.message);

    return json({
      ok: false,
      error: "Database reset failed"
    }, 500);
  }

  return json({
    ok: true,
    message: "Both leaderboards have been reset"
  });
});
