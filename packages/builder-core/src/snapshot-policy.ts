import { BuilderError } from "./errors.js";

const WORDPRESS_OPTIONS = new Set([
  "blog_public","default_comment_status","default_ping_status","users_can_register","default_role","posts_per_page","posts_per_rss","rss_use_excerpt","timezone_string","date_format","time_format","start_of_week","use_smilies","default_post_format","require_name_email","comment_registration","close_comments_for_old_posts","close_comments_days_old","thread_comments","thread_comments_depth","page_comments","comments_per_page","default_comments_page","comment_order","comments_notify","moderation_notify","comment_moderation","comment_previously_approved","comment_max_links","show_avatars","avatar_rating","avatar_default","thumbnail_size_w","thumbnail_size_h","thumbnail_crop","medium_size_w","medium_size_h","medium_large_size_w","medium_large_size_h","large_size_w","large_size_h"
]);
const ELEMENTOR_EXACT = new Set(["container_width","container_padding","space_between_widgets","page_title_selector","stretched_section_container","default_page_template","active_breakpoints"]);
const ELEMENTOR_PREFIXES = ["container_width_","container_padding_","space_between_widgets_","viewport_"];
const WOOCOMMERCE_OPTIONS = new Set([
  "woocommerce_allowed_countries","woocommerce_all_except_countries","woocommerce_specific_allowed_countries","woocommerce_calc_taxes","woocommerce_cart_redirect_after_add","woocommerce_checkout_address_2_field","woocommerce_checkout_company_field","woocommerce_checkout_highlight_required_fields","woocommerce_checkout_phone_field","woocommerce_currency","woocommerce_currency_pos","woocommerce_default_customer_address","woocommerce_dimension_unit","woocommerce_downloads_add_hash_to_filename","woocommerce_downloads_count_partial","woocommerce_downloads_deliver_inline","woocommerce_downloads_grant_access_after_payment","woocommerce_downloads_redirect_fallback_allowed","woocommerce_downloads_require_login","woocommerce_enable_ajax_add_to_cart","woocommerce_enable_checkout_login_reminder","woocommerce_enable_coupons","woocommerce_enable_delayed_account_creation","woocommerce_enable_guest_checkout","woocommerce_enable_myaccount_registration","woocommerce_enable_review_rating","woocommerce_enable_reviews","woocommerce_enable_shipping_calc","woocommerce_enable_signup_and_login_from_checkout","woocommerce_file_download_method","woocommerce_hide_out_of_stock_items","woocommerce_hold_stock_minutes","woocommerce_manage_stock","woocommerce_notify_low_stock","woocommerce_notify_low_stock_amount","woocommerce_notify_no_stock","woocommerce_notify_no_stock_amount","woocommerce_price_decimal_sep","woocommerce_price_display_suffix","woocommerce_price_num_decimals","woocommerce_price_thousand_sep","woocommerce_prices_include_tax","woocommerce_registration_generate_password","woocommerce_registration_generate_username","woocommerce_review_rating_required","woocommerce_review_rating_verification_label","woocommerce_review_rating_verification_required","woocommerce_ship_to_countries","woocommerce_ship_to_destination","woocommerce_shipping_cost_requires_address","woocommerce_shipping_hide_rates_when_free","woocommerce_shipping_tax_class","woocommerce_single_image_width","woocommerce_tax_based_on","woocommerce_tax_classes","woocommerce_tax_display_cart","woocommerce_tax_display_shop","woocommerce_tax_round_at_subtotal","woocommerce_tax_total_display","woocommerce_thumbnail_image_width","woocommerce_weight_unit"
]);
const CODE_SNIPPET_SETTINGS: Record<string, Set<string>> = {
  general: new Set(["activate_by_default","enable_tags","enable_description","visual_editor_rows","list_order","disable_prism","hide_upgrade_menu","complete_uninstall","enable_flat_files","enable_admin_bar","admin_bar_snippet_limit"]),
  editor: new Set(["indent_with_tabs","tab_size","indent_unit","font_size","wrap_lines","code_folding","line_numbers","auto_close_brackets","highlight_selection_matches","highlight_active_line","keymap","theme"])
};
const CODE_SNIPPET_FIELDS = new Set(["name","desc","code","tags","scope","priority","active","locked","portable_key","type"]);
const TOP_LEVEL = new Set(["schema_version","exporter_version","generated_at","source","targets","wordpress","adapters","safety"]);
const ADAPTERS = new Set(["elementor","woocommerce","persian_woocommerce","code_snippets","filterx"]);

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
function rejectUnknown(actual: Record<string, any>, allowed: Set<string>, scope: string) {
  const unknown = Object.keys(actual).filter((key) => !allowed.has(key));
  if (unknown.length) throw new BuilderError("unsafe_config_snapshot", `${scope} contains unsupported field(s): ${unknown.join(", ")}`);
}
function validatePluginRows(rows: unknown, scope: string, allowActive: boolean) {
  if (!Array.isArray(rows)) throw new BuilderError("invalid_config_export", `${scope} must be an array.`);
  const allowed = new Set(["file","name","version", ...(allowActive ? ["active"] : [])]);
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new BuilderError("invalid_config_export", `${scope}[${index}] must be an object.`);
    rejectUnknown(row as Record<string, any>, allowed, `${scope}[${index}]`);
    for (const key of ["file","name","version"]) if (typeof (row as any)[key] !== "string") throw new BuilderError("invalid_config_export", `${scope}[${index}].${key} must be a string.`);
  });
}

