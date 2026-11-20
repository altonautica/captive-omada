import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// NXS-1503: the portal talks only to the Nexus backend. Anything that pulls the
// Firebase SDK back in would make sign-in depend on the device reaching Google
// through the vessel's pre-auth allowlist again.
const shipped = readdirSync(resolve("src"))
  .filter((name) => /\.(js|html|css)$/.test(name) && name !== "jquery.min.js")
  .map((name) => [name, readFileSync(join(resolve("src"), name), "utf8")]);

describe("the portal build has no Firebase", () => {
  it.each(shipped)("%s does not reference Firebase or Google's SDK CDN", (_, text) => {
    expect(text).not.toMatch(/firebase/i);
    expect(text).not.toMatch(/gstatic\.com/i);
    expect(text).not.toMatch(/googleapis\.com/i);
  });

  it("ships no vendored Firebase SDK", () => {
    expect(existsSync(resolve("src/vendor"))).toBe(false);
    expect(existsSync(resolve("src/firebase.js"))).toBe(false);
  });
});
