import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
const files = [
  ...walk(path.join(root, "web/src")),
  ...walk(path.join(root, "tools")),
  ...walk(path.join(root, "tests")),
];
let checked = 0;
for (const f of files.filter((f) => /\.(js|mjs|cjs)$/.test(f))) {
  execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  const source = fs.readFileSync(f, "utf8");
  for (const m of source.matchAll(
    /(?:from\s*|import\s*)['"](\.\.?\/[^'"]+)['"]/g,
  )) {
    if (!fs.existsSync(path.resolve(path.dirname(f), m[1])))
      throw Error("Missing module import " + m[1] + " in " + f);
  }
  checked++;
}
const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
if (new Set(ids).size !== ids.length) throw Error("Duplicate HTML IDs.");
for (const m of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
  if (/^(data:|https?:)/.test(m[1]))
    throw Error("App entry point must not use external assets.");
  if (!fs.existsSync(path.join(root, "web", m[1])))
    throw Error("Missing app resource: " + m[1]);
}
for (const file of [
  ".github/workflows/android-build.yml",
  ".gitignore",
  "android/app/build.gradle",
  "android/app/src/main/AndroidManifest.xml",
  "web/vendor/JSZip-LICENSE.md",
])
  if (!fs.existsSync(path.join(root, file)))
    throw Error("Missing required file: " + file);
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/android-build.yml"),
  "utf8",
);
if (workflow.includes(":app:bundleRelease"))
  throw Error("APK-only workflow must not build an AAB.");
if (!workflow.includes("arm64-v8a")) throw Error("ARM64 workflow missing.");
const gradle = fs.readFileSync(
  path.join(root, "android/app/build.gradle"),
  "utf8",
);
if (!gradle.includes("include 'arm64-v8a'"))
  throw Error("ARM64 split missing.");
console.log(
  `Source checks passed: ${checked} JavaScript files, ${ids.length} unique HTML IDs, all local resources present, ARM64 APK-only workflow.`,
);
