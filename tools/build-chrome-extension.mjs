import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { zipDirectory } from "./zip-directory.mjs";

const outputDir = "dist/pi-webview-chrome";
const outputZip = "dist/pi-webview-chrome.zip";

execFileSync("pnpm", ["build"], { stdio: "inherit" });
rmSync(outputDir, { recursive: true, force: true });
rmSync(outputZip, { force: true });
mkdirSync(outputDir, { recursive: true });
cpSync("dist/web", outputDir, { recursive: true });

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(
  readFileSync("src/adapters/browser/chrome/manifest.json", "utf8"),
);
manifest.version = packageJson.version;
writeFileSync(`${outputDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
cpSync("src/adapters/browser/chrome/_locales", `${outputDir}/_locales`, {
  recursive: true,
});
cpSync(
  "src/adapters/browser/chrome/microphone-permission.html",
  `${outputDir}/microphone-permission.html`,
);
cpSync("src/adapters/browser/chrome/icons", `${outputDir}/icons`, {
  recursive: true,
});

await Promise.all([
  build({
    entryPoints: ["src/adapters/browser/chrome/service-worker.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: `${outputDir}/service-worker.js`,
    logLevel: "info",
  }),
  build({
    entryPoints: ["src/adapters/browser/chrome/content-script.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: `${outputDir}/content-script.js`,
    logLevel: "info",
  }),
  build({
    entryPoints: ["src/adapters/browser/chrome/microphone-permission.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: `${outputDir}/microphone-permission.js`,
    logLevel: "info",
  }),
]);

zipDirectory(outputDir, outputZip);
console.log(`✓ Chrome companion → ${outputDir}/ and ${outputZip}`);
