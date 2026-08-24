<?php
namespace MMS\WPStarter\Exporter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Exporter {
    public function build_config() {
        $whitelists = require MMS_WP_STARTER_EXPORTER_DIR . 'config/whitelists.php';
        $theme      = wp_get_theme();

        return array(
            'schema_version'   => 1,
            'exporter_version' => MMS_WP_STARTER_EXPORTER_VERSION,
            'generated_at'     => gmdate( 'c' ),
            'source'           => array(
                'wordpress_version' => get_bloginfo( 'version' ),
                'php_version'       => PHP_VERSION,
                'locale'            => get_locale(),
                'theme'             => array(
                    'slug'    => $theme->get_stylesheet(),
                    'name'    => $theme->get( 'Name' ),
                    'version' => $theme->get( 'Version' ),
                ),
                'plugins' => $this->plugin_inventory(),
            ),
            'wordpress' => array(
                'options'                 => $this->read_options( $whitelists['wordpress_options'] ),
                'permalink_structure'     => (string) get_option( 'permalink_structure', '' ),
                'cleanup_default_content' => true,
                'pages'                   => array(
                    array( 'title' => 'Home', 'slug' => 'home' ),
                    array( 'title' => 'About', 'slug' => 'about' ),
                    array( 'title' => 'Contact', 'slug' => 'contact' ),
                    array( 'title' => 'Blog', 'slug' => 'blog' ),
                ),
            ),
            'adapters' => array(
                'elementor' => array(
                    'options'      => $this->read_options( $whitelists['elementor_options'] ),
                    'kit_settings' => $this->elementor_kit_settings(),
                ),
                'woocommerce' => array(
                    'options' => $this->read_options( $whitelists['woocommerce_options'] ),
                ),
                'persian_woocommerce' => array(
                    'options' => $this->read_options( $whitelists['persian_woocommerce_options'] ),
                ),
                'filterx' => array(
                    'status' => 'deferred_to_phase_2',
                    'reason' => 'Current FilterX configuration can contain destination-specific object IDs and is not exported raw.',
                ),
            ),
            'safety' => array(
                'users_exported'                  => false,
                'uploads_exported'                => false,
                'arbitrary_options_exported'      => false,
                'credentials_exported'            => false,
                'raw_database_exported'           => false,
                'site_specific_ids_intentionally_excluded' => true,
            ),
        );
    }

    public function build_manifest() {
        return array(
            'schema_version'   => 1,
            'exporter_version' => MMS_WP_STARTER_EXPORTER_VERSION,
            'generated_at'     => gmdate( 'c' ),
            'files'            => array(
                'starter-config.json',
                'export-manifest.json',
            ),
        );
    }

    private function read_options( array $keys ) {
        $result = array();

        foreach ( $keys as $key ) {
            $sentinel = new \stdClass();
            $value    = get_option( $key, $sentinel );

            if ( $value !== $sentinel ) {
                $result[ $key ] = $value;
            }
        }

        return $result;
    }

    private function elementor_kit_settings() {
        $kit_id = absint( get_option( 'elementor_active_kit' ) );
        if ( $kit_id <= 0 ) {
            return array();
        }

        $settings = get_post_meta( $kit_id, '_elementor_page_settings', true );
        if ( ! is_array( $settings ) ) {
            return array();
        }

        foreach ( array_keys( $settings ) as $key ) {
            if (
                in_array( $key, array( 'site_name', 'site_description', 'site_logo', 'site_favicon' ), true )
                || 0 === strpos( $key, 'woocommerce_' )
            ) {
                unset( $settings[ $key ] );
            }
        }

        return $settings;
    }

    private function plugin_inventory() {
        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $rows = array();
        foreach ( get_plugins() as $file => $data ) {
            $rows[] = array(
                'file'    => $file,
                'name'    => isset( $data['Name'] ) ? $data['Name'] : '',
                'version' => isset( $data['Version'] ) ? $data['Version'] : '',
                'active'  => is_plugin_active( $file ),
            );
        }

        return $rows;
    }
}
