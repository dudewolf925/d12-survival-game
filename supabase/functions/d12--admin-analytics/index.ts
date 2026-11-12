
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

/*
  D12 SURVIVAL GAME
  SECURE ADMIN ANALYTICS

  Uses the existing D12_PUBLISH_PASSWORD secret.

  IMPORTANT:
  - Keep Verify JWT OFF for this function.
  - Never put your password in this source code.
  - Never put a service-role key in admin.html.
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Vary": "Origin",
    },
  });
}

function equalSecrets(
  supplied: string,
  expected: string,
): boolean {
  const encoder = new TextEncoder();

  const a = encoder.encode(supplied);
  const b = encoder.encode(expected);

  let difference = a.length ^ b.length;

  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }

  return difference === 0;
}

async function callRpc(
  supabaseUrl: string,
  serviceRoleKey: string,
  functionName: string,
): Promise<unknown> {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/${functionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: "{}",
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      `D12 RPC ${functionName} failed`,
      response.status,
      errorText,
    );

    throw new Error(
      `Database request failed: ${functionName}`,
    );
  }

  return await response.json();
}

serve(async (request: Request): Promise<Response> => {
  // Browser preflight requests must be accepted.
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method !== "POST") {
    return json(
      { ok: false, error: "Method not allowed" },
      405,
    );
  }

  try {
    const expectedPassword =
      Deno.env.get("D12_PUBLISH_PASSWORD");

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (
      !expectedPassword ||
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      console.error(
        "D12 analytics: missing required environment configuration",
      );

      return json(
        {
          ok: false,
          error: "Analytics service is not configured",
        },
        503,
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return json(
        {
          ok: false,
          error: "Invalid JSON request",
        },
        400,
      );
    }

    const password =
      body &&
      typeof body === "object" &&
      "password" in body &&
      typeof body.password === "string"
        ? body.password
        : "";

    if (
      !password ||
      !equalSecrets(password, expectedPassword)
    ) {
      console.warn(
        "D12 analytics: rejected invalid password",
      );

      return json(
        {
          ok: false,
          error: "Incorrect admin password",
        },
        401,
      );
    }

    console.log(
      "D12 analytics: authorized request received",
    );

    const [analytics, hunters] = await Promise.all([
      callRpc(
        supabaseUrl,
        serviceRoleKey,
        "d12_game_analytics",
      ),
      callRpc(
        supabaseUrl,
        serviceRoleKey,
        "d12_hunter_scores",
      ),
    ]);

    console.log(
      "D12 analytics: data loaded successfully",
    );

    return json({
      ok: true,
      analytics,
      hunters,
    });
  } catch (error) {
    console.error(
      "D12 analytics request failed:",
      error,
    );

    return json(
      {
        ok: false,
        error: "Could not load analytics",
      },
      500,
    );
  }
});
