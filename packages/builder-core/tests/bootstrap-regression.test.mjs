import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

test("bootstrap owns only custom pages and repairs Elementor kit", async () => {
  const bootstrap = await readFile(path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), "utf8");
  assert.equal(bootstrap.includes("WC_Install::create_pages()"), true, "comment should document why explicit page creation is prohibited");
  assert.equal(/\n\s*WC_Install::create_pages\(\);/.test(bootstrap), false, "bootstrap must not call Woo page creation directly");
  assert.equal(bootstrap.includes("create_default_kit"), true);
  assert.equal(bootstrap.includes("cleanup_duplicate_woocommerce_pages"), true);
  assert.equal(bootstrap.includes("verify_configuration"), true);
});

test("exporter includes complete reviewed WordPress baseline keys", async () => {
  const whitelist = await readFile(path.join(repoRoot, "wordpress/exporter/config/whitelists.php"), "utf8");
  for (const key of ["page_on_front", "page_for_posts", "large_size_h"]) {
    assert.equal(whitelist.includes(`'${key}'`), true, `${key} should be exported`);
  }
});
