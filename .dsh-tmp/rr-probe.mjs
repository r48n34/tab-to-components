const base = process.argv[2] ?? "http://localhost:5391";

function decodeInlineMap(code) {
  const match =
    /\/\/# sourceMappingURL=data:application\/json[^,]*;base64,([A-Za-z0-9+/=]+)/.exec(code);
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
  } catch {
    return null;
  }
}

const paths = [
  "/cats/",
  "/cats/app/routes/home.tsx",
  "/cats/app/root.tsx",
  "/cats/app/components/Button.tsx",
];

for (const path of paths) {
  const url = new URL(path, base).href;
  const response = await fetch(url);
  const text = await response.text();
  console.log("==", path, response.status, "bytes", text.length);
  if (!path.endsWith(".tsx")) {
    const scripts = [...text.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((value) => value.includes("/cats/"))
      .slice(0, 8);
    console.log("   refs:", scripts);
    continue;
  }
  const jsxFileName = /_jsxFileName\s*=\s*("(?:[^"\\]|\\.)*")/.exec(text);
  const fileNameProp = /\bfileName\s*:\s*("(?:[^"\\]|\\.)*")/.exec(text);
  const refreshRegister = /RefreshRuntime\.register\(\s*[^,]+,\s*("(?:[^"\\]|\\.)*")/.exec(text);
  console.log("   _jsxFileName:", jsxFileName ? jsxFileName[1] : null);
  console.log("   fileName prop:", fileNameProp ? fileNameProp[1] : null);
  console.log("   refresh register:", refreshRegister ? refreshRegister[1] : null);
  const map = decodeInlineMap(text);
  if (map) {
    console.log("   MAP.file:", JSON.stringify(map.file));
    console.log("   MAP.sources:", JSON.stringify(map.sources));
    console.log("   MAP.sourceRoot:", JSON.stringify(map.sourceRoot));
  } else {
    console.log("   no inline map; tail:", JSON.stringify(text.slice(-160)));
  }
}
