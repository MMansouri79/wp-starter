<?php
/**
 * Plugin Name: WP Starter Bootstrap
 * Description: Installs bundled local packages and applies a starter configuration after normal WordPress installation.
 * Version: 0.1.0-alpha.9
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

        if ( 2 > absint( $build['schemaVersion'] ?? 0 ) ) {
            self::fail( 'This starter build uses an obsolete package layout. Rebuild it with WP Starter Builder alpha.6 or newer.' );
            return;
        }

        $state = self::get_state();
        $phase = isset( $state['phase'] ) ? (string) $state['phase'] : 'theme';

        if ( 'theme' === $phase ) {
            $result = self::install_theme( $build );
            if ( is_wp_error( $result ) ) {
                self::fail( $result->get_error_message() );
                return;
            }

            self::save_state( array( 'phase' => 'install_plugins', 'plugin_index' => 0 ) );
            self::continue_setup();
        }

        if ( 'install_plugins' === $phase ) {
            $plugins = array_values( (array) ( $build['plugins'] ?? array() ) );
            $index   = absint( $state['plugin_index'] ?? 0 );

            if ( $index < count( $plugins ) ) {
                $result = self::install_plugin( $plugins[ $index ] );
                if ( is_wp_error( $result ) ) {
                    self::fail( $result->get_error_message() );
                    return;
                }

                self::save_state( array( 'phase' => 'install_plugins', 'plugin_index' => $index + 1 ) );
                self::continue_setup();
            }

            self::save_state(
                array(
                    'phase'               => 'activate_plugins',
                    'activation_queue'    => array_keys( $plugins ),
                    'activation_failures' => 0,
                )
            );
            self::continue_setup();
        }

        if ( 'activate_plugins' === $phase ) {
            $plugins = array_values( (array) ( $build['plugins'] ?? array() ) );
            $queue   = array_values( (array) ( $state['activation_queue'] ?? array_keys( $plugins ) ) );
            $failed  = absint( $state['activation_failures'] ?? 0 );

            if ( empty( $queue ) ) {
                self::save_state( array( 'phase' => 'languages', 'language_index' => 0 ) );
                self::continue_setup();
            }

            $plugin_index = absint( array_shift( $queue ) );
            $plugin       = $plugins[ $plugin_index ] ?? array();
            $result       = self::activate_plugin_component( $plugin );

            if ( is_wp_error( $result ) ) {
                $queue[] = $plugin_index;
                $failed++;

                if ( $failed >= count( $queue ) ) {
                    self::fail( 'Could not activate the remaining starter plugins. Last error: ' . $result->get_error_message() );
                    return;
                }
            } else {
                $failed = 0;
            }

            self::save_state(
                array(
                    'phase'               => 'activate_plugins',
                    'activation_queue'    => $queue,
                    'activation_failures' => $failed,
                )
            );
            self::continue_setup();
        }

        if ( 'languages' === $phase ) {
            $archives = array_values( (array) ( $build['languageArchives'] ?? array() ) );
            $index    = absint( $state['language_index'] ?? 0 );

            if ( $index < count( $archives ) ) {
                $result = self::install_language_archive( $archives[ $index ] );
                if ( is_wp_error( $result ) ) {
                    self::fail( $result->get_error_message() );
                    return;
                }

                self::save_state( array( 'phase' => 'languages', 'language_index' => $index + 1 ) );
                self::continue_setup();
            }

            self::save_state( array( 'phase' => 'configure' ) );
            self::continue_setup();
        }

        if ( 'configure' === $phase ) {
            $result = self::apply_configuration( $config, $build );
            if ( is_wp_error( $result ) ) {
                self::fail( $result->get_error_message() );
                return;
            }

            self::save_state( array( 'phase' => 'complete' ) );
            update_option( self::COMPLETE_OPTION, gmdate( 'c' ), false );
            delete_option( self::ERROR_OPTION );
        }
    }

    private static function get_state() {
        $state = get_option( self::STATE_OPTION, array( 'phase' => 'theme' ) );
        if ( ! is_array( $state ) ) {
            return array( 'phase' => 'theme' );
        }
        return $state;
    }

    private static function save_state( array $state ) {
        update_option( self::STATE_OPTION, $state, false );
        delete_option( self::ERROR_OPTION );
    }

    private static function continue_setup() {
        wp_safe_redirect( admin_url() );
        exit;
    }

    private static function prepare_filesystem() {
        require_once ABSPATH . 'wp-admin/includes/file.php';
        if ( ! WP_Filesystem() ) {
            return new WP_Error( 'starter_filesystem_unavailable', 'WordPress could not initialize direct filesystem access for the offline starter packages.' );
        }
        return true;
    }

    private static function bundled_package_path( array $artifact ) {
        $relative = isset( $artifact['zip'] ) ? ltrim( str_replace( '\\', '/', (string) $artifact['zip'] ), '/' ) : '';
        if ( '' === $relative ) {
            return new WP_Error( 'starter_package_path_missing', 'A bundled starter package path is missing from the build manifest.' );
        }

        $root = realpath( WP_CONTENT_DIR . '/starter-package' );
        $path = realpath( WP_CONTENT_DIR . '/starter-package/' . $relative );

        if ( false === $root || false === $path || 0 !== strpos( $path, $root . DIRECTORY_SEPARATOR ) ) {
            return new WP_Error( 'starter_package_path_invalid', 'Bundled starter package path is invalid: ' . $relative );
        }

        if ( ! is_file( $path ) ) {
            return new WP_Error( 'starter_package_missing', 'Bundled starter package is missing: ' . $relative );
        }

        $expected = isset( $artifact['sha256'] ) ? strtolower( (string) $artifact['sha256'] ) : '';
        if ( '' !== $expected && hash_file( 'sha256', $path ) !== $expected ) {
            return new WP_Error( 'starter_package_checksum_failed', 'Bundled starter package checksum failed: ' . $relative );
        }

        return $path;
    }


    private static function extract_local_zip( $package, $destination ) {
        if ( ! is_dir( $destination ) && ! wp_mkdir_p( $destination ) ) {
            return new WP_Error( 'starter_extract_destination_failed', 'Could not create starter package destination: ' . $destination );
        }

        // Prefer direct ZipArchive extraction for bundled local payloads. The
        // packages are generated by WP Starter Builder and checksum-verified
        // before this point. Bypassing WP_Filesystem here avoids hosting-panel
        // environments where unzip_file() can report success while the files
        // never appear in the real wp-content directory.
        if ( class_exists( 'ZipArchive' ) ) {
            $zip = new ZipArchive();
            $opened = $zip->open( $package, ZipArchive::CHECKCONS );

            if ( true === $opened ) {
                $base = wp_normalize_path( rtrim( $destination, '/\\' ) );

                for ( $i = 0; $i < $zip->numFiles; $i++ ) {
                    $raw_name = $zip->getNameIndex( $i );
                    if ( false === $raw_name ) {
                        $zip->close();
                        return new WP_Error( 'starter_archive_entry_invalid', 'Could not read a bundled starter archive entry.' );
                    }

                    $name = str_replace( '\\', '/', (string) $raw_name );
                    $name = preg_replace( '#^\./+#', '', $name );

                    if ( '' === $name || 0 === strpos( $name, '/' ) || preg_match( '#(^|/)\.\.(/|$)#', $name ) || preg_match( '#^[A-Za-z]:/#', $name ) ) {
                        $zip->close();
                        return new WP_Error( 'starter_archive_entry_unsafe', 'Unsafe path in bundled starter archive: ' . $raw_name );
                    }

                    $target = $base . '/' . $name;

                    if ( '/' === substr( $name, -1 ) ) {
                        if ( ! is_dir( $target ) && ! wp_mkdir_p( $target ) ) {
                            $zip->close();
                            return new WP_Error( 'starter_archive_mkdir_failed', 'Could not create directory while extracting bundled package: ' . $name );
                        }
                        continue;
                    }

                    $parent = dirname( $target );
                    if ( ! is_dir( $parent ) && ! wp_mkdir_p( $parent ) ) {
                        $zip->close();
                        return new WP_Error( 'starter_archive_mkdir_failed', 'Could not create directory while extracting bundled package: ' . $parent );
                    }

                    $input = $zip->getStream( $raw_name );
                    if ( false === $input ) {
                        $zip->close();
                        return new WP_Error( 'starter_archive_read_failed', 'Could not read bundled package entry: ' . $name );
                    }

                    $output = @fopen( $target, 'wb' );
                    if ( false === $output ) {
                        fclose( $input );
                        $zip->close();
                        return new WP_Error( 'starter_archive_write_failed', 'Could not write bundled package entry: ' . $target );
                    }

                    $copied = stream_copy_to_stream( $input, $output );
                    fclose( $input );
                    fclose( $output );

                    if ( false === $copied ) {
                        $zip->close();
                        return new WP_Error( 'starter_archive_copy_failed', 'Could not extract bundled package entry: ' . $name );
                    }

                    @chmod( $target, defined( 'FS_CHMOD_FILE' ) ? FS_CHMOD_FILE : 0644 );
                }

                $zip->close();
                return true;
            }
        }

        // Fallback for PHP builds without ZipArchive.
        $filesystem = self::prepare_filesystem();
        if ( is_wp_error( $filesystem ) ) {
            return $filesystem;
        }

        $result = unzip_file( $package, trailingslashit( $destination ) );
        return is_wp_error( $result ) ? $result : true;
    }

    private static function archive_entry_preview( $package, $limit = 8 ) {
        if ( ! class_exists( 'ZipArchive' ) ) {
            return '(ZipArchive unavailable)';
        }

        $zip = new ZipArchive();
        if ( true !== $zip->open( $package, ZipArchive::CHECKCONS ) ) {
            return '(archive could not be opened)';
        }

        $entries = array();
        $count = min( absint( $limit ), $zip->numFiles );
        for ( $i = 0; $i < $count; $i++ ) {
            $name = $zip->getNameIndex( $i );
            if ( false !== $name ) {
                $entries[] = str_replace( '\\', '/', (string) $name );
            }
        }
        $zip->close();

        return empty( $entries ) ? '(empty archive)' : implode( ', ', $entries );
    }

    private static function install_theme( array $build ) {
        $theme_data = (array) ( $build['theme'] ?? array() );
        $slug       = isset( $theme_data['slug'] ) ? sanitize_key( $theme_data['slug'] ) : '';
        if ( '' === $slug ) {
            return new WP_Error( 'starter_theme_invalid', 'Starter theme slug is missing.' );
        }

        $theme = wp_get_theme( $slug );
        if ( ! $theme->exists() ) {
            $package = self::bundled_package_path( $theme_data );
            if ( is_wp_error( $package ) ) {
                return $package;
            }

            $result = self::extract_local_zip( $package, get_theme_root() );
            if ( is_wp_error( $result ) ) {
                return $result;
            }

            $theme = wp_get_theme( $slug );
            if ( ! $theme->exists() ) {
                $found = array_keys( wp_get_themes() );
                return new WP_Error(
                    'starter_theme_install_failed',
                    'Theme archive extracted, but the expected theme was not found: ' . $slug .
                    '. Theme directories detected after extraction: ' . ( empty( $found ) ? '(none)' : implode( ', ', $found ) ) .
                    '. Archive entries: ' . self::archive_entry_preview( $package ) .
                    '. Destination: ' . get_theme_root()
                );
            }
        }

        switch_theme( $slug );
        return true;
    }

    private static function install_plugin( array $plugin ) {
        $file = isset( $plugin['file'] ) ? (string) $plugin['file'] : '';
        if ( '' === $file ) {
            return ! empty( $plugin['required'] ) ? new WP_Error( 'starter_plugin_invalid', 'A required starter plugin has no main plugin file.' ) : true;
        }

        if ( file_exists( WP_PLUGIN_DIR . '/' . $file ) ) {
            return true;
        }

        $package = self::bundled_package_path( $plugin );
        if ( is_wp_error( $package ) ) {
            return ! empty( $plugin['required'] ) ? $package : true;
        }

        $result = self::extract_local_zip( $package, WP_PLUGIN_DIR );
        if ( is_wp_error( $result ) ) {
            return $result;
        }

        if ( ! file_exists( WP_PLUGIN_DIR . '/' . $file ) ) {
            return new WP_Error( 'starter_plugin_install_failed', 'Plugin archive extracted, but the expected main file was not found: ' . $file . '. Archive entries: ' . self::archive_entry_preview( $package ) . '. Destination: ' . WP_PLUGIN_DIR );
        }

        return true;
    }

    private static function activate_plugin_component( array $plugin ) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';

        $file = isset( $plugin['file'] ) ? (string) $plugin['file'] : '';
        if ( '' === $file ) {
            return ! empty( $plugin['required'] ) ? new WP_Error( 'starter_plugin_invalid', 'A required starter plugin has no main plugin file.' ) : true;
        }

        if ( ! file_exists( WP_PLUGIN_DIR . '/' . $file ) ) {
            return ! empty( $plugin['required'] ) ? new WP_Error( 'starter_plugin_missing', 'Required starter plugin is missing: ' . $file ) : true;
        }

        if ( is_plugin_active( $file ) ) {
            return true;
        }

        $activated = activate_plugin( $file, '', false, true );
        return is_wp_error( $activated ) ? $activated : true;
    }

    private static function install_language_archive( array $archive ) {
        $package = self::bundled_package_path( $archive );
        if ( is_wp_error( $package ) ) {
            return $package;
        }

        $filesystem = self::prepare_filesystem();
        if ( is_wp_error( $filesystem ) ) {
            return $filesystem;
        }

        $result = unzip_file( $package, WP_CONTENT_DIR );
        return is_wp_error( $result ) ? $result : true;
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

        require_once ABSPATH . 'wp-admin/includes/plugin.php';

        if ( is_plugin_active( 'elementor/elementor.php' ) ) {
            self::apply_option_group( (array) ( $config['adapters']['elementor']['options'] ?? array() ) );
        }

        if ( is_plugin_active( 'woocommerce/woocommerce.php' ) ) {
            self::apply_option_group( (array) ( $config['adapters']['woocommerce']['options'] ?? array() ) );
        }

        if ( is_plugin_active( 'persian-woocommerce/woocommerce-persian.php' ) ) {
            self::apply_option_group( (array) ( $config['adapters']['persian_woocommerce']['options'] ?? array() ) );
        }

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

        $state = self::get_state();
        $phase = isset( $state['phase'] ) ? sanitize_text_field( $state['phase'] ) : 'starting';
        printf(
            '<div class="notice notice-info"><p><strong>WP Starter:</strong> offline provisioning is in progress (%s).</p></div>',
            esc_html( str_replace( '_', ' ', $phase ) )
        );
    }
}

MMS_WP_Starter_Bootstrap::init();
