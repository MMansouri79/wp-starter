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
  assert.equal(whitelist.includes("'large_size_h'"), true, "large_size_h should be exported");
  assert.equal(whitelist.includes("'page_on_front'"), false, "raw front-page IDs must not be exported");
  assert.equal(whitelist.includes("'page_for_posts'"), false, "raw posts-page IDs must not be exported");
});

test("exporter records only the reference hostname as optional provenance", async () => {
  const exporter = await readFile(path.join(repoRoot, "wordpress/exporter/includes/class-exporter.php"), "utf8");
  const bootstrap = await readFile(path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), "utf8");
  assert.equal(exporter.includes("home_url()"), true);
  assert.equal(exporter.includes("$source['site_domain']"), true);
  assert.equal(exporter.includes("$parsed['host']"), true);
  assert.equal(exporter.includes("$parsed['scheme']"), false);
  assert.equal(exporter.includes("$parsed['path']"), false);
  assert.equal(exporter.includes("$parsed['port']"), false);
  assert.equal(bootstrap.includes("site_domain"), false);
});

test("bootstrap restores snippets/fonts and removes one-time payload", async () => {
  const bootstrap = await readFile(path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), "utf8");
  for (const marker of ["apply_code_snippets_adapter", "\\Code_Snippets\\save_snippet", "elementor_font_files", "elementor_font_face", "cleanup_payload_and_self", ".wp-starter-"]) {
    assert.equal(bootstrap.includes(marker), true, `${marker} should be present in hardened bootstrap`);
  }
});

test("bootstrap registers Elementor font files as WordPress attachments with id and url", async () => {
  const bootstrap = await readFile(path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), "utf8");
  assert.equal(bootstrap.includes("ensure_font_attachment"), true);
  assert.equal(bootstrap.includes("wp_insert_attachment"), true);
  assert.equal(bootstrap.includes("update_attached_file"), true);
  assert.equal(bootstrap.includes("'post_mime_type' => 'font/woff2'"), true);
  assert.equal(bootstrap.includes("'id'  => absint( $attachment_id )"), true);
  assert.equal(bootstrap.includes("'url' => esc_url_raw( $url )"), true);
  assert.equal(bootstrap.includes("const CONFIG_REVISION = 6;"), true);
  assert.match(bootstrap, /\$completed && \$revision < self::CONFIG_REVISION[\s\S]{0,180}'phase' => 'fonts'/);
});


test("bootstrap runs real activation hooks and serializes WooCommerce first boot", async () => {
  const bootstrap = await readFile(path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), "utf8");
  assert.equal(bootstrap.includes("activate_plugin( $file, '', false, false )"), true, "plugin activation hooks must run");
  assert.equal(bootstrap.includes("wp_doing_ajax()"), true, "AJAX requests must not advance provisioning");
  assert.equal(bootstrap.includes("ordered_activation_queue"), true);
  assert.match(bootstrap, /'elementor\/elementor\.php'\s*=>\s*10/);
  assert.match(bootstrap, /'woocommerce\/woocommerce\.php'\s*=>\s*20/);
  assert.match(bootstrap, /'elementor-pro\/elementor-pro\.php'\s*=>\s*30/);
  assert.equal(bootstrap.includes("begin_activation_maintenance"), true);
  assert.equal(bootstrap.includes("ensure_woocommerce_ready"), true);
  assert.equal(bootstrap.includes("woocommerce_attribute_taxonomies"), true);
  assert.equal(bootstrap.includes("woocommerce_sessions"), true);
  assert.equal(bootstrap.includes("wc_order_stats"), true);
});

test("bootstrap applies vNext design-system globals and fails unresolved template references", async () => {
  const bootstrap = await readFile(path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), "utf8");
  for (const marker of ["starter-design-system.json", "apply_vnext_design_system", "system_colors", "system_typography", "starter_vnext_unresolved_reference", "remap_vnext_value", "_wp_starter_vnext_id"]) {
    assert.equal(bootstrap.includes(marker), true, `${marker} should be present in the vNext provisioning path`);
  }
});
