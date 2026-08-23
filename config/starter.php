<?php
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

return array(
    'profiles' => array(
        'elementor' => array(
            'label'   => 'Elementor Website',
            'plugins' => array( 'elementor', 'acf', 'code-snippets' ),
            'pages'   => array(
                array( 'title' => 'Home', 'slug' => 'home' ),
                array( 'title' => 'About Us', 'slug' => 'about-us' ),
                array( 'title' => 'Contact Us', 'slug' => 'contact-us' ),
                array( 'title' => 'Blog', 'slug' => 'blog' ),
            ),
            'front_page_slug' => 'home',
            'posts_page_slug' => 'blog',
        ),
        'woocommerce' => array(
            'label'   => 'Elementor + WooCommerce',
            'plugins' => array( 'elementor', 'acf', 'code-snippets', 'woocommerce' ),
            'pages'   => array(
                array( 'title' => 'Home', 'slug' => 'home' ),
                array( 'title' => 'About Us', 'slug' => 'about-us' ),
                array( 'title' => 'Contact Us', 'slug' => 'contact-us' ),
                array( 'title' => 'Blog', 'slug' => 'blog' ),
            ),
            'front_page_slug' => 'home',
            'posts_page_slug' => 'blog',
        ),
    ),

    // WordPress.org plugins only in v0.1. Premium/private ZIP support comes later.
    'plugins' => array(
        'elementor' => array(
            'name' => 'Elementor Website Builder',
            'slug' => 'elementor',
            'file' => 'elementor/elementor.php',
            'source' => 'wordpress.org',
        ),
        'acf' => array(
            'name' => 'Advanced Custom Fields',
            'slug' => 'advanced-custom-fields',
            'file' => 'advanced-custom-fields/acf.php',
            'source' => 'wordpress.org',
        ),
        'code-snippets' => array(
            'name' => 'Code Snippets',
            'slug' => 'code-snippets',
            'file' => 'code-snippets/code-snippets.php',
            'source' => 'wordpress.org',
        ),
        'woocommerce' => array(
            'name' => 'WooCommerce',
            'slug' => 'woocommerce',
            'file' => 'woocommerce/woocommerce.php',
            'source' => 'wordpress.org',
        ),
    ),

    // Conservative defaults. We will replace/add values after auditing the reference site.
    'wordpress_options' => array(
        'default_comment_status' => 'closed',
        'default_ping_status'    => 'closed',
        'users_can_register'      => 0,
    ),

    'permalink_structure' => '/%postname%/',

    // These remain intentionally empty until we capture and review the reference site.
    'elementor_options'      => array(),
    'elementor_kit_settings' => array(),
    'plugin_option_defaults' => array(),
);
