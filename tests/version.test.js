import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { version } = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const html = readFileSync(resolve("src/index.html"), "utf8");

// The version shown on the portal is how support tells which build a location
// runs, so it must never drift from package.json.
describe("portal build version", () => {
  it("shows the package.json version in the footer", () => {
    expect(html).toContain(`<p id="portal-version"`);
    expect(html).toContain(`>Portal v${version}</p>`);
  });

  it("carries the same version in the portal-version meta tag", () => {
    expect(html).toContain(`<meta name="portal-version" content="${version}">`);
  });
});
