
const ORIGIN = "https://dudewolf925.github.io";
const OWNER = "dudewolf925";
const REPO = "d12-survival-game";
const PATH = "game-config.json";
const BRANCH = "main";

const MAX_CONFIG_BYTES = 250000;

const corsHeaders = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers":
    "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Vary": "Origin"
};

function reply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders
  });
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function validText(
  value: unknown,
  maxLength: number
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength
  );
}

function validMediaUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;

  if (value === "") return true;

  // Allow public HTTPS images/videos.
  if (value.startsWith("https://")) {
    try {
      const url = new URL(value);

      return (
        url.protocol === "https:" &&
        !!url.hostname &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }

  // Preserve the Admin Studio's existing
  // embedded image/video support.
  if (
    /^data:(image\/(png|jpeg|gif|webp)|video\/mp4);base64,[A-Za-z0-9+/=]+$/i
      .test(value)
  ) {
    return true;
  }

  return false;
}

function validateConfig(
  value: unknown
): string | null {
  if (!isObject(value)) {
    return "Configuration must be a JSON object.";
  }

  let serialized: string;

  try {
    serialized = JSON.stringify(value);
  } catch {
    return "Configuration cannot be serialized.";
  }

  if (
    new TextEncoder().encode(serialized).length >
    MAX_CONFIG_BYTES
  ) {
    return "Configuration exceeds the size limit.";
  }

  if (
    !validText(value.title, 200) ||
    !validText(value.introTitle, 200) ||
    !validText(value.introText, 10000)
  ) {
    return "Game title or introduction is invalid.";
  }

  if (!validMediaUrl(value.homeImageUrl)) {
    return "Home image URL is invalid.";
  }

  if (
    !validText(value.supabaseUrl, 500) ||
    !validText(value.supabaseKey, 2000)
  ) {
    return "Supabase public settings are invalid.";
  }

  if (
    /service_role|sb_secret_/i.test(
      String(value.supabaseKey)
    )
  ) {
    return "A secret Supabase key cannot be published.";
  }

  if (
    value.supabaseUrl !== "" &&
    !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i
      .test(String(value.supabaseUrl))
  ) {
    return "Supabase project URL is invalid.";
  }

  if (
    !Array.isArray(value.slides) ||
    value.slides.length < 24 ||
    value.slides.length > 99
  ) {
    return "Configuration must contain 24 to 99 slides.";
  }

  const ids = new Set<number>();

  for (const entry of value.slides) {
    if (!isObject(entry)) {
      return "Every slide must be a JSON object.";
    }

    const id = entry.id;

    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      id < 1 ||
      id > 99 ||
      ids.has(id)
    ) {
      return "Slide IDs must be unique numbers from 1 to 99.";
    }

    ids.add(id);

    if (
      !validText(entry.title, 300) ||
      !validText(entry.description, 20000)
    ) {
      return `Slide ${id}: title or description is invalid.`;
    }

    if (
      !["placeholder", "image", "video"]
        .includes(String(entry.type))
    ) {
      return `Slide ${id}: invalid media type.`;
    }

    if (!validMediaUrl(entry.url)) {
      return `Slide ${id}: invalid media URL.`;
    }

    if (
      !validText(entry.redditUser, 100) ||
      (
        entry.redditUser !== "" &&
        !/^u\/[A-Za-z0-9_-]{3,20}$/
          .test(String(entry.redditUser))
      )
    ) {
      return `Slide ${id}: invalid Reddit username.`;
    }

    if (typeof entry.consequence !== "boolean") {
      return `Slide ${id}: consequence must be true or false.`;
    }

    if (
      typeof entry.destination !== "number" ||
      !Number.isInteger(entry.destination)
    ) {
      return `Slide ${id}: invalid consequence destination.`;
    }

    if (
      typeof entry.rerollLockSeconds !== "number" ||
      !Number.isInteger(entry.rerollLockSeconds) ||
      entry.rerollLockSeconds < 0 ||
      entry.rerollLockSeconds > 86400
    ) {
      return `Slide ${id}: invalid reroll lockout.`;
    }
  }

  // All original game slides must remain present.
  for (let id = 1; id <= 24; id++) {
    if (!ids.has(id)) {
      return `Required slide ${id} is missing.`;
    }
  }

  // Slide 16 is the game's winning slide.
  if (!ids.has(16)) {
    return "Winning slide 16 is missing.";
  }

  // Every consequence destination must exist.
  for (const entry of value.slides) {
    if (
      entry.consequence &&
      !ids.has(entry.destination)
    ) {
      return (
        `Slide ${entry.id}: consequence destination ` +
        `${entry.destination} does not exist.`
      );
    }
  }

  return null;
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  if (req.method !== "POST") {
    return reply({
      ok: false,
      error: "Method not allowed"
    }, 405);
  }

  // Reject requests from an unexpected browser origin.
  const origin = req.headers.get("origin");

  if (origin && origin !== ORIGIN) {
    return reply({
      ok: false,
      error: "Origin not allowed"
    }, 403);
  }

  const token = Deno.env.get("D12_GITHUB_TOKEN");
  const publishPassword =
    Deno.env.get("D12_PUBLISH_PASSWORD");

  if (!token || !publishPassword) {
    return reply({
      ok: false,
      error: "Publishing secrets are missing"
    }, 500);
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return reply({
      ok: false,
      error: "Invalid JSON"
    }, 400);
  }

  if (!isObject(body)) {
    return reply({
      ok: false,
      error: "Request body must be an object"
    }, 400);
  }

  if (
    typeof body.password !== "string" ||
    body.password !== publishPassword
  ) {
    return reply({
      ok: false,
      error: "Incorrect publishing password"
    }, 403);
  }

  // A GitHub file version is required.
  if (
    typeof body.expectedSha !== "string" ||
    !/^[a-f0-9]{40}$/i.test(body.expectedSha)
  ) {
    return reply({
      ok: false,
      error: "Load the latest GitHub configuration first."
    }, 400);
  }

  const config = body.config;

  const validationError = validateConfig(config);

  if (validationError) {
    return reply({
      ok: false,
      error: validationError
    }, 400);
  }

  const githubUrl =
    `https://api.github.com/repos/${OWNER}/${REPO}` +
    `/contents/${PATH}`;

  const githubHeaders = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "D12-Admin-Publisher"
  };

  try {
    // Read the current version of game-config.json.
    const currentResponse = await fetch(
      `${githubUrl}?ref=${BRANCH}`,
      {
        headers: githubHeaders
      }
    );

    if (!currentResponse.ok) {
      console.error(
        "GitHub read failed:",
        currentResponse.status
      );

      return reply({
        ok: false,
        error:
          "GitHub could not read game-config.json " +
          `(HTTP ${currentResponse.status})`
      }, 502);
    }

    const current = await currentResponse.json();

    if (
      !current ||
      typeof current.sha !== "string"
    ) {
      return reply({
        ok: false,
        error: "GitHub file version is missing"
      }, 502);
    }

    // Prevent overwriting changes made after loading.
    if (body.expectedSha !== current.sha) {
      return reply({
        ok: false,
        error:
          "game-config.json has changed on GitHub. " +
          "Save your draft and reload the latest " +
          "GitHub configuration before publishing."
      }, 409);
    }

    const content =
      JSON.stringify(config, null, 2) + "\n";

    const publishResponse = await fetch(
      githubUrl,
      {
        method: "PUT",
        headers: {
          ...githubHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message:
            "Update D12 game configuration from Admin Studio",
          content: encodeBase64(content),
          sha: current.sha,
          branch: BRANCH
        })
      }
    );

    let published: Record<string, unknown> = {};

    try {
      const result = await publishResponse.json();

      if (isObject(result)) {
        published = result;
      }
    } catch {
      // The HTTP status is still checked below.
    }

    if (!publishResponse.ok) {
      console.error(
        "GitHub publishing failed:",
        publishResponse.status,
        published.message
      );

      return reply({
        ok: false,
        error:
          "GitHub publishing failed " +
          `(HTTP ${publishResponse.status})`
      }, 502);
    }

    const publishedContent = published.content;

    const newSha =
      isObject(publishedContent) &&
      typeof publishedContent.sha === "string"
        ? publishedContent.sha
        : null;

    return reply({
      ok: true,
      message:
        "Game configuration published to GitHub",
      sha: newSha
    });

  } catch (error) {
    console.error(
      "Publishing request failed:",
      error
    );

    return reply({
      ok: false,
      error: "Unable to contact GitHub"
    }, 502);
  }
});
