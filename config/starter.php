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
     * Page names remain provisional until the v2 audit captures the page list.
     */
    'profiles' => array(
        'elementor' => array(
            'label'   => 'Elementor Website',
            'plugins' => array( 'classic-editor', 'elementor', 'elementor-pro' ),
            'pages'   => array(
                array( 'title' => 'Home', 'slug' => 'home' ),
                array( 'title' => 'About Us', 'slug' => 'about-us' ),
                array( 'title' => 'Contact Us', 'slug' => 'contact-us' ),
                array( 'title' => 'Blog', 'slug' => 'blog' ),
            ),
            // Reference site currently uses "Your latest posts". Do not assign
            // Home/Blog automatically until the page inventory is reviewed.
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
                array( 'title' => 'About Us', 'slug' => 'about-us' ),
                array( 'title' => 'Contact Us', 'slug' => 'contact-us' ),
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

    // Filled only after candidate option names from audit v2 are reviewed.
    'plugin_option_defaults' => array(),
);
