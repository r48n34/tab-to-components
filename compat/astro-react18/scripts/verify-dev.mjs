// Dev-server verification for the tab-to-components Astro fixture.
//
// Starts the Astro dev server through the official JavaScript API, checks the
// SSR markup and the modules Astro serves, then stops the server cleanly.
// Run: node scripts/verify-dev.mjs   (port override: TTC_ASTRO_PORT)

// Astro's telemetry creates its config under %APPDATA%\astro and throws EPERM
// when the profile is read-only. This must be set before Astro's module graph
// is evaluated, so the Astro import below is dynamic.
process.env.ASTRO_TELEMETRY_DISABLED ??= "1";
const { dev } = await import("astro");

const port = Number(process.env.TTC_ASTRO_PORT ?? "4400");
const origin = `http://127.0.0.1:${port}`;
const results = [];

// status: "pass" | "fail" | "na" (assertion intentionally does not apply)
function record(check, status, evidence) {
  results.push({ check, status, evidence });
}

function snippet(text, needle, radius = 100) {
  const index = text.indexOf(needle);
  if (index === -1) return "";
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + needle.length + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 320);
}

async function request(path) {
  const response = await fetch(origin + path);
  return {
    path,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text: await response.text(),
  };
}

let server;
try {
  server = await dev({
    root: process.cwd(),
    logLevel: "error",
    server: { port, host: "127.0.0.1" },
  });
} catch (error) {
  console.log(
    JSON.stringify(
      { phase: "dev-server-start", error: error?.stack ?? String(error) },
      null,
      2,
    ),
  );
  process.exit(1);
}

try {
  const page = await request("/");
  record(
    "GET / returns 200",
    page.status === 200 ? "pass" : "fail",
    `status=${page.status} content-type=${page.contentType}`,
  );

  const mainTag = page.text.match(/<main[^>]*>/i)?.[0] ?? "";
  const buttonTag = page.text.match(/<button[^>]*>/i)?.[0] ?? "";
  record(
    "SSR <main> has data-ttc",
    /data-ttc="/.test(mainTag) ? "pass" : "fail",
    mainTag,
  );
  record(
    "SSR <button> has data-ttc",
    /data-ttc="/.test(buttonTag) ? "pass" : "fail",
    buttonTag,
  );

  // `data-ttc-name` is emitted on component *usage* sites (<Button />), i.e. it
  // arrives as a React prop. This fixture's Button does not spread props onto
  // its DOM node, so the attribute cannot appear in server-rendered HTML for
  // any React renderer; the marker is asserted on the served module instead.
  record(
    "SSR HTML has data-ttc-name",
    /data-ttc-name="/.test(page.text)
      ? "pass"
      : "na",
    /data-ttc-name="/.test(page.text)
      ? snippet(page.text, "data-ttc-name")
      : "component-usage markers are React props; Button does not forward props, so this fixture cannot render data-ttc-name into HTML (not Astro-specific)",
  );

  const componentUrl = page.text.match(/component-url="([^"]+)"/)?.[1] ?? "";
  record(
    "SSR HTML has astro-island",
    page.text.includes("<astro-island") ? "pass" : "fail",
    snippet(page.text, "<astro-island"),
  );
  record(
    "island component-url targets App.tsx",
    componentUrl.includes("src/components/App.tsx") ? "pass" : "fail",
    `component-url=${componentUrl}`,
  );
  record(
    "island has client:load directive",
    /client="load"/.test(page.text) ? "pass" : "fail",
    snippet(page.text, 'client="load"'),
  );
  record(
    "SSR HTML wires the astro-island hydration script",
    /customElements\.define\(`?astro-island`?/.test(page.text)
      ? "pass"
      : "fail",
    snippet(page.text, "astro-island`,o"),
  );

  let appModule;
  for (const modulePath of [
    "/src/components/App.tsx",
    "/src/components/Button.tsx",
  ]) {
    const module = await request(modulePath);
    if (modulePath.endsWith("App.tsx")) appModule = module;
    record(
      `GET ${modulePath} returns 200`,
      module.status === 200 ? "pass" : "fail",
      `status=${module.status} content-type=${module.contentType}`,
    );
    record(
      `${modulePath} contains data-ttc markers`,
      module.text.includes("data-ttc") ? "pass" : "fail",
      snippet(module.text, "data-ttc"),
    );
    record(
      `${modulePath} imports virtual:tab-to-components/client`,
      module.text.includes("virtual:tab-to-components/client") ? "pass" : "fail",
      snippet(module.text, "virtual:tab-to-components/client"),
    );
  }

  record(
    "served App.tsx contains the data-ttc-name <Button> usage marker",
    appModule?.text.includes("data-ttc-name") ? "pass" : "fail",
    snippet(appModule?.text ?? "", "data-ttc-name"),
  );

  const virtual = await request(
    "/@id/__x00__virtual:tab-to-components/client",
  );
  record(
    "GET /@id/__x00__virtual:tab-to-components/client returns 200",
    virtual.status === 200 ? "pass" : "fail",
    `status=${virtual.status} content-type=${virtual.contentType}`,
  );
  record(
    "virtual client module contains __TTC_CONFIG__",
    virtual.text.includes("__TTC_CONFIG__") ? "pass" : "fail",
    snippet(virtual.text, "__TTC_CONFIG__"),
  );
  record(
    "virtual client module contains overlay runtime",
    virtual.text.includes("__TTC_READY__") &&
      virtual.text.includes("__TTC_INSTALLED__")
      ? "pass"
      : "fail",
    snippet(virtual.text, "__TTC_READY__"),
  );
} catch (error) {
  record("verification crashed", "fail", error?.stack ?? String(error));
} finally {
  await server.stop();
}

const failed = results.filter((result) => result.status === "fail").length;
const passed = results.filter((result) => result.status === "pass").length;
const notApplicable = results.filter((result) => result.status === "na").length;
console.log(
  JSON.stringify(
    {
      fixture: process.cwd(),
      origin,
      results,
      passed,
      failed,
      notApplicable,
    },
    null,
    2,
  ),
);
process.exit(failed === 0 ? 0 : 1);
