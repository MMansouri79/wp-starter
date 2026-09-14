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

    /**
     * Build a schema-v2 portable snapshot.
     *
     * $selection is intentionally explicit: source inventory describes the
     * reference site while targets describe what a generated starter should
     * actually install/recreate.
     */
    public function build_config( array $selection = array() ) {
        $theme          = wp_get_theme();
        $source_plugins = $this->plugin_inventory();
        $target_files   = isset( $selection['starter_plugins'] ) && is_array( $selection['starter_plugins'] )
            ? array_map( 'strval', $selection['starter_plugins'] )
            : $this->default_target_plugin_files( $source_plugins );
        $elementor_templates = $this->elementor_templates_adapter( $selection );
        $source            = array(
            'wordpress_version' => get_bloginfo( 'version' ),
            'php_version'       => PHP_VERSION,
            'locale'            => get_locale(),
            'theme'             => array(
                'slug'    => $theme->get_stylesheet(),
                'name'    => $theme->get( 'Name' ),
                'version' => $theme->get( 'Version' ),
            ),
            'plugins' => $source_plugins,
        );
        $site_domain = $this->source_site_domain();
        if ( '' !== $site_domain ) {
            $source['site_domain'] = $site_domain;
        }

        return array(
            'schema_version'   => 2,
            'exporter_version' => MMS_WP_STARTER_EXPORTER_VERSION,
            'generated_at'     => gmdate( 'c' ),
            'source'           => $source,
            'targets' => array(
                'plugins' => $this->selected_target_plugins( $source_plugins, $target_files ),
            ),
            'wordpress' => array(
                'options'                 => $this->read_options( $this->whitelists['wordpress_options'] ),
                'permalink_structure'     => (string) get_option( 'permalink_structure', '' ),
                'cleanup_default_content' => true,
                'reading'                 => $this->wordpress_reading_roles( $selection ),
                'pages'                   => $this->starter_pages(),
            ),
            'adapters' => array(
                'elementor' => array(
                    'options'      => array(),
                    'kit_settings' => $this->elementor_kit_settings(),
                    'policy'       => 'structural_layout_only',
                    'templates'    => $elementor_templates,
                ),
                'woocommerce' => array(
                    'options' => $this->read_options( $this->whitelists['woocommerce_options'] ),
                ),
                'persian_woocommerce' => array(
                    'options' => $this->read_options( $this->whitelists['persian_woocommerce_options'] ),
                ),
                'code_snippets' => $this->code_snippets_adapter( $selection ),
                'filterx' => array(
                    'status' => 'deferred_to_phase_2',
                    'reason' => 'FilterX can contain destination-specific object IDs. Raw settings are intentionally excluded until the remapping adapter is implemented.',
                ),
            ),
            'safety' => array(
                'users_exported'                              => false,
                'uploads_exported'                            => false,
                'arbitrary_options_exported'                  => false,
                'credentials_exported'                        => false,
                'raw_database_exported'                       => false,
                'site_specific_ids_intentionally_excluded'    => true,
                'source_inventory_is_target_packages'         => false,
                'elementor_site_identity_exported'            => false,
                'elementor_design_system_exported'            => false,
                'elementor_visual_styles_exported'            => false,
                'elementor_license_connection_exported'       => false,
                'elementor_theme_builder_conditions_exported' => false,
                'code_snippets_code_exported'                 => true,
                'code_snippets_code_requires_secret_review'   => true,
            ),
        );
    }

    public function build_manifest() {
        return array(
            'schema_version'   => 2,
            'exporter_version' => MMS_WP_STARTER_EXPORTER_VERSION,
            'generated_at'     => gmdate( 'c' ),
            'policy'           => 'explicit_allowlists_and_target_selection',
            'files'            => array( 'starter-config.json', 'export-manifest.json' ),
        );
    }

    public function plugin_inventory() {
        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $rows = array();
        foreach ( get_plugins() as $file => $data ) {
            if ( $this->is_infrastructure_plugin( $file ) ) {
                continue;
            }
            $rows[] = array(
                'file'    => (string) $file,
                'name'    => isset( $data['Name'] ) ? (string) $data['Name'] : '',
                'version' => isset( $data['Version'] ) ? (string) $data['Version'] : '',
                'active'  => is_plugin_active( $file ),
            );
        }
        usort(
            $rows,
            static function ( $a, $b ) {
                return strcasecmp( $a['name'], $b['name'] );
            }
        );
        return $rows;
    }

    public function snippet_selection_inventory() {
        $snippets = $this->get_code_snippets();
        if ( null === $snippets ) {
            return array();
        }

        $rows = array();
        foreach ( $snippets as $snippet ) {
            $fields = $this->snippet_fields( $snippet );
            if ( ! $fields || ! empty( $fields['trashed'] ) || empty( $fields['id'] ) || ! empty( $fields['condition_id'] ) || ( isset( $fields['scope'] ) && 'condition' === $fields['scope'] ) ) {
                continue;
            }
            $name = isset( $fields['name'] ) ? (string) $fields['name'] : '';
            $rows[] = array(
                'id'              => absint( $fields['id'] ),
                'name'            => $name,
                'scope'           => isset( $fields['scope'] ) ? (string) $fields['scope'] : 'global',
                'active'          => ! empty( $fields['active'] ),
                'sample'          => $this->is_sample_snippet_name( $name ),
                'default_selected'=> ! empty( $fields['active'] ) && ! $this->is_sample_snippet_name( $name ),
            );
        }
        usort(
            $rows,
            static function ( $a, $b ) {
                if ( $a['active'] !== $b['active'] ) {
                    return $a['active'] ? -1 : 1;
                }
                return strcasecmp( $a['name'], $b['name'] );
            }
        );
        return $rows;
    }

    public function elementor_template_inventory() {
        if ( ! post_type_exists( 'elementor_library' ) ) {
            return array();
        }

        $posts = get_posts(
            array(
                'post_type'      => 'elementor_library',
                'post_status'    => 'any',
                'posts_per_page' => -1,
                'orderby'        => 'title',
                'order'          => 'ASC',
                'no_found_rows'  => true,
            )
        );
        $rows = array();
        foreach ( $posts as $post ) {
            // Elementor normally stores the document as JSON in _elementor_data.
            // Keep an explicit post-content fallback for older/imported library
            // items whose document was saved there instead.
            $document = get_post_meta( $post->ID, '_elementor_data', true );
            if ( is_string( $document ) ) {
                $document = json_decode( trim( $document ), true );
            }
            if ( ! is_array( $document ) && is_string( $post->post_content ) && '' !== trim( $post->post_content ) ) {
                $document = json_decode( trim( $post->post_content ), true );
            }
            if ( ! is_array( $document ) ) {
                continue;
            }
            $type = get_post_meta( $post->ID, '_elementor_template_type', true );
            if ( '' === $type ) {
                $type = get_post_meta( $post->ID, 'elementor_library_type', true );
            }
            $type = sanitize_key( $type ? $type : 'generic' );
            $portable_id = 'elementor-' . substr( hash( 'sha256', $type . '|' . $post->post_name . '|' . $post->post_title ), 0, 16 );
            $rows[] = array(
                'source_id'   => absint( $post->ID ),
                'id'          => $portable_id,
                'name'        => (string) $post->post_title,
                'type'        => $type,
                'status'      => (string) $post->post_status,
                'modified'    => (string) $post->post_modified_gmt,
                'document'    => $document,
            );
        }
        return $rows;
    }

    public function default_reading_roles() {
        $front_slug = $this->page_slug_from_option( 'page_on_front' );
        $posts_slug = $this->page_slug_from_option( 'page_for_posts' );
        return array(
            'front_page_role' => in_array( $front_slug, array( 'home', 'about', 'contact', 'blog' ), true ) ? $front_slug : '',
            'posts_page_role' => in_array( $posts_slug, array( 'home', 'about', 'contact', 'blog' ), true ) ? $posts_slug : '',
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

    /** Return only the hostname from home_url(); never persist URL components. */
    private function source_site_domain() {
        $parsed = function_exists( 'wp_parse_url' ) ? wp_parse_url( home_url() ) : parse_url( home_url() );
        if ( ! is_array( $parsed ) || empty( $parsed['host'] ) ) {
            return '';
        }
        $host = strtolower( rtrim( (string) $parsed['host'], '.' ) );
        if ( strlen( $host ) > 1 && '[' === $host[0] && ']' === substr( $host, -1 ) ) {
            $host = substr( $host, 1, -1 );
        }
        return preg_match( '/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $host ) || filter_var( $host, FILTER_VALIDATE_IP ) ? $host : '';
    }

    private function elementor_templates_adapter( array $selection ) {
        $inventory = $this->elementor_template_inventory();
        $selected = isset( $selection['starter_elementor_templates'] ) && is_array( $selection['starter_elementor_templates'] )
            ? array_map( 'absint', $selection['starter_elementor_templates'] )
            : array();
        if ( empty( $selected ) || empty( $inventory ) ) {
            return array();
        }

        $by_source_id = array();
        foreach ( $inventory as $row ) {
            $by_source_id[ (string) $row['source_id'] ] = $row['id'];
        }

        $templates = array();
        foreach ( $inventory as $row ) {
            if ( ! in_array( $row['source_id'], $selected, true ) ) {
                continue;
            }
            $templates[] = array(
                'id'       => $row['id'],
                'name'     => $row['name'],
                'type'     => $row['type'],
                'document' => $this->portable_template_value( $row['document'], $by_source_id ),
            );
        }
        return $templates;
    }

    private function portable_template_value( $value, array $template_map, $key = '' ) {
        if ( is_array( $value ) ) {
            $result = array();
            foreach ( $value as $child_key => $child ) {
                if ( in_array( $child_key, array( 'template_id', 'templateId' ), true ) && ( is_scalar( $child ) || is_null( $child ) ) ) {
                    $source_id = (string) $child;
                    $portable_id = isset( $template_map[ $source_id ] ) ? $template_map[ $source_id ] : 'missing-' . substr( hash( 'sha256', $source_id ), 0, 16 );
                    $result[ $child_key ] = array( '$wpStarterRef' => 'template:' . $portable_id );
                } else {
                    $result[ $child_key ] = $this->portable_template_value( $child, $template_map, (string) $child_key );
                }
            }
            return $result;
        }
        if ( is_string( $value ) && preg_match( '#^globals/(colors|typography)\\?id=([A-Za-z0-9_-]+)$#', $value, $matches ) ) {
            return array( '$wpStarterRef' => 'elementor:' . ( 'colors' === $matches[1] ? 'color:' : 'typography:' ) . $matches[2] );
        }
        return $value;
    }

    private function starts_with_any( $value, array $prefixes ) {
        foreach ( $prefixes as $prefix ) {
            if ( 0 === strpos( $value, $prefix ) ) {
                return true;
            }
        }
        return false;
    }

    private function wordpress_reading_roles( array $selection ) {
        $defaults = $this->default_reading_roles();
        $allowed  = array( '', 'home', 'about', 'contact', 'blog' );
        $front    = isset( $selection['front_page_role'] ) ? sanitize_key( $selection['front_page_role'] ) : $defaults['front_page_role'];
        $posts    = isset( $selection['posts_page_role'] ) ? sanitize_key( $selection['posts_page_role'] ) : $defaults['posts_page_role'];
        return array(
            'front_page_role' => in_array( $front, $allowed, true ) ? $front : '',
            'posts_page_role' => in_array( $posts, $allowed, true ) ? $posts : '',
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
            $pages[] = array(
                'role'  => $slug,
                'title' => $page ? (string) $page->post_title : $fallback_title,
                'slug'  => $slug,
            );
        }
        return $pages;
    }

    private function code_snippets_adapter( array $selection ) {
        $adapter = array(
            'status'   => 'portable',
            'settings' => $this->code_snippets_settings(),
            'snippets' => array(),
            'excluded' => array( 'database_ids', 'condition_ids', 'cloud_ids', 'revision_history', 'runtime_errors', 'modified_timestamps', 'trashed_snippets', 'network_sharing_state' ),
            'warning'  => 'Snippet source code is exported verbatim. Review selected snippets for hardcoded API keys, tokens, passwords or other secrets.',
        );

        $snippets = $this->get_code_snippets();
        if ( null === $snippets ) {
            $adapter['status'] = 'unavailable';
            $adapter['reason'] = 'Code Snippets is not active or its public snippet API is unavailable.';
            return $adapter;
        }

        $selected_ids = null;
        if ( isset( $selection['starter_snippets'] ) && is_array( $selection['starter_snippets'] ) ) {
            $selected_ids = array_map( 'absint', $selection['starter_snippets'] );
        }
        $default_rows = $this->snippet_selection_inventory();
        $default_ids  = array_map(
            static function ( $row ) {
                return $row['id'];
            },
            array_filter(
                $default_rows,
                static function ( $row ) {
                    return ! empty( $row['default_selected'] );
                }
            )
        );
        $selected_ids = null === $selected_ids ? $default_ids : $selected_ids;

        $allowed = $this->whitelists['code_snippet_fields'];
        $skipped = array();
        foreach ( $snippets as $snippet ) {
            $fields = $this->snippet_fields( $snippet );
            if ( ! $fields || empty( $fields['id'] ) || ! in_array( absint( $fields['id'] ), $selected_ids, true ) ) {
                continue;
            }
            if ( ! empty( $fields['trashed'] ) ) {
                continue;
            }
            if ( ! empty( $fields['condition_id'] ) || ( isset( $fields['scope'] ) && 'condition' === $fields['scope'] ) ) {
                $skipped[] = array( 'name' => isset( $fields['name'] ) ? (string) $fields['name'] : '', 'reason' => 'Condition-backed snippets require object remapping and were not exported.' );
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
            $row['portable_key'] = hash( 'sha256', strtolower( trim( (string) $row['name'] ) ) . '|' . ( isset( $row['scope'] ) ? (string) $row['scope'] : 'global' ) );
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
        if ( substr( $scope, -4 ) === '-css' ) return 'css';
        if ( substr( $scope, -3 ) === '-js' ) return 'js';
        if ( substr( $scope, -7 ) === 'content' ) return 'html';
        return 'php';
    }

    private function is_sample_snippet_name( $name ) {
        $samples = array( 'make upload filenames lowercase', 'disable admin bar', 'allow smilies', 'current year' );
        return in_array( strtolower( trim( (string) $name ) ), $samples, true );
    }

    private function is_infrastructure_plugin( $file ) {
        $normalized = str_replace( '\\', '/', (string) $file );
        return 0 === strpos( $normalized, 'wp-starter-exporter/' ) || 0 === strpos( $normalized, 'site-starter/' ) || 0 === strpos( $normalized, 'wp-starter-bootstrap/' );
    }

    private function default_target_plugin_files( array $source_plugins ) {
        $files = array();
        foreach ( $source_plugins as $plugin ) {
            if ( ! empty( $plugin['active'] ) ) {
                $files[] = $plugin['file'];
            }
        }
        return $files;
    }

    private function selected_target_plugins( array $source_plugins, array $selected_files ) {
        $selected = array_fill_keys( array_map( 'strval', $selected_files ), true );
        $targets  = array();
        foreach ( $source_plugins as $plugin ) {
            if ( isset( $selected[ $plugin['file'] ] ) ) {
                $targets[] = array(
                    'file'    => $plugin['file'],
                    'name'    => $plugin['name'],
                    'version' => $plugin['version'],
                );
            }
        }
        return $targets;
    }
}
