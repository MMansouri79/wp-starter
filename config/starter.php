<?php
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

return array(
    'theme' => array(
        'name'   => 'Hello Elementor',
        'slug'   => 'hello-elementor',
        'source' => 'wordpress.org',
    ),

    /*
     * Profiles are intentionally small. The reference-site audit from
     * 2026-08-23 is the source of truth for the initial plugin manifest.
     * Starter page names were explicitly confirmed after audit v2.
     */
    'profiles' => array(
        'elementor' => array(
            'label'   => 'Elementor Website',
            'plugins' => array( 'classic-editor', 'elementor', 'elementor-pro' ),
            'pages'   => array(
                array( 'title' => 'Home', 'slug' => 'home' ),
                array( 'title' => 'About', 'slug' => 'about' ),
                array( 'title' => 'Contact', 'slug' => 'contact' ),
                array( 'title' => 'Blog', 'slug' => 'blog' ),
            ),
            // The real core site uses "Your latest posts". Create Home/Blog,
            // but intentionally do not assign either in Reading settings.
            'front_page_slug' => '',
            'posts_page_slug' => '',
        ),
        'woocommerce' => array(
            'label'   => 'Elementor + WooCommerce',
            'plugins' => array(
                'classic-editor',
                'elementor',
                'elementor-pro',
                'woocommerce',
                'persian-woocommerce',
                'filterx',
            ),
            'pages'   => array(
                array( 'title' => 'Home', 'slug' => 'home' ),
                array( 'title' => 'About', 'slug' => 'about' ),
                array( 'title' => 'Contact', 'slug' => 'contact' ),
                array( 'title' => 'Blog', 'slug' => 'blog' ),
            ),
            'front_page_slug' => '',
            'posts_page_slug' => '',
        ),
    ),

    'plugins' => array(
        'classic-editor' => array(
            'name'            => 'Classic Editor',
            'slug'            => 'classic-editor',
            'file'            => 'classic-editor/classic-editor.php',
            'source'          => 'wordpress.org',
            'option_prefixes' => array( 'classic-editor', 'classic_editor' ),
        ),
        'elementor' => array(
            'name'            => 'Elementor',
            'slug'            => 'elementor',
            'file'            => 'elementor/elementor.php',
            'source'          => 'wordpress.org',
            'option_prefixes' => array( 'elementor_' ),
        ),
        'elementor-pro' => array(
            'name'            => 'Elementor Pro',
            'file'            => 'elementor-pro/elementor-pro.php',
            'source'          => 'bundled',
            'package'         => 'packages/elementor-pro.zip',
            'option_prefixes' => array( 'elementor_pro_' ),
        ),
        'woocommerce' => array(
            'name'            => 'WooCommerce',
            'slug'            => 'woocommerce',
            'file'            => 'woocommerce/woocommerce.php',
            'source'          => 'wordpress.org',
            'option_prefixes' => array( 'woocommerce_', 'wc_' ),
        ),
        'persian-woocommerce' => array(
            'name'            => 'Persian WooCommerce',
            'slug'            => 'persian-woocommerce',
            'file'            => 'persian-woocommerce/woocommerce-persian.php',
            'source'          => 'wordpress.org',
            'option_prefixes' => array( 'persian_woocommerce', 'woocommerce_persian', 'pw_' ),
        ),
        'filterx' => array(
            'name'            => 'FilterX',
            'file'            => 'filterx/filterx.php',
            'source'          => 'bundled',
            'package'         => 'packages/filterx.zip',
            'option_prefixes' => array( 'filterx', 'fx_' ),
        ),
    ),

    /*
     * Baseline copied from the safe reference audit. These are ordinary
     * WordPress defaults from the reference site, not client identity data.
     */
    'wordpress_options' => array(
        'default_comment_status' => 'open',
        'default_ping_status'    => 'open',
        'users_can_register'     => 0,
        'show_on_front'          => 'posts',
        'page_on_front'          => 0,
        'page_for_posts'         => 0,
        'timezone_string'        => '',
        'date_format'            => 'F j, Y',
        'time_format'            => 'g:i a',
        'start_of_week'          => 6,
        'thumbnail_size_w'       => 150,
        'thumbnail_size_h'       => 150,
        'medium_size_w'          => 300,
        'medium_size_h'          => 300,
        'large_size_w'           => 1024,
        'large_size_h'           => 1024,
    ),

    'permalink_structure' => '/%year%/%monthnum%/%day%/%postname%/',

    // Only portable Elementor values are copied. Site name and WooCommerce
    // page IDs from the reference site are deliberately excluded.
    'elementor_options' => array(),
    'elementor_kit_settings' => array(
        'system_colors' => array(
            array( '_id' => 'primary', 'title' => 'Primary', 'color' => '#6EC1E4' ),
            array( '_id' => 'secondary', 'title' => 'Secondary', 'color' => '#54595F' ),
            array( '_id' => 'text', 'title' => 'Text', 'color' => '#7A7A7A' ),
            array( '_id' => 'accent', 'title' => 'Accent', 'color' => '#61CE70' ),
        ),
        'custom_colors' => array(),
        'system_typography' => array(
            array(
                '_id'                    => 'primary',
                'title'                  => 'Primary',
                'typography_typography'  => 'custom',
                'typography_font_family' => 'Roboto',
                'typography_font_weight' => '600',
            ),
            array(
                '_id'                    => 'secondary',
                'title'                  => 'Secondary',
                'typography_typography'  => 'custom',
                'typography_font_family' => 'Roboto Slab',
                'typography_font_weight' => '400',
            ),
            array(
                '_id'                    => 'text',
                'title'                  => 'Text',
                'typography_typography'  => 'custom',
                'typography_font_family' => 'Roboto',
                'typography_font_weight' => '400',
            ),
            array(
                '_id'                    => 'accent',
                'title'                  => 'Accent',
                'typography_typography'  => 'custom',
                'typography_font_family' => 'Roboto',
                'typography_font_weight' => '500',
            ),
        ),
        'custom_typography'      => array(),
        'default_generic_fonts'  => 'Sans-serif',
        'paragraph_spacing'      => array( 'unit' => 'px', 'size' => 0, 'sizes' => array() ),
        'container_width'        => array( 'unit' => 'px', 'size' => 1400, 'sizes' => array() ),
        'container_padding'      => array(
            'unit'     => 'px',
            'top'      => '0',
            'right'    => '0',
            'bottom'   => '0',
            'left'     => '0',
            'isLinked' => true,
        ),
        'space_between_widgets' => array(
            'column'   => '0',
            'row'      => '0',
            'isLinked' => true,
            'unit'     => 'px',
            'size'     => 0,
        ),
        'page_title_selector' => 'h1.entry-title',
        'viewport_md'         => 768,
        'viewport_lg'         => 1025,
    ),

    /*
     * Audit v3 may export values only for these explicitly reviewed option
     * names. This list intentionally excludes credentials, IDs, logs,
     * onboarding/runtime state, payment settings and store identity data.
     * Exporting a value here does not automatically apply it to new sites;
     * values must still be reviewed and copied into plugin_option_defaults.
     */
    'reference_value_whitelist' => array(
        'classic-editor' => array(
            'classic-editor-replace',
            'classic-editor-allow-users',
        ),
        'elementor' => array(
            'elementor_css_print_method',
            'elementor_disable_color_schemes',
            'elementor_disable_typography_schemes',
            'elementor_unfiltered_files_upload',
            'elementor_beta',
            'elementor_enable_inspector',
            'elementor_font_display',
            'elementor_landing_pages_activation',
            'elementor_experiment-container',
            'elementor_experiment-e_swiper_latest',
            'elementor_experiment-e_optimized_markup',
            'elementor_experiment-additional_custom_breakpoints',
        ),
        'elementor-pro' => array(),
        'woocommerce' => array(
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
        'persian-woocommerce' => array(
            'persian_woocommerce_translates',
        ),
        'filterx' => array(
            'filterx_automatic_setup',
        ),
    ),

    // Filled only after the safe values exported by audit v3 are reviewed.
    'plugin_option_defaults' => array(),
);
