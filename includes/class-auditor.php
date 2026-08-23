<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Auditor {
    /**
     * Build a safe audit payload from the current site.
     *
     * Deliberately excludes arbitrary wp_options, passwords, API keys, users,
     * content, orders, media and snippet code.
     *
     * @return array
     */
    public function build_report() {
        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $plugins = get_plugins();
        $plugin_rows = array();

        foreach ( $plugins as $file => $data ) {
            $plugin_rows[] = array(
                'file'    => $file,
                'name'    => isset( $data['Name'] ) ? $data['Name'] : '',
                'version' => isset( $data['Version'] ) ? $data['Version'] : '',
                'active'  => is_plugin_active( $file ),
            );
        }

        usort(
            $plugin_rows,
            static function ( $a, $b ) {
                return strcasecmp( $a['name'], $b['name'] );
            }
        );

        $theme = wp_get_theme();

        return array(
            'audit_version' => 1,
            'generated_at'  => gmdate( 'c' ),
            'site'          => array(
                'wordpress_version' => get_bloginfo( 'version' ),
                'php_version'       => PHP_VERSION,
                'locale'            => get_locale(),
                'active_theme'      => array(
                    'name'    => $theme->get( 'Name' ),
                    'version' => $theme->get( 'Version' ),
                    'slug'    => $theme->get_stylesheet(),
                ),
            ),
            'plugins'       => $plugin_rows,
            'wordpress'     => $this->wordpress_options(),
            'elementor'     => $this->elementor_data(),
            'code_snippets' => $this->snippet_inventory(),
            'safety'        => array(
                'arbitrary_wp_options_exported' => false,
                'users_exported'                => false,
                'media_exported'                => false,
                'content_exported'              => false,
                'snippet_code_exported'         => false,
            ),
        );
    }

    /** @return array */
    private function wordpress_options() {
        $keys = array(
            'permalink_structure',
            'default_comment_status',
            'default_ping_status',
            'users_can_register',
            'show_on_front',
            'page_on_front',
            'page_for_posts',
            'timezone_string',
            'date_format',
            'time_format',
            'start_of_week',
            'thumbnail_size_w',
            'thumbnail_size_h',
            'medium_size_w',
            'medium_size_h',
            'large_size_w',
            'large_size_h',
        );

        $values = array();
        foreach ( $keys as $key ) {
            $values[ $key ] = get_option( $key );
        }

        return $values;
    }

    /** @return array */
    private function elementor_data() {
        $option_keys = array(
            'elementor_css_print_method',
            'elementor_disable_color_schemes',
            'elementor_disable_typography_schemes',
            'elementor_unfiltered_files_upload',
            'elementor_experiment-container',
            'elementor_experiment-e_swiper_latest',
            'elementor_experiment-e_optimized_markup',
            'elementor_experiment-additional_custom_breakpoints',
            'elementor_active_kit',
        );

        $options = array();
        foreach ( $option_keys as $key ) {
            $value = get_option( $key, '__mss_not_set__' );
            if ( '__mss_not_set__' !== $value ) {
                $options[ $key ] = $value;
            }
        }

        $kit_id       = absint( get_option( 'elementor_active_kit' ) );
        $kit_settings = array();

        if ( $kit_id > 0 ) {
            $raw = get_post_meta( $kit_id, '_elementor_page_settings', true );
            if ( is_array( $raw ) ) {
                $kit_settings = $raw;
            }
        }

        return array(
            'active_kit_id' => $kit_id,
            'options'       => $options,
            'kit_settings'  => $kit_settings,
        );
    }

    /** @return array */
    private function snippet_inventory() {
        global $wpdb;

        $table = $wpdb->prefix . 'snippets';
        $like  = $wpdb->esc_like( $table );
        $found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $like ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery

        if ( $found !== $table ) {
            return array();
        }

        // Intentionally do not export code. Snippets can contain site-specific values or secrets.
        $rows = $wpdb->get_results( "SELECT id, name, scope, active FROM {$table} ORDER BY name ASC", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery.DirectQuery

        return is_array( $rows ) ? $rows : array();
    }
}
