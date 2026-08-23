<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Auditor {
    /**
     * Build a safe audit payload from the current site.
     *
     * Deliberately excludes arbitrary option values, passwords, API keys,
     * users, content bodies, orders, media and snippet code. Audit v3 may
     * export values only for the explicit reference-value whitelist.
     *
     * @return array
     */
    public function build_report() {
        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $plugins     = get_plugins();
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
            'audit_version' => 3,
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
                'theme_mod_keys' => $this->theme_mod_keys(),
            ),
            'plugins'                  => $plugin_rows,
            'wordpress'                => $this->wordpress_options(),
            'pages'                    => $this->page_inventory(),
            'elementor'                => $this->elementor_data(),
            'code_snippets'            => $this->snippet_inventory(),
            'plugin_option_candidates' => $this->plugin_option_candidates(),
            'reviewed_plugin_option_values' => $this->reviewed_plugin_option_values(),
            'safety'        => array(
                'arbitrary_wp_option_values_exported' => false,
                'candidate_option_values_exported'    => false,
                'reviewed_plugin_option_values_exported' => true,
                'users_exported'                      => false,
                'media_exported'                      => false,
                'content_bodies_exported'             => false,
                'snippet_code_exported'               => false,
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
    private function page_inventory() {
        $pages = get_posts(
            array(
                'post_type'      => 'page',
                'post_status'    => array( 'publish', 'draft', 'private', 'pending' ),
                'posts_per_page' => -1,
                'orderby'        => 'menu_order title',
                'order'          => 'ASC',
                'fields'         => 'ids',
                'no_found_rows'  => true,
            )
        );

        $rows = array();
        foreach ( $pages as $page_id ) {
            $rows[] = array(
                'title'    => get_the_title( $page_id ),
                'slug'     => get_post_field( 'post_name', $page_id ),
                'status'   => get_post_status( $page_id ),
                'template' => get_page_template_slug( $page_id ),
            );
        }

        return $rows;
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
                $kit_settings = $this->portable_elementor_kit_settings( $raw );
            }
        }

        return array(
            'active_kit_id' => $kit_id,
            'options'       => $options,
            'kit_settings'  => $kit_settings,
            'excluded_kit_keys' => array(
                'site_name',
                'site_description',
                'site_logo',
                'site_favicon',
                'woocommerce_*_page_id',
            ),
        );
    }

    /** @return array */
    private function portable_elementor_kit_settings( array $settings ) {
        $excluded_exact = array(
            'site_name',
            'site_description',
            'site_logo',
            'site_favicon',
        );

        foreach ( array_keys( $settings ) as $key ) {
            if ( in_array( $key, $excluded_exact, true ) || 0 === strpos( $key, 'woocommerce_' ) ) {
                unset( $settings[ $key ] );
            }
        }

        return $settings;
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

    /** @return array */
    private function plugin_option_candidates() {
        global $wpdb;

        $plugins = Config::get( 'plugins', array() );
        $result  = array();

        foreach ( $plugins as $plugin_id => $definition ) {
            $prefixes = isset( $definition['option_prefixes'] ) && is_array( $definition['option_prefixes'] )
                ? array_values( array_filter( $definition['option_prefixes'] ) )
                : array();

            if ( empty( $prefixes ) ) {
                continue;
            }

            $conditions = array();
            $args       = array();

            foreach ( $prefixes as $prefix ) {
                $conditions[] = 'option_name LIKE %s';
                $args[]       = $wpdb->esc_like( $prefix ) . '%';
            }

            $sql = "SELECT option_name, LENGTH(option_value) AS value_length, autoload
                    FROM {$wpdb->options}
                    WHERE " . implode( ' OR ', $conditions ) . '
                    ORDER BY option_name ASC
                    LIMIT 500'; // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared

            $prepared = $wpdb->prepare( $sql, $args ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
            $rows     = $wpdb->get_results( $prepared, ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared,WordPress.DB.DirectDatabaseQuery.DirectQuery

            $result[ $plugin_id ] = is_array( $rows ) ? $rows : array();
        }

        return $result;
    }


    /**
     * Export values only for option names that were explicitly reviewed and
     * whitelisted in config/starter.php. Missing options are reported without
     * inventing a value. This output is review material, not an automatic
     * import source.
     *
     * @return array
     */
    private function reviewed_plugin_option_values() {
        $whitelist = Config::get( 'reference_value_whitelist', array() );
        $result    = array();

        foreach ( $whitelist as $plugin_id => $option_names ) {
            $rows = array();

            foreach ( (array) $option_names as $option_name ) {
                $sentinel = new \stdClass();
                $value    = get_option( $option_name, $sentinel );

                if ( $value === $sentinel ) {
                    $rows[] = array(
                        'option_name' => $option_name,
                        'exists'      => false,
                    );
                    continue;
                }

                $rows[] = array(
                    'option_name' => $option_name,
                    'exists'      => true,
                    'value_type'  => gettype( $value ),
                    'value'       => $value,
                );
            }

            $result[ $plugin_id ] = $rows;
        }

        return $result;
    }

    /** @return string[] */
    private function theme_mod_keys() {
        $mods = get_theme_mods();
        return is_array( $mods ) ? array_values( array_keys( $mods ) ) : array();
    }
}