export function validatePortableSnapshot(raw: any): void {
  if (Number(raw?.schema_version) !== 2) return; // v1 stays backward-compatible and is treated as legacy/trusted input.
  const root = object(raw);
  rejectUnknown(root, TOP_LEVEL, "snapshot");

  const source = object(root.source);
  rejectUnknown(source, new Set(["wordpress_version","php_version","locale","theme","plugins"]), "source");
  const theme = object(source.theme);
  rejectUnknown(theme, new Set(["slug","name","version"]), "source.theme");
  validatePluginRows(source.plugins, "source.plugins", true);

  const targets = object(root.targets);
  rejectUnknown(targets, new Set(["plugins"]), "targets");
  validatePluginRows(targets.plugins || [], "targets.plugins", false);

  const wordpress = object(root.wordpress);
  rejectUnknown(wordpress, new Set(["options","permalink_structure","cleanup_default_content","reading","pages"]), "wordpress");
  const options = object(wordpress.options);
  rejectUnknown(options, WORDPRESS_OPTIONS, "wordpress.options");
  const reading = object(wordpress.reading);
  rejectUnknown(reading, new Set(["front_page_role","posts_page_role"]), "wordpress.reading");
  for (const key of ["front_page_role","posts_page_role"]) {
    const value = reading[key] ?? "";
    if (!["","home","about","contact","blog"].includes(String(value))) throw new BuilderError("unsafe_config_snapshot", `wordpress.reading.${key} contains an unsupported logical role.`);
  }
  if (!Array.isArray(wordpress.pages)) throw new BuilderError("invalid_config_export", "wordpress.pages must be an array.");
  wordpress.pages.forEach((page: any, index: number) => {
    const row = object(page); rejectUnknown(row, new Set(["role","title","slug"]), `wordpress.pages[${index}]`);
    if (!["home","about","contact","blog"].includes(String(row.role || row.slug))) throw new BuilderError("unsafe_config_snapshot", `wordpress.pages[${index}] is not an approved starter role.`);
  });

  const adapters = object(root.adapters);
  rejectUnknown(adapters, ADAPTERS, "adapters");

  const elementor = object(adapters.elementor);
  rejectUnknown(elementor, new Set(["options","kit_settings","policy"]), "adapters.elementor");
  if (Object.keys(object(elementor.options)).length) throw new BuilderError("unsafe_config_snapshot", "Elementor standalone options are not permitted in schema-v2 snapshots.");
  for (const key of Object.keys(object(elementor.kit_settings))) {
    if (!ELEMENTOR_EXACT.has(key) && !ELEMENTOR_PREFIXES.some((prefix) => key.startsWith(prefix))) throw new BuilderError("unsafe_config_snapshot", `Elementor Kit setting is outside the structural allowlist: ${key}`);
  }

  const woo = object(adapters.woocommerce);
  rejectUnknown(woo, new Set(["options"]), "adapters.woocommerce");
  rejectUnknown(object(woo.options), WOOCOMMERCE_OPTIONS, "adapters.woocommerce.options");

  const pwoo = object(adapters.persian_woocommerce);
  rejectUnknown(pwoo, new Set(["options"]), "adapters.persian_woocommerce");
  rejectUnknown(object(pwoo.options), new Set(["persian_woocommerce_translates"]), "adapters.persian_woocommerce.options");

  const snippets = object(adapters.code_snippets);
  rejectUnknown(snippets, new Set(["status","settings","snippets","excluded","warning","skipped_snippets","snippet_count","reason"]), "adapters.code_snippets");
  for (const [section, values] of Object.entries(object(snippets.settings))) {
    if (!CODE_SNIPPET_SETTINGS[section]) throw new BuilderError("unsafe_config_snapshot", `Unknown Code Snippets settings section: ${section}`);
    rejectUnknown(object(values), CODE_SNIPPET_SETTINGS[section], `adapters.code_snippets.settings.${section}`);
  }
  if (!Array.isArray(snippets.snippets || [])) throw new BuilderError("invalid_config_export", "adapters.code_snippets.snippets must be an array.");
  (snippets.snippets || []).forEach((snippet: any, index: number) => {
    const row = object(snippet); rejectUnknown(row, CODE_SNIPPET_FIELDS, `adapters.code_snippets.snippets[${index}]`);
    if (typeof row.name !== "string" || typeof row.code !== "string") throw new BuilderError("invalid_config_export", `Code snippet ${index + 1} is missing name/code.`);
    if (row.scope === "condition") throw new BuilderError("unsafe_config_snapshot", "Condition-backed Code Snippets are not portable yet.");
  });

  const filterx = object(adapters.filterx);
  rejectUnknown(filterx, new Set(["status","reason"]), "adapters.filterx");

  const safety = object(root.safety);
  for (const [key, value] of Object.entries(safety)) {
    if (typeof value !== "boolean") throw new BuilderError("invalid_config_export", `safety.${key} must be boolean.`);
  }
}
