<?php
namespace MMS\WPStarter\Exporter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Exporter {
    private $whitelists;

    public function __construct() {
        $this->whitelists = require MMS_WP_STARTER_EXPORTER_DIR . 'config/whitelists.php';
    }

    public function build_config() {
        $theme = wp_get_theme();

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
                'options'                 => $this->read_options( $this->whitelists['wordpress_options'] ),
                'permalink_structure'     => (string) get_option( 'permalink_structure', '' ),
                'cleanup_default_content' => true,
                'reading'                 => $this->wordpress_reading_references(),
                'pages'                   => $this->starter_pages(),
            ),
            'adapters' => array(
                'elementor' => array(
                    'options'      => $this->read_options( $this->whitelists['elementor_options'] ),
                    'kit_settings' => $this->elementor_kit_settings(),
                    'policy'       => 'general_settings_only',
                ),
                'woocommerce' => array(
                    'options' => $this->read_options( $this->whitelists['woocommerce_options'] ),
                ),
                'persian_woocommerce' => array(
                    'options' => $this->read_options( $this->whitelists['persian_woocommerce_options'] ),
                ),
                'code_snippets' => $this->code_snippets_adapter(),
                'filterx' => array(
                    'status' => 'deferred_to_phase_2',
                    'reason' => 'Current FilterX configuration can contain destination-specific object IDs and is not exported raw.',
                ),
            ),
            'safety' => array(
                'users_exported'                            => false,
                'uploads_exported'                          => false,
                'arbitrary_options_exported'                => false,
                'credentials_exported'                      => false,
                'raw_database_exported'                     => false,
                'site_specific_ids_intentionally_excluded'  => true,
                'elementor_site_identity_exported'          => false,
                'elementor_license_connection_exported'     => false,
                'elementor_theme_builder_conditions_exported' => false,
                'code_snippets_code_exported'               => true,
                'code_snippets_code_requires_secret_review' => true,
            ),
        );
    }

    public function build_manifest() {
        return array(
            'schema_version'   => 1,
            'exporter_version' => MMS_WP_STARTER_EXPORTER_VERSION,
            'generated_at'     => gmdate( 'c' ),
            'policy'           => 'explicit_allowlists',
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

        $exact    = isset( $this->whitelists['elementor_kit_exact'] ) ? $this->whitelists['elementor_kit_exact'] : array();
        $prefixes = isset( $this->whitelists['elementor_kit_prefixes'] ) ? $this->whitelists['elementor_kit_prefixes'] : array();
        $portable = array();

        foreach ( $settings as $key => $value ) {
            if ( in_array( $key, $exact, true ) || $this->starts_with_any( $key, $prefixes ) ) {
                $portable[ $key ] = $value;
            }
        }

        return $portable;
    }

    private function starts_with_any( $value, array $prefixes ) {
        foreach ( $prefixes as $prefix ) {
            if ( 0 === strpos( $value, $prefix ) ) {
                return true;
            }
        }
        return false;
    }

    private function wordpress_reading_references() {
        return array(
            'front_page_slug' => $this->page_slug_from_option( 'page_on_front' ),
            'posts_page_slug' => $this->page_slug_from_option( 'page_for_posts' ),
        );
    }

    private function page_slug_from_option( $option_name ) {
        $page_id = absint( get_option( $option_name ) );
        if ( $page_id <= 0 ) {
            return '';
        }
        $page = get_post( $page_id );
        return $page && 'page' === $page->post_type ? (string) $page->post_name : '';
    }

    private function starter_pages() {
        $pages = array();
        foreach ( array( 'home' => 'Home', 'about' => 'About', 'contact' => 'Contact', 'blog' => 'Blog' ) as $slug => $fallback_title ) {
            $page = get_page_by_path( $slug, OBJECT, 'page' );
            if ( $page ) {
                $pages[] = array(
                    'title' => (string) $page->post_title,
                    'slug'  => (string) $page->post_name,
                );
            }
        }
        return $pages;
    }

    private function code_snippets_adapter() {
        $adapter = array(
            'status'   => 'portable',
            'settings' => $this->code_snippets_settings(),
            'snippets' => array(),
            'excluded' => array(
                'database_ids',
                'condition_ids',
                'cloud_ids',
                'revision_history',
                'runtime_errors',
                'modified_timestamps',
                'trashed_snippets',
                'network_sharing_state',
            ),
            'warning' => 'Snippet code is exported verbatim. Review snippets for hardcoded API keys, tokens, passwords or other secrets before using the snapshot elsewhere.',
        );

        $snippets = $this->get_code_snippets();
        if ( null === $snippets ) {
            $adapter['status'] = 'unavailable';
            $adapter['reason'] = 'Code Snippets is not active or its public snippet API is unavailable.';
            return $adapter;
        }

        $allowed = $this->whitelists['code_snippet_fields'];
        $skipped = array();

        foreach ( $snippets as $snippet ) {
            $fields = $this->snippet_fields( $snippet );
            if ( ! $fields ) {
                continue;
            }

            if ( ! empty( $fields['trashed'] ) ) {
                continue;
            }

            if ( ! empty( $fields['condition_id'] ) || ( isset( $fields['scope'] ) && 'condition' === $fields['scope'] ) ) {
                $skipped[] = array(
                    'name'   => isset( $fields['name'] ) ? (string) $fields['name'] : '',
                    'reason' => 'Condition-backed snippets require Phase 2 object remapping and were not exported.',
                );
                continue;
            }

            $row = array();
            foreach ( $allowed as $field ) {
                if ( array_key_exists( $field, $fields ) ) {
                    $row[ $field ] = $fields[ $field ];
                }
            }

            if ( ! isset( $row['name'] ) || ! isset( $row['code'] ) ) {
                continue;
            }

            if ( is_object( $snippet ) && isset( $snippet->type ) ) {
                $row['type'] = (string) $snippet->type;
            } elseif ( isset( $row['scope'] ) ) {
                $row['type'] = $this->snippet_type_from_scope( $row['scope'] );
            }

            $adapter['snippets'][] = $row;
        }

        if ( $skipped ) {
            $adapter['skipped_snippets'] = $skipped;
        }

        $adapter['snippet_count'] = count( $adapter['snippets'] );
        return $adapter;
    }

    private function code_snippets_settings() {
        $settings = get_option( 'code_snippets_settings', array() );
        if ( ! is_array( $settings ) ) {
            return array();
        }

        $result = array();
        foreach ( $this->whitelists['code_snippets_settings'] as $section => $keys ) {
            if ( empty( $settings[ $section ] ) || ! is_array( $settings[ $section ] ) ) {
                continue;
            }
            foreach ( $keys as $key ) {
                if ( array_key_exists( $key, $settings[ $section ] ) ) {
                    $result[ $section ][ $key ] = $settings[ $section ][ $key ];
                }
            }
        }
        return $result;
    }

    private function get_code_snippets() {
        if ( function_exists( '\\Code_Snippets\\get_snippets' ) ) {
            return \Code_Snippets\get_snippets();
        }
        if ( function_exists( 'get_snippets' ) ) {
            return \get_snippets();
        }
        return null;
    }

    private function snippet_fields( $snippet ) {
        if ( is_object( $snippet ) && method_exists( $snippet, 'get_fields' ) ) {
            $fields = $snippet->get_fields();
            return is_array( $fields ) ? $fields : array();
        }
        if ( is_object( $snippet ) ) {
            return get_object_vars( $snippet );
        }
        return is_array( $snippet ) ? $snippet : array();
    }

    private function snippet_type_from_scope( $scope ) {
        if ( substr( $scope, -4 ) === '-css' ) {
            return 'css';
        }
        if ( substr( $scope, -3 ) === '-js' ) {
            return 'js';
        }
        if ( substr( $scope, -7 ) === 'content' ) {
            return 'html';
        }
        return 'php';
    }

    private function plugin_inventory() {
        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $rows = array();
        foreach ( get_plugins() as $file => $data ) {
            if ( 0 === strpos( $file, 'wp-starter-exporter/' ) || 0 === strpos( $file, 'site-starter/' ) ) {
                continue;
            }
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
