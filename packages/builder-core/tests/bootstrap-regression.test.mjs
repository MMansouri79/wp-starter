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

test("bootstrap disables Elementor Atomic Editor before activation and after plugin hooks only when Elementor is bundled", async () => {
  const bootstrap = await readFile(path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), "utf8");
  const activationStart = bootstrap.indexOf("if ( 'activate_plugins' === $phase )");
  const activationEnd = bootstrap.indexOf("if ( 'fonts' === $phase )", activationStart);
  assert.notEqual(activationStart, -1, "plugin activation phase should exist");
  assert.notEqual(activationEnd, -1, "font phase should follow plugin activation");

  const activation = bootstrap.slice(activationStart, activationEnd);
  const optionPreparation = activation.indexOf("self::disable_elementor_atomic_editor()");
  const pluginActivation = activation.indexOf("self::activate_plugin_component( $plugin )");
  assert.notEqual(optionPreparation, -1, "Atomic Editor preparation should run in the activation phase");
  assert.ok(optionPreparation < pluginActivation, "Atomic Editor must be disabled before any bundled plugin activation");
  assert.match(activation, /if \( ! \$atomic_editor_prepared && self::build_has_plugin\( \$plugins, 'elementor\/elementor\.php' \) \)/, "the option should only be prepared when Elementor is bundled");
  assert.match(bootstrap, /'activation_failures'\s*=>\s*0, 'elementor_prepared'\s*=>\s*false, 'atomic_editor_prepared'\s*=>\s*false/, "fresh plugin activation should initialize the one-time preparation state");

  const queueFinished = activation.indexOf("if ( empty( $queue ) )");
  const fontsTransition = activation.indexOf("self::save_state( array( 'phase' => 'fonts' ) )", queueFinished);
  const finalPreparation = activation.indexOf("self::disable_elementor_atomic_editor()", queueFinished);
  assert.notEqual(queueFinished, -1, "the activation phase should have a completion branch");
  assert.ok(finalPreparation >= queueFinished && finalPreparation < fontsTransition, "the option should be verified in the empty-queue branch before setup advances");
  assert.match(activation.slice(queueFinished, fontsTransition), /self::build_has_plugin\( \$plugins, 'elementor\/elementor\.php' \)/, "the final check should remain conditional on Elementor being bundled");

  const helperStart = bootstrap.indexOf("private static function disable_elementor_atomic_editor()");
  const helperEnd = bootstrap.indexOf("private static function ensure_woocommerce_ready()", helperStart);
  const helper = bootstrap.slice(helperStart, helperEnd);
  assert.match(helper, /\$option = 'elementor_experiment-e_atomic_elements'/);
  assert.match(helper, /update_option\( \$option, 'inactive', false \)/, "the experiment should be seeded inactive");
  assert.match(helper, /'inactive' !== get_option\( \$option \)/, "the persisted option should be verified before setup proceeds");
  assert.match(helper, /starter_atomic_editor_disable_failed/, "failed verification should stop setup with a clear error");
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

test("exporter emits labels-only Elementor global reference metadata", async () => {
  const exporter = await readFile(path.join(repoRoot, "wordpress/exporter/includes/class-exporter.php"), "utf8");
  assert.equal(exporter.includes("elementor_global_reference_catalog"), true);
  assert.equal(exporter.includes("'globalReferences'"), true);
  assert.match(exporter, /'sourceId'\s*=>/);
  assert.match(exporter, /'name'\s*=>/);
});

test("exporter excludes Elementor Kits and ignores empty template references", async () => {
  const exporter = await readFile(path.join(repoRoot, "wordpress/exporter/includes/class-exporter.php"), "utf8");
  assert.match(exporter, /'kit'\s*===\s*\$type/);
  assert.match(exporter, /''\s*===\s*\$source_id\s*\|\|\s*'0'\s*===\s*\$source_id/);
  assert.match(exporter, /elementor_template_dependencies/);
  assert.match(exporter, /'sourceId'\s*=>/);
  assert.match(exporter, /\$post->ID\s*===\s*\$active_kit_id/);
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
  assert.equal(bootstrap.includes("const CONFIG_REVISION = 12;"), true);
  assert.match(bootstrap, /\$font_profiles = isset\( \$build\['fontSystems'\] \)[\s\S]*?foreach \( \$font_profiles as \$font_profile \)/);
  assert.equal(bootstrap.includes("starter-elementor-templates.json"), true);
  assert.match(bootstrap, /\$completed && \$revision < self::CONFIG_REVISION[\s\S]{0,180}'phase' => 'atomic_editor'/);
  assert.match(bootstrap, /if \( 'atomic_editor' === \$phase \)[\s\S]+?build_has_plugin\( \$plugins, 'elementor\/elementor\.php' \)[\s\S]+?disable_elementor_atomic_editor\(\)[\s\S]+?'phase' => 'fonts'/, "completed older setups should disable Atomic Editor once, then continue the existing migration");
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
  for (const marker of ["starter-design-system.json", "apply_vnext_design_system", "system_colors", "custom_colors", "system_typography", "custom_typography", "globalTypography", "globalCustomTypography", "typography_typography", "default_generic_fonts", "body_typography_font_family", "link_normal_typography", "h1_typography", "button_typography", "form_field_typography", "apply_elementor_theme_typography", "starter_vnext_unresolved_reference", "remap_vnext_value", "_wp_starter_vnext_id"]) {
    assert.equal(bootstrap.includes(marker), true, `${marker} should be present in the vNext provisioning path`);
  }
  assert.match(bootstrap, /Always emit all four system fonts/);
  assert.match(bootstrap, /'typography_typography'\s*=>\s*'custom'/);
  assert.match(bootstrap, /\$id = \$alias;/);
});

test("bootstrap shows a staged progress screen and advances provisioning through authenticated requests", async () => {
  const bootstrap = await readFile(path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), "utf8");
  for (const marker of ["SETUP_PAGE_SLUG = 'wp-starter-setup'", "register_setup_page", "setup_progress_data", "role=\"progressbar\"", "wpstarter_step", "wp_starter_setup_step", "This screen will update as each stage finishes."])
    assert.equal(bootstrap.includes(marker), true, `${marker} should be present in the setup progress flow`);
  assert.match(bootstrap, /'install_plugins' => 'Installing plugins'/);
  assert.match(bootstrap, /'configure' => 'Applying WordPress settings'/);
});

test("bootstrap imports the independent template payload between design and configuration", async () => {
  const bootstrap = await readFile(path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"), "utf8");
  assert.match(bootstrap, /'design_system' === \$phase[\s\S]+?'phase' => empty\( \$template_payload \) \? 'languages' : 'elementor_templates'/);
  assert.match(bootstrap, /'elementor_templates' === \$phase[\s\S]+?apply_elementor_templates_adapter/);
  assert.equal(bootstrap.includes("elementorTemplatePayload"), true);
});
