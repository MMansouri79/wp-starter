<?php
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

return array(
    /*
     * Portable WordPress baseline only. Site identity, URLs, admin email,
     * taxonomy IDs, page IDs and other destination-specific values are omitted.
     */
    'wordpress_options' => array(
        'blog_public',
        'default_comment_status',
        'default_ping_status',
        'users_can_register',
        'default_role',
        'posts_per_page',
        'posts_per_rss',
        'rss_use_excerpt',
        'timezone_string',
        'date_format',
        'time_format',
        'start_of_week',
        'use_smilies',
        'default_post_format',
        'require_name_email',
        'comment_registration',
        'close_comments_for_old_posts',
        'close_comments_days_old',
        'thread_comments',
        'thread_comments_depth',
        'page_comments',
        'comments_per_page',
        'default_comments_page',
        'comment_order',
        'comments_notify',
        'moderation_notify',
        'comment_moderation',
        'comment_previously_approved',
        'comment_max_links',
        'show_avatars',
        'avatar_rating',
        'avatar_default',
        'thumbnail_size_w',
        'thumbnail_size_h',
        'thumbnail_crop',
        'medium_size_w',
        'medium_size_h',
        'medium_large_size_w',
        'medium_large_size_h',
        'large_size_w',
        'large_size_h',
    ),

    /*
     * Elementor standalone options are deliberately excluded. The starter
     * should carry reusable layout structure, not editor preferences, fonts,
     * colors, feature flags, account state, or other site-specific behavior.
     */
    'elementor_options' => array(),

    /*
     * Structural Elementor Site Settings only. These are layout primitives
     * that can reasonably stay consistent between projects. Visual design
     * tokens (colors, typography, body/link/heading/button/form/lightbox
     * styles), site identity, custom CSS and WooCommerce IDs are excluded.
     */
    'elementor_kit_exact' => array(
        'container_width',
        'container_padding',
        'space_between_widgets',
        'page_title_selector',
        'stretched_section_container',
        'default_page_template',
        'active_breakpoints',
    ),

    /*
     * Responsive variants of the approved structural controls plus Elementor
     * breakpoint values. Prefixes are intentionally narrow.
     */
    'elementor_kit_prefixes' => array(
        'container_width_',
        'container_padding_',
        'space_between_widgets_',
        'viewport_',
    ),

    'woocommerce_options' => array(
        'woocommerce_allowed_countries',
        'woocommerce_all_except_countries',
        'woocommerce_specific_allowed_countries',
        'woocommerce_calc_taxes',
        'woocommerce_cart_redirect_after_add',
        'woocommerce_checkout_address_2_field',
        'woocommerce_checkout_company_field',
        'woocommerce_checkout_highlight_required_fields',
        'woocommerce_checkout_phone_field',
        'woocommerce_currency',
        'woocommerce_currency_pos',
        'woocommerce_default_customer_address',
        'woocommerce_dimension_unit',
        'woocommerce_downloads_add_hash_to_filename',
        'woocommerce_downloads_count_partial',
        'woocommerce_downloads_deliver_inline',
        'woocommerce_downloads_grant_access_after_payment',
        'woocommerce_downloads_redirect_fallback_allowed',
        'woocommerce_downloads_require_login',
        'woocommerce_enable_ajax_add_to_cart',
        'woocommerce_enable_checkout_login_reminder',
        'woocommerce_enable_coupons',
        'woocommerce_enable_delayed_account_creation',
        'woocommerce_enable_guest_checkout',
        'woocommerce_enable_myaccount_registration',
        'woocommerce_enable_review_rating',
        'woocommerce_enable_reviews',
        'woocommerce_enable_shipping_calc',
        'woocommerce_enable_signup_and_login_from_checkout',
        'woocommerce_file_download_method',
        'woocommerce_hide_out_of_stock_items',
        'woocommerce_hold_stock_minutes',
        'woocommerce_manage_stock',
        'woocommerce_notify_low_stock',
        'woocommerce_notify_low_stock_amount',
        'woocommerce_notify_no_stock',
        'woocommerce_notify_no_stock_amount',
        'woocommerce_price_decimal_sep',
        'woocommerce_price_display_suffix',
        'woocommerce_price_num_decimals',
        'woocommerce_price_thousand_sep',
        'woocommerce_prices_include_tax',
        'woocommerce_registration_generate_password',
        'woocommerce_registration_generate_username',
        'woocommerce_review_rating_required',
        'woocommerce_review_rating_verification_label',
        'woocommerce_review_rating_verification_required',
        'woocommerce_ship_to_countries',
        'woocommerce_ship_to_destination',
        'woocommerce_shipping_cost_requires_address',
        'woocommerce_shipping_hide_rates_when_free',
        'woocommerce_shipping_tax_class',
        'woocommerce_single_image_width',
        'woocommerce_tax_based_on',
        'woocommerce_tax_classes',
        'woocommerce_tax_display_cart',
        'woocommerce_tax_display_shop',
        'woocommerce_tax_round_at_subtotal',
        'woocommerce_tax_total_display',
        'woocommerce_thumbnail_image_width',
        'woocommerce_weight_unit',
    ),

    'persian_woocommerce_options' => array(
        'persian_woocommerce_translates',
    ),

    /* Safe, reusable Code Snippets preferences. Version/debug/cloud state omitted. */
    'code_snippets_settings' => array(
        'general' => array(
            'activate_by_default',
            'enable_tags',
            'enable_description',
            'visual_editor_rows',
            'list_order',
            'disable_prism',
            'hide_upgrade_menu',
            'complete_uninstall',
            'enable_flat_files',
            'enable_admin_bar',
            'admin_bar_snippet_limit',
        ),
        'editor' => array(
            'indent_with_tabs',
            'tab_size',
            'indent_unit',
            'font_size',
            'wrap_lines',
            'code_folding',
            'line_numbers',
            'auto_close_brackets',
            'highlight_selection_matches',
            'highlight_active_line',
            'keymap',
            'theme',
        ),
    ),

    /* Portable snippet fields only. IDs/cloud/revision/error/runtime fields omitted. */
    'code_snippet_fields' => array(
        'name',
        'desc',
        'code',
        'tags',
        'scope',
        'priority',
        'active',
        'locked',
    ),
);
