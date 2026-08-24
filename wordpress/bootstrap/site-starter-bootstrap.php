<?php
/**
 * Plugin Name: WP Starter Bootstrap
 * Description: Applies a bundled starter configuration after normal WordPress installation.
 * Version: 0.1.0-alpha.2
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class MMS_WP_Starter_Bootstrap {
    const STATE_OPTION    = 'mms_wp_starter_bootstrap_state';
    const COMPLETE_OPTION = 'mms_wp_starter_bootstrap_complete';
    const ERROR_OPTION    = 'mms_wp_starter_bootstrap_error';

    public static function init() {
        add_action( 'admin_init', array( __CLASS__, 'maybe_run' ), 1 );
        add_action( 'admin_notices', array( __CLASS__, 'render_notice' ) );
    }

    public static function maybe_run() {
        if ( wp_installing() || ! is_admin() || ! current_user_can( 'manage_options' ) ) {
            return;
        }

        if ( get_option( self::COMPLETE_OPTION ) ) {
            return;
        }

        $config = self::read_json( WP_CONTENT_DIR . '/starter-package/starter-config.json' );
        $build  = self::read_json( WP_CONTENT_DIR . '/starter-package/starter-build.json' );

        if ( is_wp_error( $config ) || is_wp_error( $build ) ) {
            self::fail( is_wp_error( $config ) ? $config->get_error_message() : $build->get_error_message() );
            return;
        }

        $state = get_option( self::STATE_OPTION, 'activate' );

        if ( 'activate' === $state ) {
            $result = self::activate_components( $build );
            if ( is_wp_error( $result ) ) {
                self::fail( $result->get_error_message() );
                return;
            }

            update_option( self::STATE_OPTION, 'configure', false );
            delete_option( self::ERROR_OPTION );
            wp_safe_redirect( admin_url() );
            exit;
        }

        if ( 'configure' === $state ) {
            $result = self::apply_configuration( $config, $build );
            if ( is_wp_error( $result ) ) {
                self::fail( $result->get_error_message() );
                return;
            }

            update_option( self::STATE_OPTION, 'complete', false );
            update_option( self::COMPLETE_OPTION, gmdate( 'c' ), false );
            delete_option( self::ERROR_OPTION );
        }
    }

    private static function activate_components( array $build ) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';

        if ( ! empty( $build['theme']['slug'] ) ) {
            $theme = wp_get_theme( $build['theme']['slug'] );
            if ( ! $theme->exists() ) {
                return new WP_Error( 'starter_theme_missing', 'Starter theme is missing: ' . $build['theme']['slug'] );
            }
            switch_theme( $build['theme']['slug'] );
        }

        foreach ( (array) ( $build['plugins'] ?? array() ) as $plugin ) {
            $file = isset( $plugin['file'] ) ? (string) $plugin['file'] : '';
            if ( '' === $file ) {
                continue;
            }

            $absolute = WP_PLUGIN_DIR . '/' . $file;
            if ( ! file_exists( $absolute ) ) {
                if ( ! empty( $plugin['required'] ) ) {
                    return new WP_Error( 'starter_plugin_missing', 'Required starter plugin is missing: ' . $file );
                }
                continue;
            }

            if ( ! is_plugin_active( $file ) ) {
                $activated = activate_plugin( $file, '', false, true );
                if ( is_wp_error( $activated ) ) {
                    return $activated;
                }
            }
        }

        return true;
    }

    private static function apply_configuration( array $config, array $build ) {
        if ( isset( $build['locale'] ) ) {
            $locale = sanitize_text_field( $build['locale'] );
            update_option( 'WPLANG', 'en_US' === $locale ? '' : $locale );
        }

        $wordpress = isset( $config['wordpress'] ) && is_array( $config['wordpress'] ) ? $config['wordpress'] : array();

        foreach ( (array) ( $wordpress['options'] ?? array() ) as $key => $value ) {
            update_option( sanitize_key( $key ), $value );
        }

        if ( ! empty( $wordpress['permalink_structure'] ) ) {
            global $wp_rewrite;
            $wp_rewrite->set_permalink_structure( (string) $wordpress['permalink_structure'] );
        }

        self::apply_pages( (array) ( $wordpress['pages'] ?? array() ) );

        if ( ! empty( $wordpress['cleanup_default_content'] ) ) {
            self::cleanup_default_content();
        }

        self::apply_option_group( (array) ( $config['adapters']['elementor']['options'] ?? array() ) );
        self::apply_option_group( (array) ( $config['adapters']['woocommerce']['options'] ?? array() ) );
        self::apply_option_group( (array) ( $config['adapters']['persian_woocommerce']['options'] ?? array() ) );

        if ( class_exists( 'WC_Install' ) && method_exists( 'WC_Install', 'create_pages' ) ) {
            WC_Install::create_pages();
        }

        $kit_settings = (array) ( $config['adapters']['elementor']['kit_settings'] ?? array() );
        if ( ! empty( $kit_settings ) ) {
            $kit_id = absint( get_option( 'elementor_active_kit' ) );
            if ( $kit_id > 0 ) {
                $current = get_post_meta( $kit_id, '_elementor_page_settings', true );
                $current = is_array( $current ) ? $current : array();
                update_post_meta( $kit_id, '_elementor_page_settings', array_replace_recursive( $current, $kit_settings ) );
            }
        }

        flush_rewrite_rules( false );

        return true;
    }

    private static function apply_option_group( array $options ) {
        foreach ( $options as $key => $value ) {
            update_option( sanitize_key( $key ), $value );
        }
    }

    private static function apply_pages( array $pages ) {
        foreach ( $pages as $page ) {
            $slug  = isset( $page['slug'] ) ? sanitize_title( $page['slug'] ) : '';
            $title = isset( $page['title'] ) ? sanitize_text_field( $page['title'] ) : '';

            if ( '' === $slug || '' === $title || get_page_by_path( $slug, OBJECT, 'page' ) ) {
                continue;
            }

            wp_insert_post(
                array(
                    'post_type'    => 'page',
                    'post_status'  => 'publish',
                    'post_title'   => $title,
                    'post_name'    => $slug,
                    'post_content' => '',
                )
            );
        }
    }

    private static function cleanup_default_content() {
        foreach ( array(
            array( 'post', 'hello-world' ),
            array( 'page', 'sample-page' ),
        ) as $target ) {
            $post = get_page_by_path( $target[1], OBJECT, $target[0] );
            if ( $post ) {
                wp_delete_post( $post->ID, true );
            }
        }
    }

    private static function read_json( $path ) {
        if ( ! file_exists( $path ) ) {
            return new WP_Error( 'starter_config_missing', 'Starter package file is missing: ' . $path );
        }

        $decoded = json_decode( (string) file_get_contents( $path ), true );
        if ( ! is_array( $decoded ) ) {
            return new WP_Error( 'starter_config_invalid', 'Starter package JSON is invalid: ' . basename( $path ) );
        }

        return $decoded;
    }

    private static function fail( $message ) {
        update_option( self::ERROR_OPTION, sanitize_text_field( $message ), false );
    }

    public static function render_notice() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }

        $error = get_option( self::ERROR_OPTION );
        if ( $error ) {
            printf(
                '<div class="notice notice-error"><p><strong>WP Starter Bootstrap:</strong> %s</p></div>',
                esc_html( $error )
            );
            return;
        }

        if ( get_option( self::COMPLETE_OPTION ) ) {
            echo '<div class="notice notice-success is-dismissible"><p><strong>WP Starter:</strong> starter provisioning completed.</p></div>';
            return;
        }

        echo '<div class="notice notice-info"><p><strong>WP Starter:</strong> starter provisioning is in progress.</p></div>';
    }
}

MMS_WP_Starter_Bootstrap::init();
