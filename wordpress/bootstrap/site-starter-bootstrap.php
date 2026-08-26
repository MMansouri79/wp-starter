<?php
/**
 * Plugin Name: WP Starter Bootstrap
 * Description: Installs bundled local packages and applies a starter configuration after normal WordPress installation.
 * Version: 0.1.0-alpha.22
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class MMS_WP_Starter_Bootstrap {
    const STATE_OPTION    = 'mms_wp_starter_bootstrap_state';
    const COMPLETE_OPTION = 'mms_wp_starter_bootstrap_complete';
    const ERROR_OPTION    = 'mms_wp_starter_bootstrap_error';
    const REPORT_OPTION   = 'mms_wp_starter_bootstrap_report';
    const REVISION_OPTION = 'mms_wp_starter_bootstrap_revision';
    const CONFIG_REVISION = 5;

    public static function init() {
        add_action( 'admin_init', array( __CLASS__, 'maybe_run' ), 1 );
        add_action( 'admin_notices', array( __CLASS__, 'render_notice' ) );
    }

    public static function maybe_run() {
        if ( wp_installing() || ! is_admin() || ! current_user_can( 'manage_options' ) ) {
            return;
        }

        // Never advance provisioning from background admin requests. AJAX runners
        // (notably Action Scheduler) can overlap plugin activation and observe a
        // half-installed plugin database. Only a normal administrator page load
        // is allowed to advance the state machine.
        if ( ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() ) || ( function_exists( 'wp_doing_cron' ) && wp_doing_cron() ) || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
            return;
        }

        $completed = get_option( self::COMPLETE_OPTION );
        $revision  = absint( get_option( self::REVISION_OPTION, 0 ) );
        if ( $completed && $revision >= self::CONFIG_REVISION ) {
            return;
        }
        if ( $completed && $revision < self::CONFIG_REVISION ) {
            self::save_state( array( 'phase' => 'fonts' ) );
            delete_option( self::COMPLETE_OPTION );
        }

        $root = self::package_root();
        if ( is_wp_error( $root ) ) {
            self::fail( $root->get_error_message() );
            return;
        }
        $build = self::read_json( $root . '/starter-build.json' );
        if ( is_wp_error( $build ) ) {
            self::fail( $build->get_error_message() );
            return;
        }
        if ( 2 > absint( $build['schemaVersion'] ?? 0 ) ) {
            self::fail( 'This starter build uses an obsolete package layout.' );
            return;
        }

        $configuration_enabled = array_key_exists( 'configurationEnabled', $build ) ? ! empty( $build['configurationEnabled'] ) : file_exists( $root . '/starter-config.json' );
        $config = array();
        if ( $configuration_enabled ) {
            $config = self::read_json( $root . '/starter-config.json' );
            if ( is_wp_error( $config ) ) {
                self::fail( $config->get_error_message() );
                return;
            }
            $validation = self::validate_configuration_schema( $config );
            if ( is_wp_error( $validation ) ) {
                self::fail( $validation->get_error_message() );
                return;
            }
        }

        $state = self::get_state();
        $phase = isset( $state['phase'] ) ? (string) $state['phase'] : 'theme';

        if ( 'theme' === $phase ) {
            $result = self::install_theme( $build );
            if ( is_wp_error( $result ) ) { self::fail( $result->get_error_message() ); return; }
            self::save_state( array( 'phase' => 'install_plugins', 'plugin_index' => 0 ) );
            self::continue_setup();
        }

        if ( 'install_plugins' === $phase ) {
            $plugins = array_values( (array) ( $build['plugins'] ?? array() ) );
            $index   = absint( $state['plugin_index'] ?? 0 );
            if ( $index < count( $plugins ) ) {
                $result = self::install_plugin( $plugins[ $index ] );
                if ( is_wp_error( $result ) ) { self::fail( $result->get_error_message() ); return; }
                self::save_state( array( 'phase' => 'install_plugins', 'plugin_index' => $index + 1 ) );
                self::continue_setup();
            }
            self::save_state( array( 'phase' => 'activate_plugins', 'activation_queue' => self::ordered_activation_queue( $plugins ), 'activation_failures' => 0, 'elementor_prepared' => false ) );
            self::continue_setup();
        }

        if ( 'activate_plugins' === $phase ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
            $plugins = array_values( (array) ( $build['plugins'] ?? array() ) );
            $queue   = array_values( (array) ( $state['activation_queue'] ?? self::ordered_activation_queue( $plugins ) ) );
            $failed  = absint( $state['activation_failures'] ?? 0 );
            $elementor_prepared = ! empty( $state['elementor_prepared'] );

            // Elementor Pro and WooCommerce both update Kit settings during their
            // own activation/install flows. Make sure Elementor has a real active
            // Kit on a request where Elementor was loaded normally before either
            // of those plugins is activated.
            if ( ! $elementor_prepared && self::build_has_plugin( $plugins, 'elementor/elementor.php' ) && is_plugin_active( 'elementor/elementor.php' ) ) {
                $kit_result = self::ensure_elementor_kit( array() );
                if ( is_wp_error( $kit_result ) ) { self::fail( $kit_result->get_error_message() ); return; }
                self::save_state( array( 'phase' => 'activate_plugins', 'activation_queue' => $queue, 'activation_failures' => $failed, 'elementor_prepared' => true ) );
                self::continue_setup();
            }

            if ( empty( $queue ) ) {
                self::save_state( array( 'phase' => 'fonts' ) );
                self::continue_setup();
            }
            $plugin_index = absint( array_shift( $queue ) );
            $plugin       = $plugins[ $plugin_index ] ?? array();
            $result       = self::activate_plugin_component( $plugin );
            if ( is_wp_error( $result ) ) {
                $queue[] = $plugin_index;
                $failed++;
                if ( $failed >= max( 1, count( $queue ) ) ) { self::fail( 'Could not activate the remaining starter plugins. Last error: ' . $result->get_error_message() ); return; }
            } else {
                $failed = 0;
            }
            self::save_state( array( 'phase' => 'activate_plugins', 'activation_queue' => $queue, 'activation_failures' => $failed, 'elementor_prepared' => $elementor_prepared ) );
            self::continue_setup();
        }

        if ( 'fonts' === $phase ) {
            $result = self::install_font_system( isset( $build['fontSystem'] ) && is_array( $build['fontSystem'] ) ? $build['fontSystem'] : array() );
            if ( is_wp_error( $result ) ) { self::fail( $result->get_error_message() ); return; }
            self::save_state( array( 'phase' => 'languages', 'language_index' => 0 ) );
            self::continue_setup();
        }

        if ( 'languages' === $phase ) {
            $archives = array_values( (array) ( $build['languageArchives'] ?? array() ) );
            $index    = absint( $state['language_index'] ?? 0 );
            if ( $index < count( $archives ) ) {
                $result = self::install_language_archive( $archives[ $index ] );
                if ( is_wp_error( $result ) ) { self::fail( $result->get_error_message() ); return; }
                self::save_state( array( 'phase' => 'languages', 'language_index' => $index + 1 ) );
                self::continue_setup();
            }
            self::save_state( array( 'phase' => 'configure' ) );
            self::continue_setup();
        }

        if ( 'configure' === $phase ) {
            if ( $configuration_enabled ) {
                $result = self::apply_configuration( $config, $build );
                if ( is_wp_error( $result ) ) { self::fail( $result->get_error_message() ); return; }
            } else {
                update_option( self::REPORT_OPTION, array( 'verification' => array( 'checked' => 0, 'mismatches' => 0 ), 'woocommerce_duplicates_removed' => 0, 'configuration_skipped' => true ), false );
            }

            self::save_state( array( 'phase' => 'complete' ) );
            update_option( self::COMPLETE_OPTION, gmdate( 'c' ), false );
            update_option( self::REVISION_OPTION, self::CONFIG_REVISION, false );
            delete_option( self::ERROR_OPTION );
            self::cleanup_payload_and_self();
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

    private static function package_root() {
        $legacy = WP_CONTENT_DIR . '/starter-package';
        if ( is_file( $legacy . '/starter-build.json' ) ) {
            return $legacy;
        }
        $matches = glob( WP_CONTENT_DIR . '/.wp-starter-*', GLOB_ONLYDIR );
        if ( ! is_array( $matches ) ) {
            $matches = array();
        }
        $valid = array();
        foreach ( $matches as $candidate ) {
            if ( is_file( $candidate . '/starter-build.json' ) ) {
                $valid[] = $candidate;
            }
        }
        if ( 1 !== count( $valid ) ) {
            return new WP_Error( 'starter_package_root_missing', 'Could not uniquely locate the randomized WP Starter payload directory.' );
        }
        return $valid[0];
    }

    private static function bundled_package_path( array $artifact ) {
        $relative = isset( $artifact['zip'] ) ? ltrim( str_replace( '\\', '/', (string) $artifact['zip'] ), '/' ) : '';
        if ( '' === $relative ) {
            return new WP_Error( 'starter_package_path_missing', 'A bundled starter package path is missing from the build manifest.' );
        }

        $package_root = self::package_root();
        if ( is_wp_error( $package_root ) ) {
            return $package_root;
        }
        $root = realpath( $package_root );
        $path = realpath( $package_root . '/' . $relative );

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
        $theme_data = isset( $build['theme'] ) && is_array( $build['theme'] ) ? $build['theme'] : array();
        $slug       = isset( $theme_data['slug'] ) ? sanitize_key( $theme_data['slug'] ) : '';

        // Package-only profiles may deliberately use whichever theme ships with
        // the selected WordPress distribution.
        if ( '' === $slug ) {
            return true;
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

            // Some hosts briefly expose stale theme-directory caches on the
            // same request that wrote the files. Verify the actual style.css,
            // clear WordPress/stat caches, and retry before surfacing an error.
            $theme_dir = trailingslashit( get_theme_root() ) . $slug;
            for ( $attempt = 0; $attempt < 4; $attempt++ ) {
                clearstatcache( true, $theme_dir . '/style.css' );
                if ( function_exists( 'wp_clean_themes_cache' ) ) {
                    wp_clean_themes_cache( true );
                }

                $theme = wp_get_theme( $slug );
                if ( $theme->exists() || is_file( $theme_dir . '/style.css' ) ) {
                    break;
                }

                usleep( 150000 * ( $attempt + 1 ) );
            }

            if ( ! $theme->exists() && ! is_file( $theme_dir . '/style.css' ) ) {
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

        if ( function_exists( 'wp_clean_themes_cache' ) ) {
            wp_clean_themes_cache( true );
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

    private static function ordered_activation_queue( array $plugins ) {
        $priorities = array(
            'elementor/elementor.php'             => 10,
            'woocommerce/woocommerce.php'         => 20,
            'elementor-pro/elementor-pro.php'     => 30,
            'code-snippets/code-snippets.php'     => 40,
            'persian-woocommerce/woocommerce-persian.php' => 50,
        );
        $queue = array_keys( array_values( $plugins ) );
        usort( $queue, function ( $a, $b ) use ( $plugins, $priorities ) {
            $file_a = isset( $plugins[ $a ]['file'] ) ? (string) $plugins[ $a ]['file'] : '';
            $file_b = isset( $plugins[ $b ]['file'] ) ? (string) $plugins[ $b ]['file'] : '';
            $priority_a = $priorities[ $file_a ] ?? 100;
            $priority_b = $priorities[ $file_b ] ?? 100;
            return $priority_a === $priority_b ? $a <=> $b : $priority_a <=> $priority_b;
        } );
        return $queue;
    }

    private static function build_has_plugin( array $plugins, $file ) {
        foreach ( $plugins as $plugin ) {
            if ( is_array( $plugin ) && isset( $plugin['file'] ) && $file === (string) $plugin['file'] ) {
                return true;
            }
        }
        return false;
    }

    private static function begin_activation_maintenance() {
        $path = ABSPATH . '.maintenance';
        if ( file_exists( $path ) ) {
            return false;
        }
        $payload = '<?php $upgrading = ' . time() . "; // WP Starter plugin activation
";
        if ( false === @file_put_contents( $path, $payload, LOCK_EX ) ) {
            return new WP_Error( 'starter_maintenance_failed', 'Could not create a temporary maintenance lock while activating WooCommerce.' );
        }
        return true;
    }

    private static function end_activation_maintenance( $created ) {
        if ( true === $created ) {
            @unlink( ABSPATH . '.maintenance' );
        }
    }

    private static function ensure_woocommerce_ready() {
        global $wpdb;
        $required = array(
            $wpdb->prefix . 'woocommerce_attribute_taxonomies',
            $wpdb->prefix . 'woocommerce_sessions',
            $wpdb->prefix . 'wc_order_stats',
        );
        $missing = array();
        foreach ( $required as $table ) {
            $found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
            if ( $found !== $table ) {
                $missing[] = $table;
            }
        }
        if ( ! empty( $missing ) && class_exists( 'WC_Install' ) && is_callable( array( 'WC_Install', 'install' ) ) ) {
            WC_Install::install();
            $missing = array();
            foreach ( $required as $table ) {
                $found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
                if ( $found !== $table ) {
                    $missing[] = $table;
                }
            }
        }
        return empty( $missing ) ? true : new WP_Error( 'starter_woocommerce_not_ready', 'WooCommerce activation finished before required database tables were available: ' . implode( ', ', $missing ) );
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
            return 'woocommerce/woocommerce.php' === $file ? self::ensure_woocommerce_ready() : true;
        }

        // `silent=true` suppresses the plugin-specific activation hook. That is
        // unacceptable for installers such as WooCommerce because their schema,
        // roles and options are created by that hook. Keep a short maintenance
        // barrier around WooCommerce so concurrent cron/AJAX/frontend requests
        // cannot load it while its tables are still being created.
        $maintenance = 'woocommerce/woocommerce.php' === $file ? self::begin_activation_maintenance() : false;
        if ( is_wp_error( $maintenance ) ) {
            return $maintenance;
        }
        try {
            $activated = activate_plugin( $file, '', false, false );
            if ( is_wp_error( $activated ) ) {
                return $activated;
            }
            if ( 'woocommerce/woocommerce.php' === $file ) {
                return self::ensure_woocommerce_ready();
            }
            return true;
        } finally {
            self::end_activation_maintenance( $maintenance );
        }
    }

    private static function bundled_payload_file_path( $relative, $expected = '' ) {
        $relative = ltrim( str_replace( '\\', '/', (string) $relative ), '/' );
        if ( '' === $relative || false !== strpos( $relative, '../' ) || 0 === strpos( $relative, '/' ) ) {
            return new WP_Error( 'starter_payload_path_invalid', 'A bundled payload path is invalid.' );
        }
        $package_root = self::package_root();
        if ( is_wp_error( $package_root ) ) {
            return $package_root;
        }
        $root = realpath( $package_root );
        $path = realpath( $package_root . '/' . $relative );
        if ( false === $root || false === $path || 0 !== strpos( $path, $root . DIRECTORY_SEPARATOR ) || ! is_file( $path ) ) {
            return new WP_Error( 'starter_payload_file_missing', 'Bundled payload file is missing or outside the payload root: ' . $relative );
        }
        $expected = strtolower( (string) $expected );
        if ( '' !== $expected && hash_file( 'sha256', $path ) !== $expected ) {
            return new WP_Error( 'starter_payload_checksum_failed', 'Bundled payload checksum failed: ' . $relative );
        }
        return $path;
    }

    private static function install_font_system( array $font_system ) {
        if ( empty( $font_system ) || empty( $font_system['faces'] ) || ! is_array( $font_system['faces'] ) ) {
            return true;
        }

        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        if ( ! is_plugin_active( 'elementor/elementor.php' ) || ! is_plugin_active( 'elementor-pro/elementor-pro.php' ) ) {
            return new WP_Error( 'starter_font_elementor_pro_required', 'A font system was selected, but Elementor and Elementor Pro are not both active.' );
        }

        $uploads = wp_upload_dir();
        if ( ! empty( $uploads['error'] ) ) {
            return new WP_Error( 'starter_font_upload_dir_failed', 'WordPress uploads directory is unavailable: ' . $uploads['error'] );
        }
        $system_id = sanitize_title( isset( $font_system['id'] ) ? $font_system['id'] : 'starter-fonts' );
        $font_dir = trailingslashit( $uploads['basedir'] ) . 'elementor/custom-fonts/wp-starter-' . $system_id;
        $font_url = trailingslashit( $uploads['baseurl'] ) . 'elementor/custom-fonts/wp-starter-' . $system_id;
        if ( ! wp_mkdir_p( $font_dir ) ) {
            return new WP_Error( 'starter_font_directory_failed', 'Could not create the Elementor custom-font directory.' );
        }

        $groups = array();
        foreach ( $font_system['faces'] as $index => $face ) {
            if ( ! is_array( $face ) ) {
                continue;
            }
            $family = isset( $face['family'] ) ? sanitize_text_field( $face['family'] ) : '';
            $weight = isset( $face['weight'] ) ? absint( $face['weight'] ) : 400;
            $style  = isset( $face['style'] ) ? sanitize_key( $face['style'] ) : 'normal';
            $format = isset( $face['format'] ) ? sanitize_key( $face['format'] ) : '';
            if ( '' === $family || ! in_array( $weight, array( 100, 200, 300, 400, 500, 600, 700, 800, 900 ), true ) || ! in_array( $style, array( 'normal', 'italic', 'oblique' ), true ) || 'woff2' !== $format ) {
                return new WP_Error( 'starter_font_face_invalid', 'A font face in the build manifest is invalid.' );
            }
            $source = self::bundled_payload_file_path( isset( $face['file'] ) ? $face['file'] : '', isset( $face['sha256'] ) ? $face['sha256'] : '' );
            if ( is_wp_error( $source ) ) {
                return $source;
            }
            $filename = sanitize_file_name( basename( isset( $face['filename'] ) ? $face['filename'] : basename( $source ) ) );
            if ( '' === $filename ) {
                $filename = 'font-' . ( $index + 1 ) . '.' . $format;
            }
            $destination = trailingslashit( $font_dir ) . ( $index + 1 ) . '-' . $filename;
            if ( ! copy( $source, $destination ) ) {
                return new WP_Error( 'starter_font_copy_failed', 'Could not copy font file into WordPress uploads: ' . $filename );
            }
            if ( ! empty( $face['sha256'] ) && hash_file( 'sha256', $destination ) !== strtolower( (string) $face['sha256'] ) ) {
                @unlink( $destination );
                return new WP_Error( 'starter_font_copy_checksum_failed', 'Installed font checksum did not match: ' . $filename );
            }
            $url = trailingslashit( $font_url ) . rawurlencode( basename( $destination ) );
            $attachment_id = self::ensure_font_attachment( $destination, $url, $family, $weight, $style, $filename );
            if ( is_wp_error( $attachment_id ) ) {
                return $attachment_id;
            }
            $key = strtolower( $family ) . '|' . $weight . '|' . $style;
            if ( ! isset( $groups[ $family ] ) ) {
                $groups[ $family ] = array();
            }
            if ( ! isset( $groups[ $family ][ $key ] ) ) {
                $groups[ $family ][ $key ] = array(
                    'font_type'   => 'static',
                    'font_weight' => (string) $weight,
                    'font_style'  => $style,
                );
            }
            $groups[ $family ][ $key ][ $format ] = array(
                'id'  => absint( $attachment_id ),
                'url' => esc_url_raw( $url ),
            );
        }

        $installed = 0;
        foreach ( $groups as $family => $rows ) {
            $existing = get_posts(
                array(
                    'post_type'      => 'elementor_font',
                    'post_status'    => 'any',
                    'posts_per_page' => 1,
                    'title'          => $family,
                    'fields'         => 'ids',
                )
            );
            $post_id = ! empty( $existing ) ? absint( $existing[0] ) : 0;
            if ( $post_id <= 0 ) {
                $post_id = wp_insert_post(
                    array(
                        'post_type'   => 'elementor_font',
                        'post_status' => 'publish',
                        'post_title'  => $family,
                    ),
                    true
                );
                if ( is_wp_error( $post_id ) ) {
                    return $post_id;
                }
            } else {
                wp_update_post( array( 'ID' => $post_id, 'post_status' => 'publish', 'post_title' => $family ) );
            }

            wp_set_object_terms( $post_id, 'custom', 'elementor_font_type' );
            $font_rows = array_values( $rows );
            update_post_meta( $post_id, 'elementor_font_files', $font_rows );
            update_post_meta( $post_id, 'elementor_font_face', self::generate_elementor_font_face_css( $family, $font_rows ) );
            $installed++;
        }

        delete_option( 'elementor_fonts_manager_fonts' );
        delete_option( 'elementor_fonts_manager_font_types' );
        return $installed;
    }

    private static function ensure_font_attachment( $file_path, $url, $family, $weight, $style, $filename ) {
        $uploads = wp_upload_dir();
        if ( ! empty( $uploads['error'] ) ) {
            return new WP_Error( 'starter_font_attachment_upload_dir_failed', 'WordPress uploads directory is unavailable while registering a font attachment: ' . $uploads['error'] );
        }

        $base_dir = realpath( $uploads['basedir'] );
        $real_file = realpath( $file_path );
        if ( false === $base_dir || false === $real_file ) {
            return new WP_Error( 'starter_font_attachment_path_invalid', 'Could not resolve the installed font path inside WordPress uploads.' );
        }
        $base_normalized = rtrim( str_replace( '\\', '/', $base_dir ), '/' ) . '/';
        $file_normalized = str_replace( '\\', '/', $real_file );
        if ( 0 !== strpos( $file_normalized, $base_normalized ) ) {
            return new WP_Error( 'starter_font_attachment_path_invalid', 'Installed font file is outside the WordPress uploads directory.' );
        }

        $relative = ltrim( substr( $file_normalized, strlen( $base_normalized ) ), '/' );
        if ( '' === $relative ) {
            return new WP_Error( 'starter_font_attachment_path_empty', 'Could not determine the installed font path relative to WordPress uploads.' );
        }

        $existing = get_posts(
            array(
                'post_type'      => 'attachment',
                'post_status'    => 'inherit',
                'posts_per_page' => 1,
                'fields'         => 'ids',
                'meta_key'       => '_wp_attached_file',
                'meta_value'     => $relative,
            )
        );
        $attachment_id = ! empty( $existing ) ? absint( $existing[0] ) : 0;

        $title = trim( $family . ' ' . $weight . ( 'normal' !== $style ? ' ' . $style : '' ) );
        $attachment_data = array(
            'post_mime_type' => 'font/woff2',
            'post_title'     => sanitize_text_field( $title ),
            'post_status'    => 'inherit',
            'post_content'   => '',
            'post_excerpt'   => '',
        );

        if ( $attachment_id > 0 ) {
            $attachment_data['ID'] = $attachment_id;
            $updated = wp_update_post( $attachment_data, true );
            if ( is_wp_error( $updated ) ) {
                return $updated;
            }
        } else {
            $attachment_data['guid'] = esc_url_raw( $url );
            $attachment_id = wp_insert_attachment( $attachment_data, $real_file, 0, true );
            if ( is_wp_error( $attachment_id ) ) {
                return $attachment_id;
            }
        }

        update_attached_file( $attachment_id, $real_file );
        update_post_meta( $attachment_id, '_wp_attachment_wp_starter_font', array(
            'family'   => sanitize_text_field( $family ),
            'weight'   => absint( $weight ),
            'style'    => sanitize_key( $style ),
            'filename' => sanitize_file_name( $filename ),
        ) );

        return absint( $attachment_id );
    }

    private static function generate_elementor_font_face_css( $family, array $rows ) {
        $css = '';
        $family_css = str_replace( array( "\\", "'" ), array( "\\\\", "\\'" ), (string) $family );
        foreach ( $rows as $row ) {
            $sources = array();
            foreach ( array( 'woff2' => 'woff2' ) as $format => $css_format ) {
                if ( ! empty( $row[ $format ]['url'] ) ) {
                    $sources[] = "url('" . esc_url_raw( $row[ $format ]['url'] ) . "') format('" . $css_format . "')";
                }
            }
            if ( empty( $sources ) ) {
                continue;
            }
            $css .= "@font-face {\n";
            $css .= "\tfont-family: '" . $family_css . "';\n";
            $css .= "\tfont-style: " . sanitize_key( $row['font_style'] ) . ";\n";
            $css .= "\tfont-weight: " . absint( $row['font_weight'] ) . ";\n";
            $css .= "\tfont-display: auto;\n";
            $css .= "\tsrc: " . implode( ",\n\t\t", $sources ) . ";\n}\n";
        }
        return $css;
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

    private static function validate_configuration_schema( array $config ) {
        $schema = absint( isset( $config['schema_version'] ) ? $config['schema_version'] : 0 );
        if ( 1 === $schema ) {
            return true;
        }
        if ( 2 !== $schema ) {
            return new WP_Error( 'starter_config_schema_unsupported', 'Unsupported starter configuration schema.' );
        }

        $unknown = array_diff( array_keys( $config ), array( 'schema_version','exporter_version','generated_at','source','targets','wordpress','adapters','safety' ) );
        if ( ! empty( $unknown ) ) {
            return new WP_Error( 'starter_config_root_rejected', 'Snapshot contains unsupported top-level field(s): ' . implode( ', ', $unknown ) );
        }
        $wordpress_root = (array) ( $config['wordpress'] ?? array() );
        $unknown = array_diff( array_keys( $wordpress_root ), array( 'options','permalink_structure','cleanup_default_content','reading','pages' ) );
        if ( ! empty( $unknown ) ) {
            return new WP_Error( 'starter_config_wordpress_root_rejected', 'Snapshot contains unsupported WordPress fields.' );
        }
        $adapter_root = (array) ( $config['adapters'] ?? array() );
        $unknown = array_diff( array_keys( $adapter_root ), array( 'elementor','woocommerce','persian_woocommerce','code_snippets','filterx' ) );
        if ( ! empty( $unknown ) ) {
            return new WP_Error( 'starter_config_adapter_rejected', 'Snapshot contains unsupported adapter(s): ' . implode( ', ', $unknown ) );
        }

        $wordpress_allowed = array(
            'blog_public','default_comment_status','default_ping_status','users_can_register','default_role','posts_per_page','posts_per_rss','rss_use_excerpt','timezone_string','date_format','time_format','start_of_week','use_smilies','default_post_format','require_name_email','comment_registration','close_comments_for_old_posts','close_comments_days_old','thread_comments','thread_comments_depth','page_comments','comments_per_page','default_comments_page','comment_order','comments_notify','moderation_notify','comment_moderation','comment_previously_approved','comment_max_links','show_avatars','avatar_rating','avatar_default','thumbnail_size_w','thumbnail_size_h','thumbnail_crop','medium_size_w','medium_size_h','medium_large_size_w','medium_large_size_h','large_size_w','large_size_h',
        );
        $wordpress_options = (array) ( $config['wordpress']['options'] ?? array() );
        $unknown = array_diff( array_keys( $wordpress_options ), $wordpress_allowed );
        if ( ! empty( $unknown ) ) {
            return new WP_Error( 'starter_config_wordpress_option_rejected', 'Snapshot contains unsupported WordPress option(s): ' . implode( ', ', $unknown ) );
        }

        $reading = (array) ( $config['wordpress']['reading'] ?? array() );
        $roles = array( '', 'home', 'about', 'contact', 'blog' );
        foreach ( array( 'front_page_role', 'posts_page_role' ) as $key ) {
            if ( isset( $reading[ $key ] ) && ! in_array( (string) $reading[ $key ], $roles, true ) ) {
                return new WP_Error( 'starter_config_page_role_rejected', 'Snapshot contains an unsupported WordPress page role.' );
            }
        }

        $elementor = (array) ( $config['adapters']['elementor'] ?? array() );
        if ( ! empty( $elementor['options'] ) ) {
            return new WP_Error( 'starter_config_elementor_options_rejected', 'Schema-v2 snapshots may not apply standalone Elementor options.' );
        }
        $exact = array( 'container_width','container_padding','space_between_widgets','page_title_selector','stretched_section_container','default_page_template','active_breakpoints' );
        $prefixes = array( 'container_width_','container_padding_','space_between_widgets_','viewport_' );
        foreach ( array_keys( (array) ( $elementor['kit_settings'] ?? array() ) ) as $key ) {
            $ok = in_array( $key, $exact, true );
            foreach ( $prefixes as $prefix ) {
                if ( 0 === strpos( $key, $prefix ) ) {
                    $ok = true;
                    break;
                }
            }
            if ( ! $ok ) {
                return new WP_Error( 'starter_config_elementor_setting_rejected', 'Snapshot contains a non-structural Elementor setting: ' . sanitize_text_field( $key ) );
            }
        }

        $woo_allowed = array(
            'woocommerce_allowed_countries','woocommerce_all_except_countries','woocommerce_specific_allowed_countries','woocommerce_calc_taxes','woocommerce_cart_redirect_after_add','woocommerce_checkout_address_2_field','woocommerce_checkout_company_field','woocommerce_checkout_highlight_required_fields','woocommerce_checkout_phone_field','woocommerce_currency','woocommerce_currency_pos','woocommerce_default_customer_address','woocommerce_dimension_unit','woocommerce_downloads_add_hash_to_filename','woocommerce_downloads_count_partial','woocommerce_downloads_deliver_inline','woocommerce_downloads_grant_access_after_payment','woocommerce_downloads_redirect_fallback_allowed','woocommerce_downloads_require_login','woocommerce_enable_ajax_add_to_cart','woocommerce_enable_checkout_login_reminder','woocommerce_enable_coupons','woocommerce_enable_delayed_account_creation','woocommerce_enable_guest_checkout','woocommerce_enable_myaccount_registration','woocommerce_enable_review_rating','woocommerce_enable_reviews','woocommerce_enable_shipping_calc','woocommerce_enable_signup_and_login_from_checkout','woocommerce_file_download_method','woocommerce_hide_out_of_stock_items','woocommerce_hold_stock_minutes','woocommerce_manage_stock','woocommerce_notify_low_stock','woocommerce_notify_low_stock_amount','woocommerce_notify_no_stock','woocommerce_notify_no_stock_amount','woocommerce_price_decimal_sep','woocommerce_price_display_suffix','woocommerce_price_num_decimals','woocommerce_price_thousand_sep','woocommerce_prices_include_tax','woocommerce_registration_generate_password','woocommerce_registration_generate_username','woocommerce_review_rating_required','woocommerce_review_rating_verification_label','woocommerce_review_rating_verification_required','woocommerce_ship_to_countries','woocommerce_ship_to_destination','woocommerce_shipping_cost_requires_address','woocommerce_shipping_hide_rates_when_free','woocommerce_shipping_tax_class','woocommerce_single_image_width','woocommerce_tax_based_on','woocommerce_tax_classes','woocommerce_tax_display_cart','woocommerce_tax_display_shop','woocommerce_tax_round_at_subtotal','woocommerce_tax_total_display','woocommerce_thumbnail_image_width','woocommerce_weight_unit',
        );
        $unknown = array_diff( array_keys( (array) ( $config['adapters']['woocommerce']['options'] ?? array() ) ), $woo_allowed );
        if ( ! empty( $unknown ) ) {
            return new WP_Error( 'starter_config_woocommerce_option_rejected', 'Snapshot contains unsupported WooCommerce option(s): ' . implode( ', ', $unknown ) );
        }
        $unknown = array_diff( array_keys( (array) ( $config['adapters']['persian_woocommerce']['options'] ?? array() ) ), array( 'persian_woocommerce_translates' ) );
        if ( ! empty( $unknown ) ) {
            return new WP_Error( 'starter_config_persian_option_rejected', 'Snapshot contains unsupported Persian WooCommerce options.' );
        }

        $snippet_adapter = (array) ( $config['adapters']['code_snippets'] ?? array() );
        $allowed_snippet_sections = array(
            'general' => array( 'activate_by_default','enable_tags','enable_description','visual_editor_rows','list_order','disable_prism','hide_upgrade_menu','complete_uninstall','enable_flat_files','enable_admin_bar','admin_bar_snippet_limit' ),
            'editor'  => array( 'indent_with_tabs','tab_size','indent_unit','font_size','wrap_lines','code_folding','line_numbers','auto_close_brackets','highlight_selection_matches','highlight_active_line','keymap','theme' ),
        );
        foreach ( (array) ( $snippet_adapter['settings'] ?? array() ) as $section => $values ) {
            if ( ! isset( $allowed_snippet_sections[ $section ] ) || ! is_array( $values ) ) {
                return new WP_Error( 'starter_config_snippet_settings_rejected', 'Snapshot contains an unsupported Code Snippets settings section.' );
            }
            $unknown = array_diff( array_keys( $values ), $allowed_snippet_sections[ $section ] );
            if ( ! empty( $unknown ) ) {
                return new WP_Error( 'starter_config_snippet_settings_rejected', 'Snapshot contains unsupported Code Snippets settings.' );
            }
        }
        $snippet_fields = array( 'name','desc','code','tags','scope','priority','active','locked','portable_key','type' );
        foreach ( (array) ( $snippet_adapter['snippets'] ?? array() ) as $snippet ) {
            if ( ! is_array( $snippet ) || ! isset( $snippet['name'], $snippet['code'] ) ) {
                return new WP_Error( 'starter_config_snippet_invalid', 'Snapshot contains an invalid Code Snippets record.' );
            }
            $unknown = array_diff( array_keys( $snippet ), $snippet_fields );
            if ( ! empty( $unknown ) || ( isset( $snippet['scope'] ) && 'condition' === $snippet['scope'] ) ) {
                return new WP_Error( 'starter_config_snippet_rejected', 'Snapshot contains unsupported Code Snippets fields or condition-backed snippets.' );
            }
        }
        return true;
    }

    private static function starter_page_id_for_role( $role, array $wordpress ) {
        $role = sanitize_key( (string) $role );
        if ( '' === $role ) {
            return 0;
        }
        foreach ( (array) ( $wordpress['pages'] ?? array() ) as $page ) {
            if ( ! is_array( $page ) ) {
                continue;
            }
            $page_role = sanitize_key( isset( $page['role'] ) ? $page['role'] : ( $page['slug'] ?? '' ) );
            if ( $page_role !== $role ) {
                continue;
            }
            $slug = sanitize_title( isset( $page['slug'] ) ? $page['slug'] : $role );
            $found = $slug ? get_page_by_path( $slug, OBJECT, 'page' ) : null;
            return $found ? absint( $found->ID ) : 0;
        }
        // Schema-v1 compatibility. Only known starter roles can reach here.
        $found = get_page_by_path( $role, OBJECT, 'page' );
        return $found ? absint( $found->ID ) : 0;
    }

    private static function apply_wordpress_reading_roles( array $wordpress ) {
        $reading = isset( $wordpress['reading'] ) && is_array( $wordpress['reading'] ) ? $wordpress['reading'] : array();
        $front_role = isset( $reading['front_page_role'] ) ? sanitize_key( $reading['front_page_role'] ) : '';
        $posts_role = isset( $reading['posts_page_role'] ) ? sanitize_key( $reading['posts_page_role'] ) : '';

        if ( '' === $front_role && ! empty( $reading['front_page_slug'] ) && in_array( $reading['front_page_slug'], array( 'home', 'about', 'contact', 'blog' ), true ) ) {
            $front_role = sanitize_key( $reading['front_page_slug'] );
        }
        if ( '' === $posts_role && ! empty( $reading['posts_page_slug'] ) && in_array( $reading['posts_page_slug'], array( 'home', 'about', 'contact', 'blog' ), true ) ) {
            $posts_role = sanitize_key( $reading['posts_page_slug'] );
        }

        if ( '' === $front_role ) {
            update_option( 'show_on_front', 'posts' );
            update_option( 'page_on_front', 0 );
            update_option( 'page_for_posts', 0 );
            return;
        }

        $front_id = self::starter_page_id_for_role( $front_role, $wordpress );
        if ( $front_id <= 0 ) {
            return;
        }
        update_option( 'show_on_front', 'page' );
        update_option( 'page_on_front', $front_id );
        $posts_id = '' !== $posts_role ? self::starter_page_id_for_role( $posts_role, $wordpress ) : 0;
        update_option( 'page_for_posts', $posts_id );
    }

    private static function apply_code_snippets_adapter( array $adapter ) {
        $snippets = isset( $adapter['snippets'] ) && is_array( $adapter['snippets'] ) ? $adapter['snippets'] : array();
        $settings = isset( $adapter['settings'] ) && is_array( $adapter['settings'] ) ? $adapter['settings'] : array();
        if ( empty( $snippets ) && empty( $settings ) ) {
            return 0;
        }
        if ( ! function_exists( '\\Code_Snippets\\get_snippets' ) || ! function_exists( '\\Code_Snippets\\save_snippet' ) ) {
            return new WP_Error( 'starter_code_snippets_api_missing', 'Code Snippets is active but its public snippet API is unavailable.' );
        }

        if ( ! empty( $settings ) ) {
            $current = get_option( 'code_snippets_settings', array() );
            $current = is_array( $current ) ? $current : array();
            foreach ( $settings as $section => $values ) {
                if ( ! is_array( $values ) ) {
                    continue;
                }
                $current[ $section ] = array_merge( isset( $current[ $section ] ) && is_array( $current[ $section ] ) ? $current[ $section ] : array(), $values );
            }
            update_option( 'code_snippets_settings', $current );
        }

        $existing = \Code_Snippets\get_snippets();
        $saved_count = 0;
        foreach ( $snippets as $row ) {
            $name  = sanitize_text_field( isset( $row['name'] ) ? $row['name'] : '' );
            $scope = sanitize_key( isset( $row['scope'] ) ? $row['scope'] : 'global' );
            if ( '' === $name || 'condition' === $scope ) {
                continue;
            }
            $match_id = 0;
            foreach ( $existing as $candidate ) {
                if ( isset( $candidate->name, $candidate->scope ) && $candidate->name === $name && $candidate->scope === $scope ) {
                    $match_id = absint( $candidate->id );
                    break;
                }
            }
            $data = array(
                'id'       => $match_id,
                'name'     => $name,
                'desc'     => isset( $row['desc'] ) ? (string) $row['desc'] : '',
                'code'     => isset( $row['code'] ) ? (string) $row['code'] : '',
                'tags'     => isset( $row['tags'] ) ? $row['tags'] : array(),
                'scope'    => $scope,
                'priority' => isset( $row['priority'] ) ? absint( $row['priority'] ) : 10,
                'active'   => ! empty( $row['active'] ),
                'locked'   => ! empty( $row['locked'] ),
                'network'  => false,
            );
            $saved = \Code_Snippets\save_snippet( $data );
            if ( ! $saved || empty( $saved->id ) ) {
                return new WP_Error( 'starter_code_snippet_save_failed', 'Could not create/update Code Snippets entry: ' . $name );
            }
            $saved_count++;
            $existing = \Code_Snippets\get_snippets();
        }
        return $saved_count;
    }

    private static function apply_configuration( array $config, array $build ) {
        $report = array(
            'wordpress_options'  => 0,
            'elementor_options'  => 0,
            'woocommerce_options'=> 0,
            'persian_options'    => 0,
            'code_snippets_saved' => 0,
            'woocommerce_duplicates_removed' => 0,
            'elementor_kit_id'   => 0,
            'verified_at'        => gmdate( 'c' ),
        );

        if ( isset( $build['locale'] ) ) {
            $locale = sanitize_text_field( $build['locale'] );
            update_option( 'WPLANG', 'en_US' === $locale ? '' : $locale );
        }

        $wordpress = isset( $config['wordpress'] ) && is_array( $config['wordpress'] ) ? $config['wordpress'] : array();
        $wordpress_options = (array) ( $wordpress['options'] ?? array() );
        self::apply_option_group( $wordpress_options );
        $report['wordpress_options'] = count( $wordpress_options );

        if ( ! empty( $wordpress['permalink_structure'] ) ) {
            global $wp_rewrite;
            $wp_rewrite->set_permalink_structure( (string) $wordpress['permalink_structure'] );
        }

        // Only exporter-declared custom starter pages are created here.
        // WordPress and WooCommerce own their native/default pages.
        self::apply_pages( (array) ( $wordpress['pages'] ?? array() ) );
        self::apply_wordpress_reading_roles( $wordpress );

        if ( ! empty( $wordpress['cleanup_default_content'] ) ) {
            self::cleanup_default_content();
        }

        require_once ABSPATH . 'wp-admin/includes/plugin.php';

        if ( is_plugin_active( 'elementor/elementor.php' ) ) {
            $elementor_options = (array) ( $config['adapters']['elementor']['options'] ?? array() );
            self::apply_option_group( $elementor_options );
            $report['elementor_options'] = count( $elementor_options );
        }

        if ( is_plugin_active( 'woocommerce/woocommerce.php' ) ) {
            $woocommerce_options = (array) ( $config['adapters']['woocommerce']['options'] ?? array() );
            self::apply_option_group( $woocommerce_options );
            $report['woocommerce_options'] = count( $woocommerce_options );

            // Do not call WC_Install::create_pages(). WooCommerce already owns
            // page creation during its install/activation flow. Calling it again
            // can race the installer and produce Cart/Checkout/Shop duplicates.
            $report['woocommerce_duplicates_removed'] = self::cleanup_duplicate_woocommerce_pages();
        }

        if ( is_plugin_active( 'persian-woocommerce/woocommerce-persian.php' ) ) {
            $persian_options = (array) ( $config['adapters']['persian_woocommerce']['options'] ?? array() );
            self::apply_option_group( $persian_options );
            $report['persian_options'] = count( $persian_options );
        }

        $snippet_adapter = (array) ( $config['adapters']['code_snippets'] ?? array() );
        if ( ! empty( $snippet_adapter ) && ( is_plugin_active( 'code-snippets/code-snippets.php' ) || function_exists( '\\Code_Snippets\\save_snippet' ) ) ) {
            $snippet_result = self::apply_code_snippets_adapter( $snippet_adapter );
            if ( is_wp_error( $snippet_result ) ) {
                return $snippet_result;
            }
            $report['code_snippets_saved'] = absint( $snippet_result );
        }

        $kit_settings = (array) ( $config['adapters']['elementor']['kit_settings'] ?? array() );
        if ( is_plugin_active( 'elementor/elementor.php' ) ) {
            $kit_result = self::ensure_elementor_kit( $kit_settings );
            if ( is_wp_error( $kit_result ) ) {
                return $kit_result;
            }
            $report['elementor_kit_id'] = absint( $kit_result );
        }

        flush_rewrite_rules( false );

        $verification = self::verify_configuration( $config, $build );
        if ( is_wp_error( $verification ) ) {
            return $verification;
        }

        $report['verification'] = $verification;
        update_option( self::REPORT_OPTION, $report, false );

        return true;
    }

    private static function ensure_elementor_kit( array $kit_settings ) {
        if ( ! class_exists( '\\Elementor\\Plugin' ) ) {
            return new WP_Error( 'starter_elementor_not_loaded', 'Elementor is active but its runtime is not loaded, so the default kit could not be prepared.' );
        }

        $kit_id = absint( get_option( 'elementor_active_kit' ) );
        $kit_post = $kit_id > 0 ? get_post( $kit_id ) : null;

        if ( ! $kit_post || 'elementor_library' !== $kit_post->post_type || 'trash' === $kit_post->post_status ) {
            delete_option( 'elementor_active_kit' );
            $kit_id = 0;

            if ( class_exists( '\\Elementor\\Core\\Kits\\Manager' ) && method_exists( '\\Elementor\\Core\\Kits\\Manager', 'create_default_kit' ) ) {
                $created = \Elementor\Core\Kits\Manager::create_default_kit();
                if ( is_wp_error( $created ) ) {
                    return $created;
                }
                $kit_id = absint( get_option( 'elementor_active_kit' ) );
            }

            if ( $kit_id <= 0 && isset( \Elementor\Plugin::$instance->kits_manager ) && method_exists( \Elementor\Plugin::$instance->kits_manager, 'create_default' ) ) {
                $kit_id = absint( \Elementor\Plugin::$instance->kits_manager->create_default() );
                if ( $kit_id > 0 ) {
                    update_option( 'elementor_active_kit', $kit_id );
                }
            }
        }

        if ( $kit_id <= 0 || ! get_post( $kit_id ) ) {
            return new WP_Error( 'starter_elementor_kit_missing', 'Elementor did not provide a valid default kit after activation.' );
        }

        if ( ! empty( $kit_settings ) ) {
            $current = get_post_meta( $kit_id, '_elementor_page_settings', true );
            $current = is_array( $current ) ? $current : array();
            update_post_meta( $kit_id, '_elementor_page_settings', array_replace_recursive( $current, $kit_settings ) );
        }

        // Elementor caches generated kit/CSS files. Clear them after importing
        // the reference kit so the editor and frontend immediately see it.
        if ( isset( \Elementor\Plugin::$instance->files_manager ) && method_exists( \Elementor\Plugin::$instance->files_manager, 'clear_cache' ) ) {
            \Elementor\Plugin::$instance->files_manager->clear_cache();
        }

        return $kit_id;
    }

    private static function cleanup_duplicate_woocommerce_pages() {
        $definitions = array(
            'woocommerce_shop_page_id'      => array( 'slug' => 'shop',       'title' => 'Shop',       'markers' => array() ),
            'woocommerce_cart_page_id'      => array( 'slug' => 'cart',       'title' => 'Cart',       'markers' => array( 'woocommerce_cart', 'woocommerce/cart' ) ),
            'woocommerce_checkout_page_id'  => array( 'slug' => 'checkout',   'title' => 'Checkout',   'markers' => array( 'woocommerce_checkout', 'woocommerce/checkout' ) ),
            'woocommerce_myaccount_page_id' => array( 'slug' => 'my-account', 'title' => 'My account', 'markers' => array( 'woocommerce_my_account', 'woocommerce/my-account' ) ),
        );

        $removed = 0;

        foreach ( $definitions as $option => $definition ) {
            $keeper_id = absint( get_option( $option ) );
            if ( $keeper_id <= 0 ) {
                continue;
            }

            $keeper = get_post( $keeper_id );
            if ( ! $keeper || 'page' !== $keeper->post_type ) {
                continue;
            }

            $pages = get_posts(
                array(
                    'post_type'      => 'page',
                    'post_status'    => array( 'publish', 'draft', 'pending', 'private' ),
                    'posts_per_page' => -1,
                    'exclude'        => array( $keeper_id ),
                    'orderby'        => 'ID',
                    'order'          => 'ASC',
                )
            );

            foreach ( $pages as $page ) {
                $slug = (string) $page->post_name;
                if ( ! preg_match( '/^' . preg_quote( $definition['slug'], '/' ) . '(?:-\\d+)?$/', $slug ) ) {
                    continue;
                }

                $title = trim( wp_strip_all_tags( (string) $page->post_title ) );
                $keeper_title = trim( wp_strip_all_tags( (string) $keeper->post_title ) );
                if ( 0 !== strcasecmp( $title, $definition['title'] ) && 0 !== strcasecmp( $title, $keeper_title ) ) {
                    continue;
                }

                $content = trim( (string) $page->post_content );
                $safe_to_remove = '' === $content;
                foreach ( $definition['markers'] as $marker ) {
                    if ( false !== strpos( $content, $marker ) ) {
                        $safe_to_remove = true;
                        break;
                    }
                }

                if ( $safe_to_remove && wp_delete_post( $page->ID, true ) ) {
                    $removed++;
                }
            }
        }

        return $removed;
    }

    private static function verify_configuration( array $config, array $build ) {
        $mismatches = array();

        if ( isset( $build['locale'] ) ) {
            $expected_locale = sanitize_text_field( $build['locale'] );
            $stored_locale = (string) get_option( 'WPLANG', '' );
            $expected_stored = 'en_US' === $expected_locale ? '' : $expected_locale;
            if ( $stored_locale !== $expected_stored ) {
                $mismatches[] = 'WPLANG';
            }
        }

        $groups = array(
            (array) ( $config['wordpress']['options'] ?? array() ),
        );

        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        if ( is_plugin_active( 'elementor/elementor.php' ) ) {
            $groups[] = (array) ( $config['adapters']['elementor']['options'] ?? array() );
        }
        if ( is_plugin_active( 'woocommerce/woocommerce.php' ) ) {
            $groups[] = (array) ( $config['adapters']['woocommerce']['options'] ?? array() );
        }
        if ( is_plugin_active( 'persian-woocommerce/woocommerce-persian.php' ) ) {
            $groups[] = (array) ( $config['adapters']['persian_woocommerce']['options'] ?? array() );
        }

        $checked = 0;
        foreach ( $groups as $options ) {
            foreach ( $options as $key => $expected ) {
                $checked++;
                $sentinel = new stdClass();
                $actual = get_option( $key, $sentinel );
                if ( $sentinel === $actual || maybe_serialize( $actual ) !== maybe_serialize( $expected ) ) {
                    $mismatches[] = sanitize_key( $key );
                }
            }
        }

        $expected_permalink = (string) ( $config['wordpress']['permalink_structure'] ?? '' );
        if ( '' !== $expected_permalink ) {
            $checked++;
            if ( (string) get_option( 'permalink_structure', '' ) !== $expected_permalink ) {
                $mismatches[] = 'permalink_structure';
            }
        }

        if ( is_plugin_active( 'elementor/elementor.php' ) ) {
            $checked++;
            $kit_id = absint( get_option( 'elementor_active_kit' ) );
            if ( $kit_id <= 0 || ! get_post( $kit_id ) ) {
                $mismatches[] = 'elementor_active_kit';
            }
        }

        $wordpress = (array) ( $config['wordpress'] ?? array() );
        $reading = (array) ( $wordpress['reading'] ?? array() );
        $front_role = sanitize_key( $reading['front_page_role'] ?? '' );
        $posts_role = sanitize_key( $reading['posts_page_role'] ?? '' );
        if ( 2 === absint( $config['schema_version'] ?? 1 ) ) {
            $checked += 3;
            $expected_front = '' !== $front_role ? self::starter_page_id_for_role( $front_role, $wordpress ) : 0;
            $expected_posts = '' !== $posts_role ? self::starter_page_id_for_role( $posts_role, $wordpress ) : 0;
            $expected_show = $expected_front > 0 ? 'page' : 'posts';
            if ( (string) get_option( 'show_on_front', 'posts' ) !== $expected_show ) { $mismatches[] = 'show_on_front_role'; }
            if ( absint( get_option( 'page_on_front', 0 ) ) !== $expected_front ) { $mismatches[] = 'front_page_role'; }
            if ( absint( get_option( 'page_for_posts', 0 ) ) !== $expected_posts ) { $mismatches[] = 'posts_page_role'; }
        }

        $expected_snippets = (array) ( $config['adapters']['code_snippets']['snippets'] ?? array() );
        if ( ! empty( $expected_snippets ) && function_exists( '\\Code_Snippets\\get_snippets' ) ) {
            $actual_snippets = \Code_Snippets\get_snippets();
            foreach ( $expected_snippets as $expected_snippet ) {
                $checked++;
                $found = false;
                foreach ( $actual_snippets as $candidate ) {
                    if ( (string) $candidate->name === (string) ( $expected_snippet['name'] ?? '' ) && (string) $candidate->scope === (string) ( $expected_snippet['scope'] ?? 'global' ) ) {
                        $found = true;
                        if ( (string) $candidate->code !== (string) ( $expected_snippet['code'] ?? '' ) || (bool) $candidate->active !== ! empty( $expected_snippet['active'] ) ) {
                            $mismatches[] = 'code_snippet:' . sanitize_key( (string) ( $expected_snippet['name'] ?? 'snippet' ) );
                        }
                        break;
                    }
                }
                if ( ! $found ) {
                    $mismatches[] = 'code_snippet:' . sanitize_key( (string) ( $expected_snippet['name'] ?? 'snippet' ) );
                }
            }
        }

        if ( ! empty( $mismatches ) ) {
            return new WP_Error(
                'starter_configuration_verification_failed',
                'Starter configuration did not verify after import. Mismatched keys: ' . implode( ', ', array_unique( $mismatches ) )
            );
        }

        return array(
            'checked' => $checked,
            'mismatches' => 0,
        );
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

    private static function delete_tree( $path ) {
        if ( ! file_exists( $path ) && ! is_link( $path ) ) {
            return;
        }
        if ( is_link( $path ) || is_file( $path ) ) {
            @unlink( $path );
            return;
        }
        $items = scandir( $path );
        if ( is_array( $items ) ) {
            foreach ( $items as $item ) {
                if ( '.' === $item || '..' === $item ) {
                    continue;
                }
                self::delete_tree( $path . DIRECTORY_SEPARATOR . $item );
            }
        }
        @rmdir( $path );
    }

    private static function cleanup_payload_and_self() {
        $root = self::package_root();
        if ( ! is_wp_error( $root ) ) {
            $real = realpath( $root );
            $content = realpath( WP_CONTENT_DIR );
            $base = $real ? basename( $real ) : '';
            if ( $real && $content && 0 === strpos( $real, $content . DIRECTORY_SEPARATOR ) && ( 'starter-package' === $base || 0 === strpos( $base, '.wp-starter-' ) ) ) {
                self::delete_tree( $real );
            }
        }
        // This is a one-time installer. Remove only this MU-plugin file; never
        // touch the mu-plugins directory or other MU plugins.
        $self = realpath( __FILE__ );
        $mu_root = realpath( WPMU_PLUGIN_DIR );
        if ( $self && $mu_root && 0 === strpos( $self, $mu_root . DIRECTORY_SEPARATOR ) ) {
            @unlink( $self );
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
            $report = get_option( self::REPORT_OPTION, array() );
            if ( ! empty( $report['configuration_skipped'] ) ) {
                echo '<div class="notice notice-success is-dismissible"><p><strong>WP Starter:</strong> package installation completed. Configuration snapshot was intentionally skipped.</p></div>';
                return;
            }

            $verified = isset( $report['verification']['checked'] ) ? absint( $report['verification']['checked'] ) : 0;
            $duplicates = isset( $report['woocommerce_duplicates_removed'] ) ? absint( $report['woocommerce_duplicates_removed'] ) : 0;
            printf(
                '<div class="notice notice-success is-dismissible"><p><strong>WP Starter:</strong> starter provisioning completed and verified (%d settings/checks, %d duplicate WooCommerce pages removed).</p></div>',
                $verified,
                $duplicates
            );
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
