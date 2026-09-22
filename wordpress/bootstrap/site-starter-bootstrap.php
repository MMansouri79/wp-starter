<?php
/**
 * Plugin Name: WP Starter Bootstrap
 * Description: Installs bundled local packages and applies a starter configuration after normal WordPress installation.
 * Version: 0.1.0-alpha.31
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
    const SETUP_PAGE_SLUG = 'wp-starter-setup';
    const CONFIG_REVISION = 12;
    const VNEXT_MANIFEST_FILENAME = 'starter-design-system.json';
    const ELEMENTOR_TEMPLATES_FILENAME = 'starter-elementor-templates.json';

    public static function init() {
        add_action( 'admin_init', array( __CLASS__, 'maybe_run' ), 1 );
        add_action( 'admin_menu', array( __CLASS__, 'register_setup_page' ) );
        add_action( 'admin_notices', array( __CLASS__, 'render_notice' ) );
    }

    public static function register_setup_page() {
        add_dashboard_page( 'WP Starter Setup', 'WP Starter Setup', 'manage_options', self::SETUP_PAGE_SLUG, array( __CLASS__, 'render_setup_page' ) );
    }

    private static function setup_url( $step = false ) {
        $url = admin_url( 'admin.php?page=' . self::SETUP_PAGE_SLUG );
        if ( $step ) $url = add_query_arg( array( 'wpstarter_step' => '1', '_wpnonce' => wp_create_nonce( 'wp_starter_setup_step' ) ), $url );
        return $url;
    }

    private static function is_setup_page() {
        return is_admin() && isset( $_GET['page'] ) && self::SETUP_PAGE_SLUG === sanitize_key( wp_unslash( $_GET['page'] ) );
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
            self::save_state( array( 'phase' => 'atomic_editor' ) );
            delete_option( self::COMPLETE_OPTION );
        }

        // Route the first authenticated dashboard request to a visible progress
        // screen. That screen advances one safe provisioning request at a time.
        if ( ! self::is_setup_page() ) {
            wp_safe_redirect( self::setup_url() );
            exit;
        }
        if ( empty( $_GET['wpstarter_step'] ) ) {
            return;
        }
        check_admin_referer( 'wp_starter_setup_step' );

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

        $vnext = array();
        if ( ! empty( $build['vnext'] ) ) {
            // The Builder writes starter-design-system.json and records its relative path in the build manifest.
            $vnext_relative_path = ! empty( $build['vnext']['path'] ) ? (string) $build['vnext']['path'] : self::VNEXT_MANIFEST_FILENAME;
            $vnext_path = $root . '/' . ltrim( $vnext_relative_path, '/\\' );
            $vnext = self::read_json( $vnext_path );
            if ( is_wp_error( $vnext ) ) {
                self::fail( $vnext->get_error_message() );
                return;
            }
            if ( ! empty( $build['vnext']['sha256'] ) && hash_file( 'sha256', $vnext_path ) !== (string) $build['vnext']['sha256'] ) {
                self::fail( 'The vNext design-system manifest checksum does not match the build manifest.' );
                return;
            }
        }

        $template_payload = array();
        if ( ! empty( $build['elementorTemplatePayload'] ) ) {
            $template_relative_path = ! empty( $build['elementorTemplatePayload']['path'] ) ? (string) $build['elementorTemplatePayload']['path'] : self::ELEMENTOR_TEMPLATES_FILENAME;
            $template_path = $root . '/' . ltrim( $template_relative_path, '/\\' );
            $template_payload = self::read_json( $template_path );
            if ( is_wp_error( $template_payload ) ) { self::fail( $template_payload->get_error_message() ); return; }
            if ( ! empty( $build['elementorTemplatePayload']['sha256'] ) && hash_file( 'sha256', $template_path ) !== (string) $build['elementorTemplatePayload']['sha256'] ) { self::fail( 'The Elementor template payload checksum does not match the build manifest.' ); return; }
        }

        $state = self::get_state();
        $phase = isset( $state['phase'] ) ? (string) $state['phase'] : 'theme';

        // A Builder update can re-run this one-time installer on a site that
        // already completed an older setup. Apply this targeted migration once
        // before the existing font/configuration revision migration continues.
        if ( 'atomic_editor' === $phase ) {
            $plugins = array_values( (array) ( $build['plugins'] ?? array() ) );
            if ( self::build_has_plugin( $plugins, 'elementor/elementor.php' ) ) {
                $atomic_result = self::disable_elementor_atomic_editor();
                if ( is_wp_error( $atomic_result ) ) { self::fail( $atomic_result->get_error_message() ); return; }
            }
            self::save_state( array( 'phase' => 'fonts' ) );
            self::continue_setup();
        }

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
            self::save_state( array( 'phase' => 'activate_plugins', 'activation_queue' => self::ordered_activation_queue( $plugins ), 'activation_failures' => 0, 'elementor_prepared' => false, 'atomic_editor_prepared' => false ) );
            self::continue_setup();
        }

        if ( 'activate_plugins' === $phase ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
            $plugins = array_values( (array) ( $build['plugins'] ?? array() ) );
            $queue   = array_values( (array) ( $state['activation_queue'] ?? self::ordered_activation_queue( $plugins ) ) );
            $failed  = absint( $state['activation_failures'] ?? 0 );
            $elementor_prepared = ! empty( $state['elementor_prepared'] );
            $atomic_editor_prepared = ! empty( $state['atomic_editor_prepared'] );

            // Atomic Editor is enabled by Elementor on fresh sites. Seed its
            // experiment option before Elementor's first activation, then leave
            // administrators free to turn it back on after setup completes.
            if ( ! $atomic_editor_prepared && self::build_has_plugin( $plugins, 'elementor/elementor.php' ) ) {
                $atomic_result = self::disable_elementor_atomic_editor();
                if ( is_wp_error( $atomic_result ) ) { self::fail( $atomic_result->get_error_message() ); return; }
                $atomic_editor_prepared = true;
                self::save_state( array( 'phase' => 'activate_plugins', 'activation_queue' => $queue, 'activation_failures' => $failed, 'elementor_prepared' => $elementor_prepared, 'atomic_editor_prepared' => true ) );
                self::continue_setup();
            }

            // Elementor Pro and WooCommerce both update Kit settings during their
            // own activation/install flows. Make sure Elementor has a real active
            // Kit on a request where Elementor was loaded normally before either
            // of those plugins is activated.
            if ( ! $elementor_prepared && self::build_has_plugin( $plugins, 'elementor/elementor.php' ) && is_plugin_active( 'elementor/elementor.php' ) ) {
                $kit_result = self::ensure_elementor_kit( array() );
                if ( is_wp_error( $kit_result ) ) { self::fail( $kit_result->get_error_message() ); return; }
                self::save_state( array( 'phase' => 'activate_plugins', 'activation_queue' => $queue, 'activation_failures' => $failed, 'elementor_prepared' => true, 'atomic_editor_prepared' => $atomic_editor_prepared ) );
                self::continue_setup();
            }

            if ( empty( $queue ) ) {
                // Recheck after every bundled plugin's activation hook has
                // completed, in case Elementor or a dependant changed the
                // experiment option while activating.
                if ( self::build_has_plugin( $plugins, 'elementor/elementor.php' ) ) {
                    $atomic_result = self::disable_elementor_atomic_editor();
                    if ( is_wp_error( $atomic_result ) ) { self::fail( $atomic_result->get_error_message() ); return; }
                }
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
            self::save_state( array( 'phase' => 'activate_plugins', 'activation_queue' => $queue, 'activation_failures' => $failed, 'elementor_prepared' => $elementor_prepared, 'atomic_editor_prepared' => $atomic_editor_prepared ) );
            self::continue_setup();
        }

        if ( 'fonts' === $phase ) {
            $font_profiles = isset( $build['fontSystems'] ) && is_array( $build['fontSystems'] ) ? $build['fontSystems'] : array();
            if ( empty( $font_profiles ) && isset( $build['fontSystem'] ) && is_array( $build['fontSystem'] ) ) { $font_profiles[] = $build['fontSystem']; }
            foreach ( $font_profiles as $font_profile ) {
                $result = self::install_font_system( is_array( $font_profile ) ? $font_profile : array() );
                if ( is_wp_error( $result ) ) { self::fail( $result->get_error_message() ); return; }
            }
            foreach ( (array) ( $build['designSystem']['fontProfiles'] ?? array() ) as $font_profile ) {
                $result = self::install_font_system( is_array( $font_profile ) ? $font_profile : array() );
                if ( is_wp_error( $result ) ) { self::fail( $result->get_error_message() ); return; }
            }
            self::save_state( array( 'phase' => empty( $vnext ) ? ( empty( $template_payload ) ? 'languages' : 'elementor_templates' ) : 'design_system', 'language_index' => 0 ) );
            self::continue_setup();
        }

        if ( 'design_system' === $phase ) {
            $result = self::apply_vnext_design_system( $vnext, $template_payload );
            if ( is_wp_error( $result ) ) { self::fail( $result->get_error_message() ); return; }
            self::save_state( array( 'phase' => empty( $template_payload ) ? 'languages' : 'elementor_templates', 'language_index' => 0 ) );
            self::continue_setup();
        }

        if ( 'elementor_templates' === $phase ) {
            $kit_id = self::ensure_elementor_kit( array() );
            if ( is_wp_error( $kit_id ) ) { self::fail( $kit_id->get_error_message() ); return; }
            $result = self::apply_elementor_templates_adapter( (array) ( $template_payload['templates'] ?? array() ), $kit_id, (array) ( $template_payload['mappings'] ?? array() ), $vnext );
            if ( is_wp_error( $result ) ) { self::fail( $result->get_error_message() ); return; }
            $report = (array) get_option( self::REPORT_OPTION, array() );
            $report['elementor_templates'] = absint( $result ); $report['elementor_template_payload'] = true;
            update_option( self::REPORT_OPTION, $report, false );
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
                update_option( self::REPORT_OPTION, array_merge( (array) get_option( self::REPORT_OPTION, array() ), array( 'verification' => array( 'checked' => 0, 'mismatches' => 0 ), 'woocommerce_duplicates_removed' => 0, 'configuration_skipped' => true ) ), false );
            }

            if ( ! empty( $build['sampleContentPayload'] ) ) {
                self::save_state( array( 'phase' => 'sample_content' ) );
                self::continue_setup();
            }
        }

        if ( 'sample_content' === $phase ) {
            $descriptor = $build['sampleContentPayload'] ?? array();
            if ( ( $descriptor['path'] ?? '' ) !== 'starter-sample-content.json' || ! preg_match( '/^[a-f0-9]{64}$/D', $descriptor['sha256'] ?? '' ) ) {
                self::fail( 'Sample payload descriptor is missing or invalid.' ); return;
            }
            $file = self::bundled_payload_file_path( 'starter-sample-content.json', $descriptor['sha256'] );
            if ( is_wp_error( $file ) ) { self::fail( $file->get_error_message() ); return; }
            $samples = self::read_json( $file );
            if ( is_wp_error( $samples ) ) { self::fail( $samples->get_error_message() ); return; }
            $installer_file = self::bundled_payload_file_path( 'sample-content-installer.php', $descriptor['installerSha256'] ?? '' );
            if ( is_wp_error( $installer_file ) ) { self::fail( $installer_file->get_error_message() ); return; }
            require_once $installer_file;
            $result = ( new MMS_WP_Starter_Sample_Content( $samples, $root ) )->step();
            if ( is_wp_error( $result ) ) { self::fail( $result->get_error_message() ); return; }
            if ( ! $result ) { self::save_state( array( 'phase' => 'sample_content' ) ); self::continue_setup(); }
            $report = (array) get_option( self::REPORT_OPTION, array() );
            $report['sample_content_verified'] = count( $samples['content'] );
            update_option( self::REPORT_OPTION, $report, false );
        }

        if ( 'configure' === $phase || 'sample_content' === $phase ) {
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
        wp_safe_redirect( self::setup_url() );
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

    private static function disable_elementor_atomic_editor() {
        $option = 'elementor_experiment-e_atomic_elements';
        if ( 'inactive' !== get_option( $option ) ) {
            update_option( $option, 'inactive', false );
        }
        if ( 'inactive' !== get_option( $option ) ) {
            return new WP_Error( 'starter_atomic_editor_disable_failed', 'Could not disable Elementor Atomic Editor before plugin activation.' );
        }
        return true;
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
        if ( ! empty( $elementor['templates'] ) && ! is_array( $elementor['templates'] ) ) {
            return new WP_Error( 'starter_config_elementor_templates_invalid', 'Elementor templates must be an array.' );
        }
        foreach ( (array) ( $elementor['templates'] ?? array() ) as $index => $template ) {
            if ( ! is_array( $template ) || empty( $template['id'] ) || empty( $template['name'] ) || ! isset( $template['document'] ) || ! is_array( $template['document'] ) ) {
                return new WP_Error( 'starter_config_elementor_template_invalid', 'Elementor template ' . absint( $index + 1 ) . ' is invalid.' );
            }
            $unknown = array_diff( array_keys( $template ), array( 'id', 'name', 'type', 'document' ) );
            if ( ! empty( $unknown ) ) {
                return new WP_Error( 'starter_config_elementor_template_rejected', 'Elementor template contains unsupported field(s): ' . implode( ', ', $unknown ) );
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
        $report = array_merge( (array) get_option( self::REPORT_OPTION, array() ), array(
            'wordpress_options'  => 0,
            'elementor_options'  => 0,
            'woocommerce_options'=> 0,
            'persian_options'    => 0,
            'code_snippets_saved' => 0,
            'woocommerce_duplicates_removed' => 0,
            'elementor_kit_id'   => 0,
            'verified_at'        => gmdate( 'c' ),
        ) );

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

        $elementor_templates = (array) ( $config['adapters']['elementor']['templates'] ?? array() );
        if ( ! empty( $elementor_templates ) && ! is_plugin_active( 'elementor/elementor.php' ) ) {
            return new WP_Error( 'starter_elementor_templates_required', 'Elementor must be active before portable Elementor templates can be imported.' );
        }

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
        if ( ! empty( $build['designSystem'] ) ) {
            unset( $kit_settings['system_colors'], $kit_settings['system_typography'] );
        }
        if ( is_plugin_active( 'elementor/elementor.php' ) ) {
            $kit_result = self::ensure_elementor_kit( $kit_settings );
            if ( is_wp_error( $kit_result ) ) {
                return $kit_result;
            }
            $report['elementor_kit_id'] = absint( $kit_result );
            $template_result = self::apply_elementor_templates_adapter( $elementor_templates, $kit_result );
            if ( is_wp_error( $template_result ) ) {
                return $template_result;
            }
            if ( ! empty( $elementor_templates ) || empty( $build['elementorTemplatePayload'] ) ) $report['elementor_templates'] = absint( $template_result );
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

    private static function apply_elementor_templates_adapter( array $templates, $kit_id, array $profile_mappings = array(), array $design_payload = array() ) {
        if ( empty( $templates ) ) {
            return 0;
        }
        if ( ! post_type_exists( 'elementor_library' ) ) {
            return new WP_Error( 'starter_elementor_templates_unavailable', 'Elementor template storage is unavailable.' );
        }

        $settings = get_post_meta( absint( $kit_id ), '_elementor_page_settings', true );
        $settings = is_array( $settings ) ? $settings : array();
        $logical  = array();
        $typography_alias_ids = array();
        foreach ( array( 'system_colors' => 'color', 'system_typography' => 'typography' ) as $setting_key => $prefix ) {
            foreach ( (array) ( $settings[ $setting_key ] ?? array() ) as $row ) {
                if ( is_array( $row ) && ! empty( $row['_id'] ) ) {
                    $logical[ 'elementor:' . $prefix . ':' . (string) $row['_id'] ] = (string) $row['_id'];
                    if ( ! empty( $row['title'] ) ) {
                        $logical[ 'elementor:' . $prefix . ':' . sanitize_key( (string) $row['title'] ) ] = (string) $row['_id'];
                        $logical[ $prefix . ':' . sanitize_key( (string) $row['title'] ) ] = (string) $row['_id'];
                        if ( 'typography' === $prefix && in_array( sanitize_key( (string) $row['title'] ), array( 'primary', 'secondary', 'text', 'accent' ), true ) ) $typography_alias_ids[ sanitize_key( (string) $row['title'] ) ] = (string) $row['_id'];
                    }
                }
            }
        }
        $design = (array) ( $design_payload['designSystem'] ?? array() );
        foreach ( array_keys( (array) ( $design['colors'] ?? array() ) ) as $role ) {
            $logical[ 'color:' . (string) $role ] = 'wpstarter_' . substr( hash( 'sha256', 'color:' . (string) $role ), 0, 12 );
            $logical[ 'elementor:color:' . (string) $role ] = $logical[ 'color:' . (string) $role ];
            $logical[ 'elementor:color:' . $logical[ 'color:' . (string) $role ] ] = $logical[ 'color:' . (string) $role ];
        }
        foreach ( array_keys( (array) ( $design['typography'] ?? array() ) ) as $role ) {
            $alias = self::elementor_design_typography_alias_for_role( (string) $role );
            if ( isset( $typography_alias_ids[ $alias ] ) ) {
                $logical[ 'typography:' . (string) $role ] = $typography_alias_ids[ $alias ];
                $logical[ 'elementor:typography:' . (string) $role ] = $typography_alias_ids[ $alias ];
                $logical[ 'elementor:typography:' . $typography_alias_ids[ $alias ] ] = $typography_alias_ids[ $alias ];
            }
        }
        foreach ( $profile_mappings as $source_reference => $target_reference ) {
            if ( isset( $logical[ $target_reference ] ) ) $logical[ (string) $source_reference ] = $logical[ $target_reference ];
            elseif ( preg_match( '/^elementor:(color|typography):([A-Za-z0-9_-]+)$/', (string) $target_reference, $matches ) ) $logical[ (string) $source_reference ] = (string) $matches[2];
        }

        $template_ids = array();
        foreach ( $templates as $template ) {
            if ( ! is_array( $template ) || empty( $template['id'] ) ) {
                return new WP_Error( 'starter_config_elementor_template_invalid', 'An Elementor template is missing its logical ID.' );
            }
            $portable_id = sanitize_key( (string) $template['id'] );
            $existing = get_posts(
                array(
                    'post_type'      => 'elementor_library',
                    'post_status'    => 'any',
                    'meta_key'       => '_wp_starter_template_id',
                    'meta_value'     => $portable_id,
                    'posts_per_page' => 1,
                )
            );
            $post_id = ! empty( $existing ) ? absint( $existing[0]->ID ) : 0;
            $post = array(
                'post_title'  => sanitize_text_field( (string) ( $template['name'] ?? $portable_id ) ),
                'post_type'   => 'elementor_library',
                'post_status' => 'publish',
            );
            if ( $post_id > 0 ) {
                $post['ID'] = $post_id;
            }
            $post_id = wp_insert_post( $post, true );
            if ( is_wp_error( $post_id ) ) {
                return $post_id;
            }
            $template_ids[ $portable_id ] = absint( $post_id );
            $logical[ 'template:' . $portable_id ] = absint( $post_id );
        }

        $saved = 0;
        foreach ( $templates as $template ) {
            $portable_id = sanitize_key( (string) $template['id'] );
            $missing = array();
            $document = self::remap_vnext_value( (array) $template['document'], $logical, $missing, 'template.' . $portable_id );
            if ( ! empty( $missing ) ) {
                return new WP_Error( 'starter_elementor_template_unresolved_reference', 'Elementor template ' . $portable_id . ' contains unresolved references: ' . implode( ', ', $missing ) );
            }
            $post_id = $template_ids[ $portable_id ];
            update_post_meta( $post_id, '_wp_starter_template_id', $portable_id );
            update_post_meta( $post_id, '_elementor_template_type', sanitize_key( (string) ( $template['type'] ?? 'generic' ) ) );
            update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );
            update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $document ) ) );
            $saved++;
        }

        if ( isset( \Elementor\Plugin::$instance->files_manager ) && method_exists( \Elementor\Plugin::$instance->files_manager, 'clear_cache' ) ) {
            \Elementor\Plugin::$instance->files_manager->clear_cache();
        }
        return $saved;
    }

    private static function apply_vnext_design_system( array $payload, array $template_payload = array() ) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
        if ( empty( $payload['designSystem'] ) || ! is_array( $payload['designSystem'] ) ) {
            return new WP_Error( 'starter_vnext_invalid_design_system', 'The vNext design-system manifest has no valid designSystem object.' );
        }
        if ( ! class_exists( '\\Elementor\\Plugin' ) || ! is_plugin_active( 'elementor/elementor.php' ) || ! is_plugin_active( 'elementor-pro/elementor-pro.php' ) ) {
            return new WP_Error( 'starter_vnext_elementor_required', 'A vNext design system requires Elementor and Elementor Pro to be active.' );
        }

        $system      = (array) $payload['designSystem'];
        $colors      = (array) ( $system['colors'] ?? array() );
        $color_names = (array) ( $system['colorNames'] ?? array() );
        $typography  = (array) ( $system['typography'] ?? array() );
        $typography_names = (array) ( $system['typographyNames'] ?? array() );
        $font_families = (array) ( $system['fontFamilies'] ?? array() );
        $kit_id      = self::ensure_elementor_kit( array() );
        if ( is_wp_error( $kit_id ) ) {
            return $kit_id;
        }

        $settings = get_post_meta( $kit_id, '_elementor_page_settings', true );
        $settings = is_array( $settings ) ? $settings : array();
        $logical  = array();
        $system_colors = array();
        $custom_colors = array();
        $system_color_roles = array( 'primary', 'secondary', 'text', 'accent' );
        $existing_custom_colors = (array) ( $settings['custom_colors'] ?? array() );
        foreach ( $existing_custom_colors as $existing_color ) {
            // Keep colors owned by the site, but replace colors previously
            // generated by WP Starter when this design system is updated.
            if ( is_array( $existing_color ) && ! empty( $existing_color['_id'] ) && 0 !== strpos( (string) $existing_color['_id'], 'wpstarter_' ) ) {
                $custom_colors[] = $existing_color;
            }
        }
        foreach ( $colors as $role => $value ) {
            $id = 'wpstarter_' . substr( hash( 'sha256', 'color:' . (string) $role ), 0, 12 );
            $color = sanitize_hex_color( (string) $value );
            if ( ! $color ) return new WP_Error( 'starter_vnext_invalid_color', 'Color token ' . sanitize_key( (string) $role ) . ' is not a valid hexadecimal color.' );
            $row = array( '_id' => $id, 'title' => sanitize_text_field( (string) ( $color_names[ $role ] ?? $role ) ), 'color' => $color );
            if ( in_array( (string) $role, $system_color_roles, true ) ) $system_colors[] = $row;
            else $custom_colors[] = $row;
            $logical[ 'color:' . (string) $role ] = $id;
            $logical[ 'elementor:color:' . (string) $role ] = $id;
            $logical[ 'elementor:color:' . $id ] = $id;
        }

        // Elementor's Global Fonts collection is separate from Theme Style
        // typography. Always emit all four system fonts so they remain visible
        // and editable even when no imported template references them.
        $system_typography = array();
        $fallback_typography = reset( $typography );
        $legacy_global_typography = array(
            'primary'   => isset( $typography['h1'] ) ? $typography['h1'] : ( $typography['body'] ?? $fallback_typography ),
            'secondary' => isset( $typography['h2'] ) ? $typography['h2'] : ( $typography['body'] ?? $fallback_typography ),
            'text'      => isset( $typography['body'] ) ? $typography['body'] : $fallback_typography,
            'accent'    => isset( $typography['links'] ) ? $typography['links'] : ( $typography['body'] ?? $fallback_typography ),
        );
        $global_typography_aliases = array_merge( $legacy_global_typography, (array) ( $system['globalTypography'] ?? array() ) );
        $global_typography_ids = array();
        foreach ( $global_typography_aliases as $alias => $alias_token ) {
            if ( ! in_array( $alias, array( 'primary', 'secondary', 'text', 'accent' ), true ) || ! is_array( $alias_token ) ) continue;
            $id = $alias;
            $font_role = isset( $alias_token['fontRole'] ) ? (string) $alias_token['fontRole'] : '';
            $family = isset( $font_families[ $font_role ] ) ? (string) $font_families[ $font_role ] : (string) ( $system['fontBindings'][ $font_role ] ?? '' );
            $row = array(
                '_id'          => $id,
                'title'        => ucfirst( $alias ),
                'typography_typography'  => 'custom',
                'typography_font_family' => sanitize_text_field( $family ),
                'typography_font_weight' => (string) absint( $alias_token['weight'] ?? 400 ),
                'typography_font_style'  => sanitize_key( (string) ( $alias_token['style'] ?? 'normal' ) ),
            );
            self::apply_elementor_responsive_dimension( $row, $alias_token, 'size', 'typography_font_size' );
            self::apply_elementor_responsive_dimension( $row, $alias_token, 'lineHeight', 'typography_line_height' );
            self::apply_elementor_responsive_dimension( $row, $alias_token, 'letterSpacing', 'typography_letter_spacing' );
            self::apply_elementor_responsive_dimension( $row, $alias_token, 'wordSpacing', 'typography_word_spacing' );
            if ( isset( $alias_token['textTransform'] ) ) $row['typography_text_transform'] = sanitize_key( (string) $alias_token['textTransform'] );
            if ( isset( $alias_token['textDecoration'] ) ) $row['typography_text_decoration'] = sanitize_key( (string) $alias_token['textDecoration'] );
            $system_typography[] = $row;
            $global_typography_ids[ $alias ] = $id;
            $logical[ 'typography:' . $alias ] = $id;
            $logical[ 'elementor:typography:' . $alias ] = $id;
            $logical[ 'elementor:typography:' . $id ] = $id;
        }
        $custom_typography = array();
        foreach ( (array) ( $settings['custom_typography'] ?? array() ) as $existing_font ) {
            if ( is_array( $existing_font ) && ! empty( $existing_font['_id'] ) && 0 !== strpos( (string) $existing_font['_id'], 'wpstarter_' ) ) $custom_typography[] = $existing_font;
        }
        foreach ( (array) ( $system['globalCustomTypography'] ?? array() ) as $custom_font ) {
            if ( ! is_array( $custom_font ) || empty( $custom_font['id'] ) || empty( $custom_font['token'] ) || ! is_array( $custom_font['token'] ) ) continue;
            $custom_reference_id = (string) $custom_font['id'];
            $custom_id = sanitize_key( $custom_reference_id );
            $token = $custom_font['token'];
            $id = 'wpstarter_' . substr( hash( 'sha256', 'typography:custom:' . $custom_id ), 0, 12 );
            $font_role = isset( $token['fontRole'] ) ? (string) $token['fontRole'] : '';
            $family = isset( $font_families[ $font_role ] ) ? (string) $font_families[ $font_role ] : (string) ( $system['fontBindings'][ $font_role ] ?? '' );
            $row = array( '_id' => $id, 'title' => sanitize_text_field( (string) ( $custom_font['name'] ?? $custom_id ) ), 'typography_typography' => 'custom', 'typography_font_family' => sanitize_text_field( $family ), 'typography_font_weight' => (string) absint( $token['weight'] ?? 400 ), 'typography_font_style' => sanitize_key( (string) ( $token['style'] ?? 'normal' ) ) );
            self::apply_elementor_responsive_dimension( $row, $token, 'size', 'typography_font_size' );
            self::apply_elementor_responsive_dimension( $row, $token, 'lineHeight', 'typography_line_height' );
            self::apply_elementor_responsive_dimension( $row, $token, 'letterSpacing', 'typography_letter_spacing' );
            self::apply_elementor_responsive_dimension( $row, $token, 'wordSpacing', 'typography_word_spacing' );
            if ( isset( $token['textTransform'] ) ) $row['typography_text_transform'] = sanitize_key( (string) $token['textTransform'] );
            if ( isset( $token['textDecoration'] ) ) $row['typography_text_decoration'] = sanitize_key( (string) $token['textDecoration'] );
            $custom_typography[] = $row;
            $logical[ 'typography:' . $custom_reference_id ] = $id;
            $logical[ 'elementor:typography:' . $custom_reference_id ] = $id;
            $logical[ 'elementor:typography:' . $id ] = $id;
        }

        $theme_typography_prefixes = array( 'body_typography', 'link_normal_typography', 'link_hover_typography', 'h1_typography', 'h2_typography', 'h3_typography', 'h4_typography', 'h5_typography', 'h6_typography', 'button_typography', 'form_label_typography', 'form_field_typography' );
        foreach ( $theme_typography_prefixes as $prefix ) {
            foreach ( array( 'typography', 'font_family', 'font_weight', 'font_style', 'font_size', 'font_size_tablet', 'font_size_mobile', 'line_height', 'line_height_tablet', 'line_height_mobile', 'letter_spacing', 'letter_spacing_tablet', 'letter_spacing_mobile', 'word_spacing', 'word_spacing_tablet', 'word_spacing_mobile', 'text_transform', 'text_decoration' ) as $suffix ) unset( $settings[ $prefix . '_' . $suffix ] );
        }
        $theme_role_prefixes = array(
            'body'       => array( 'body_typography' ),
            'links'      => array( 'link_normal_typography', 'link_hover_typography' ),
            'h1'         => array( 'h1_typography' ),
            'h2'         => array( 'h2_typography' ),
            'h3'         => array( 'h3_typography' ),
            'h4'         => array( 'h4_typography' ),
            'h5'         => array( 'h5_typography' ),
            'h6'         => array( 'h6_typography' ),
            'buttons'    => array( 'button_typography' ),
            'formFields' => array( 'form_label_typography', 'form_field_typography' ),
        );
        foreach ( $theme_role_prefixes as $role => $prefixes ) {
            if ( ! isset( $typography[ $role ] ) || ! is_array( $typography[ $role ] ) ) continue;
            $token = $typography[ $role ];
            $font_role = isset( $token['fontRole'] ) ? (string) $token['fontRole'] : '';
            $family = isset( $font_families[ $font_role ] ) ? (string) $font_families[ $font_role ] : (string) ( $system['fontBindings'][ $font_role ] ?? '' );
            foreach ( $prefixes as $prefix ) self::apply_elementor_theme_typography( $settings, $prefix, $token, $family );
            $alias = in_array( $role, array( 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ), true ) ? 'primary' : ( 'links' === $role ? 'accent' : 'text' );
            $target_id = $global_typography_ids[ $alias ] ?? '';
            if ( '' !== $target_id ) {
                $logical[ 'typography:' . (string) $role ] = $target_id;
                $logical[ 'elementor:typography:' . (string) $role ] = $target_id;
                $logical[ 'elementor:typography:' . $target_id ] = $target_id;
            }
        }

        foreach ( array_keys( $typography ) as $role ) {
            if ( isset( $logical[ 'typography:' . (string) $role ] ) ) continue;
            $target_id = $global_typography_ids['text'] ?? reset( $global_typography_ids );
            if ( '' !== (string) $target_id ) {
                $logical[ 'typography:' . (string) $role ] = (string) $target_id;
                $logical[ 'elementor:typography:' . (string) $role ] = (string) $target_id;
            }
        }

        $settings['system_colors']     = $system_colors;
        $settings['custom_colors']     = $custom_colors;
        $settings['system_typography'] = $system_typography;
        $settings['custom_typography'] = $custom_typography;
        if ( ! empty( $system['fallbackFontFamily'] ) ) $settings['default_generic_fonts'] = sanitize_text_field( (string) $system['fallbackFontFamily'] );
        update_post_meta( $kit_id, '_elementor_page_settings', $settings );

        $template_count = 0;
        foreach ( (array) ( $payload['templates'] ?? array() ) as $template ) {
            if ( ! is_array( $template ) || empty( $template['id'] ) ) {
                return new WP_Error( 'starter_vnext_invalid_template', 'A portable template is missing its id.' );
            }
            $missing = array();
            $document = self::remap_vnext_value( $template['document'] ?? array(), $logical, $missing, 'document' );
            if ( ! empty( $missing ) ) {
                return new WP_Error( 'starter_vnext_unresolved_reference', 'Portable template ' . sanitize_key( (string) $template['id'] ) . ' contains unresolved references: ' . implode( ', ', $missing ) );
            }
            $existing = get_posts( array( 'post_type' => 'elementor_library', 'post_status' => 'any', 'meta_key' => '_wp_starter_vnext_id', 'meta_value' => sanitize_key( (string) $template['id'] ), 'posts_per_page' => 1 ) );
            $post_id = ! empty( $existing ) ? absint( $existing[0]->ID ) : 0;
            $post = array( 'post_title' => sanitize_text_field( (string) ( $template['name'] ?? $template['id'] ) ), 'post_type' => 'elementor_library', 'post_status' => 'publish' );
            if ( $post_id > 0 ) $post['ID'] = $post_id;
            $post_id = wp_insert_post( $post, true );
            if ( is_wp_error( $post_id ) ) return $post_id;
            update_post_meta( $post_id, '_wp_starter_vnext_id', sanitize_key( (string) $template['id'] ) );
            update_post_meta( $post_id, '_elementor_template_type', sanitize_key( (string) ( $template['type'] ?? 'section' ) ) );
            update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $document ) ) );
            $template_count++;
        }

        if ( isset( \Elementor\Plugin::$instance->files_manager ) && method_exists( \Elementor\Plugin::$instance->files_manager, 'clear_cache' ) ) {
            \Elementor\Plugin::$instance->files_manager->clear_cache();
        }
        update_option( self::REPORT_OPTION, array( 'vnext_design_system' => sanitize_key( (string) ( $system['id'] ?? 'design-system' ) ), 'vnext_colors' => count( $system_colors ) + count( $custom_colors ), 'vnext_system_colors' => count( $system_colors ), 'vnext_custom_colors' => count( $custom_colors ), 'vnext_typography' => count( $typography ), 'vnext_global_typography_aliases' => count( $system_typography ), 'vnext_templates' => $template_count ), false );
        return true;
    }

    private static function elementor_design_typography_alias_for_role( $role ) {
        if ( in_array( (string) $role, array( 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ), true ) ) return 'primary';
        if ( 'links' === (string) $role ) return 'accent';
        return 'text';
    }

    private static function apply_elementor_theme_typography( array &$settings, $prefix, array $token, $family ) {
        // Elementor Theme Style stores these controls as body_typography_font_family,
        // link_normal_typography_font_family, h1_typography_font_family,
        // button_typography_font_family, and form_field_typography_font_family.
        $settings[ $prefix . '_typography' ]  = 'yes';
        $settings[ $prefix . '_font_family' ] = sanitize_text_field( (string) $family );
        $settings[ $prefix . '_font_weight' ] = (string) absint( $token['weight'] ?? 400 );
        $settings[ $prefix . '_font_style' ]  = sanitize_key( (string) ( $token['style'] ?? 'normal' ) );
        self::apply_elementor_responsive_dimension( $settings, $token, 'size', $prefix . '_font_size' );
        self::apply_elementor_responsive_dimension( $settings, $token, 'lineHeight', $prefix . '_line_height' );
        self::apply_elementor_responsive_dimension( $settings, $token, 'letterSpacing', $prefix . '_letter_spacing' );
        self::apply_elementor_responsive_dimension( $settings, $token, 'wordSpacing', $prefix . '_word_spacing' );
        if ( isset( $token['textTransform'] ) ) $settings[ $prefix . '_text_transform' ] = sanitize_key( (string) $token['textTransform'] );
        if ( isset( $token['textDecoration'] ) ) $settings[ $prefix . '_text_decoration' ] = sanitize_key( (string) $token['textDecoration'] );
    }

    private static function elementor_theme_typography_matches( array $settings, $prefix, array $token, $family ) {
        if ( 'yes' !== (string) ( $settings[ $prefix . '_typography' ] ?? '' ) ) return false;
        if ( (string) ( $settings[ $prefix . '_font_family' ] ?? '' ) !== (string) $family ) return false;
        if ( absint( $settings[ $prefix . '_font_weight' ] ?? 0 ) !== absint( $token['weight'] ?? 0 ) ) return false;
        if ( sanitize_key( (string) ( $settings[ $prefix . '_font_style' ] ?? '' ) ) !== sanitize_key( (string) ( $token['style'] ?? 'normal' ) ) ) return false;
        foreach ( array( 'size' => 'font_size', 'lineHeight' => 'line_height', 'letterSpacing' => 'letter_spacing', 'wordSpacing' => 'word_spacing' ) as $source_key => $target_key ) {
            foreach ( array( 'desktop' => '', 'tablet' => '_tablet', 'mobile' => '_mobile' ) as $breakpoint => $suffix ) {
                $dimension = $token[ $source_key ][ $breakpoint ] ?? null;
                if ( ! is_array( $dimension ) || ! isset( $dimension['value'], $dimension['unit'] ) ) continue;
                $actual = $settings[ $prefix . '_' . $target_key . $suffix ] ?? null;
                if ( ! is_array( $actual ) || (string) ( $actual['unit'] ?? '' ) !== (string) $dimension['unit'] || ! is_numeric( $actual['size'] ?? null ) || abs( (float) $actual['size'] - (float) $dimension['value'] ) > 0.0001 ) return false;
            }
        }
        if ( isset( $token['textTransform'] ) && sanitize_key( (string) ( $settings[ $prefix . '_text_transform' ] ?? '' ) ) !== sanitize_key( (string) $token['textTransform'] ) ) return false;
        if ( isset( $token['textDecoration'] ) && sanitize_key( (string) ( $settings[ $prefix . '_text_decoration' ] ?? '' ) ) !== sanitize_key( (string) $token['textDecoration'] ) ) return false;
        return true;
    }

    private static function elementor_global_typography_matches( array $row, array $token, $family ) {
        if ( 'custom' !== (string) ( $row['typography_typography'] ?? '' ) ) return false;
        if ( (string) ( $row['typography_font_family'] ?? '' ) !== (string) $family ) return false;
        if ( absint( $row['typography_font_weight'] ?? 0 ) !== absint( $token['weight'] ?? 0 ) ) return false;
        if ( sanitize_key( (string) ( $row['typography_font_style'] ?? '' ) ) !== sanitize_key( (string) ( $token['style'] ?? 'normal' ) ) ) return false;
        foreach ( array( 'size' => 'font_size', 'lineHeight' => 'line_height', 'letterSpacing' => 'letter_spacing', 'wordSpacing' => 'word_spacing' ) as $source_key => $target_key ) {
            foreach ( array( 'desktop' => '', 'tablet' => '_tablet', 'mobile' => '_mobile' ) as $breakpoint => $suffix ) {
                $dimension = $token[ $source_key ][ $breakpoint ] ?? null;
                if ( ! is_array( $dimension ) || ! isset( $dimension['value'], $dimension['unit'] ) ) continue;
                $actual = $row[ 'typography_' . $target_key . $suffix ] ?? null;
                if ( ! is_array( $actual ) || (string) ( $actual['unit'] ?? '' ) !== (string) $dimension['unit'] || ! is_numeric( $actual['size'] ?? null ) || abs( (float) $actual['size'] - (float) $dimension['value'] ) > 0.0001 ) return false;
            }
        }
        if ( isset( $token['textTransform'] ) && sanitize_key( (string) ( $row['typography_text_transform'] ?? '' ) ) !== sanitize_key( (string) $token['textTransform'] ) ) return false;
        if ( isset( $token['textDecoration'] ) && sanitize_key( (string) ( $row['typography_text_decoration'] ?? '' ) ) !== sanitize_key( (string) $token['textDecoration'] ) ) return false;
        return true;
    }

    private static function apply_elementor_responsive_dimension( array &$row, array $token, $source_key, $target_key ) {
        if ( empty( $token[ $source_key ] ) || ! is_array( $token[ $source_key ] ) ) return;
        foreach ( array( 'desktop' => '', 'tablet' => '_tablet', 'mobile' => '_mobile' ) as $breakpoint => $suffix ) {
            $dimension = $token[ $source_key ][ $breakpoint ] ?? null;
            if ( ! is_array( $dimension ) || ! isset( $dimension['value'], $dimension['unit'] ) || ! is_numeric( $dimension['value'] ) ) continue;
            $unit = (string) $dimension['unit'];
            if ( ! in_array( $unit, array( 'px', 'rem', 'em', '%', 'vw', 'vh', 'lh', 'rlh', '' ), true ) ) continue;
            $row[ $target_key . $suffix ] = array( 'unit' => $unit, 'size' => 0 + $dimension['value'], 'sizes' => array() );
        }
    }

    private static function remap_vnext_value( $value, array $logical, array &$missing, $path ) {
        if ( is_array( $value ) ) {
            if ( isset( $value['$wpStarterRef'] ) && is_string( $value['$wpStarterRef'] ) ) {
                if ( ! array_key_exists( $value['$wpStarterRef'], $logical ) ) {
                    $missing[] = $path . ': ' . $value['$wpStarterRef'];
                    return $value;
                }
                return $logical[ $value['$wpStarterRef'] ];
            }
            $result = array();
            foreach ( $value as $key => $child ) $result[ $key ] = self::remap_vnext_value( $child, $logical, $missing, $path . '.' . $key );
            return $result;
        }
        return $value;
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

            foreach ( (array) ( $config['adapters']['elementor']['templates'] ?? array() ) as $template ) {
                $checked++;
                $template_id = sanitize_key( (string) ( $template['id'] ?? '' ) );
                $found = $template_id ? get_posts( array( 'post_type' => 'elementor_library', 'post_status' => 'any', 'meta_key' => '_wp_starter_template_id', 'meta_value' => $template_id, 'posts_per_page' => 1, 'fields' => 'ids' ) ) : array();
                if ( empty( $found ) ) {
                    $mismatches[] = 'elementor_template:' . $template_id;
                }
            }

            if ( ! empty( $build['designSystem'] ) && $kit_id > 0 ) {
                $root = self::package_root();
                $payload = is_wp_error( $root ) ? $root : self::read_json( $root . '/' . self::VNEXT_MANIFEST_FILENAME );
                if ( is_wp_error( $payload ) ) {
                    $mismatches[] = 'starter_design_system_manifest';
                } else {
                    $design = (array) ( $payload['designSystem'] ?? array() );
                    $settings = get_post_meta( $kit_id, '_elementor_page_settings', true );
                    $settings = is_array( $settings ) ? $settings : array();
                    $colors_by_id = array();
                    foreach ( array( 'system_colors', 'custom_colors' ) as $color_collection ) {
                        foreach ( (array) ( $settings[ $color_collection ] ?? array() ) as $row ) if ( is_array( $row ) && ! empty( $row['_id'] ) ) $colors_by_id[ $row['_id'] ] = $row;
                    }
                    foreach ( (array) ( $design['colors'] ?? array() ) as $role => $value ) {
                        $checked++;
                        $id = 'wpstarter_' . substr( hash( 'sha256', 'color:' . (string) $role ), 0, 12 );
                        if ( empty( $colors_by_id[ $id ] ) || strtolower( (string) $colors_by_id[ $id ]['color'] ) !== strtolower( (string) $value ) ) $mismatches[] = 'elementor_color:' . sanitize_key( (string) $role );
                    }
                    $global_fonts_by_id = array();
                    foreach ( array( 'system_typography', 'custom_typography' ) as $font_collection ) {
                        foreach ( (array) ( $settings[ $font_collection ] ?? array() ) as $row ) if ( is_array( $row ) && ! empty( $row['_id'] ) ) $global_fonts_by_id[ $row['_id'] ] = $row;
                    }
                    foreach ( (array) ( $design['globalTypography'] ?? array() ) as $alias => $token ) {
                        if ( ! is_array( $token ) ) continue;
                        $checked++;
                        $id = sanitize_key( (string) $alias );
                        $font_role = (string) ( $token['fontRole'] ?? '' );
                        $family = (string) ( $design['fontFamilies'][ $font_role ] ?? '' );
                        if ( empty( $global_fonts_by_id[ $id ] ) || ! self::elementor_global_typography_matches( $global_fonts_by_id[ $id ], $token, $family ) ) $mismatches[] = 'elementor_global_font:' . sanitize_key( (string) $alias );
                    }
                    foreach ( (array) ( $design['globalCustomTypography'] ?? array() ) as $custom_font ) {
                        if ( ! is_array( $custom_font ) || empty( $custom_font['id'] ) || empty( $custom_font['token'] ) ) continue;
                        $checked++;
                        $id = 'wpstarter_' . substr( hash( 'sha256', 'typography:custom:' . sanitize_key( (string) $custom_font['id'] ) ), 0, 12 );
                        $token = (array) $custom_font['token'];
                        $font_role = (string) ( $token['fontRole'] ?? '' );
                        $family = (string) ( $design['fontFamilies'][ $font_role ] ?? '' );
                        if ( empty( $global_fonts_by_id[ $id ] ) || ! self::elementor_global_typography_matches( $global_fonts_by_id[ $id ], $token, $family ) ) $mismatches[] = 'elementor_global_font:' . sanitize_key( (string) $custom_font['id'] );
                    }
                    if ( ! empty( $design['fallbackFontFamily'] ) ) {
                        $checked++;
                        if ( (string) ( $settings['default_generic_fonts'] ?? '' ) !== (string) $design['fallbackFontFamily'] ) $mismatches[] = 'elementor_fallback_font_family';
                    }
                    $theme_role_prefixes = array(
                        'body'       => array( 'body_typography' ),
                        'links'      => array( 'link_normal_typography', 'link_hover_typography' ),
                        'h1'         => array( 'h1_typography' ),
                        'h2'         => array( 'h2_typography' ),
                        'h3'         => array( 'h3_typography' ),
                        'h4'         => array( 'h4_typography' ),
                        'h5'         => array( 'h5_typography' ),
                        'h6'         => array( 'h6_typography' ),
                        'buttons'    => array( 'button_typography' ),
                        'formFields' => array( 'form_label_typography', 'form_field_typography' ),
                    );
                    foreach ( (array) ( $design['typography'] ?? array() ) as $role => $token ) {
                        if ( ! is_array( $token ) || empty( $theme_role_prefixes[ $role ] ) ) continue;
                        $font_role = (string) ( $token['fontRole'] ?? '' );
                        $family = (string) ( $design['fontFamilies'][ $font_role ] ?? '' );
                        foreach ( $theme_role_prefixes[ $role ] as $prefix ) {
                            $checked++;
                            if ( ! self::elementor_theme_typography_matches( $settings, $prefix, $token, $family ) ) $mismatches[] = 'elementor_typography:' . sanitize_key( (string) $role ) . ':' . sanitize_key( $prefix );
                        }
                    }
                }
                foreach ( (array) ( $build['designSystem']['fontProfiles'] ?? array() ) as $font_profile ) {
                    foreach ( array_unique( array_map( function ( $face ) { return is_array( $face ) ? (string) ( $face['family'] ?? '' ) : ''; }, (array) ( $font_profile['faces'] ?? array() ) ) ) as $family ) {
                        if ( '' === $family ) continue;
                        $checked++;
                        $fonts = get_posts( array( 'post_type' => 'elementor_font', 'post_status' => 'any', 'posts_per_page' => 1, 'title' => $family, 'fields' => 'ids' ) );
                        if ( empty( $fonts ) || empty( get_post_meta( absint( $fonts[0] ), 'elementor_font_files', true ) ) ) $mismatches[] = 'elementor_font:' . sanitize_key( $family );
                    }
                }
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

    private static function setup_progress_data() {
        $state = self::get_state();
        $phase = isset( $state['phase'] ) ? (string) $state['phase'] : 'theme';
        $labels = array(
            'atomic_editor' => 'Disabling Elementor Atomic Editor',
            'theme' => 'Installing the theme',
            'install_plugins' => 'Installing plugins',
            'activate_plugins' => 'Activating plugins',
            'fonts' => 'Installing fonts',
            'design_system' => 'Applying Global Fonts, colors and typography',
            'elementor_templates' => 'Importing Elementor templates',
            'languages' => 'Installing language files',
            'configure' => 'Applying WordPress settings',
            'complete' => 'Complete',
        );
        $root = self::package_root();
        $build = is_wp_error( $root ) ? array() : self::read_json( $root . '/starter-build.json' );
        if ( is_wp_error( $build ) ) $build = array();
        $plugin_count = count( (array) ( $build['plugins'] ?? array() ) );
        $language_count = count( (array) ( $build['languageArchives'] ?? array() ) );
        $percentage = array(
            'theme' => 5,
            'install_plugins' => 10 + ( $plugin_count ? (int) round( 18 * min( $plugin_count, absint( $state['plugin_index'] ?? 0 ) ) / $plugin_count ) : 18 ),
            'activate_plugins' => 30 + ( $plugin_count ? (int) round( 20 * max( 0, $plugin_count - count( (array) ( $state['activation_queue'] ?? array() ) ) ) / $plugin_count ) : 20 ),
            'fonts' => 55,
            'design_system' => 64,
            'elementor_templates' => 72,
            'languages' => 78 + ( $language_count ? (int) round( 12 * min( $language_count, absint( $state['language_index'] ?? 0 ) ) / $language_count ) : 12 ),
            'configure' => 94,
            'complete' => 100,
        );
        return array( 'phase' => $phase, 'label' => $labels[ $phase ] ?? 'Preparing WordPress', 'percent' => $percentage[ $phase ] ?? 2, 'state' => $state, 'pluginCount' => $plugin_count, 'languageCount' => $language_count );
    }

    public static function render_setup_page() {
        if ( ! current_user_can( 'manage_options' ) ) return;
        $error = get_option( self::ERROR_OPTION );
        $completed = get_option( self::COMPLETE_OPTION );
        $progress = self::setup_progress_data();
        $dashboard_url = admin_url();
        echo '<div class="wrap wp-starter-setup"><h1>Setting up your WordPress site</h1>';
        if ( $error ) {
            echo '<div class="notice notice-error"><p><strong>Setup paused:</strong> ' . esc_html( $error ) . '</p></div>';
            echo '<p>Fix the issue shown above, then retry the current step.</p><p><a class="button button-primary" href="' . esc_url( self::setup_url( true ) ) . '">Retry setup</a> <a class="button" href="' . esc_url( $dashboard_url ) . '">Open dashboard</a></p></div>';
            return;
        }
        if ( $completed ) {
            echo '<div class="notice notice-success"><p><strong>Setup complete.</strong> Your WordPress site is ready.</p></div>';
            echo '<p><a class="button button-primary" href="' . esc_url( $dashboard_url ) . '">Open WordPress dashboard</a></p></div>';
            echo '<script>window.setTimeout(function(){ window.location.assign(' . wp_json_encode( $dashboard_url ) . '); }, 1800);</script>';
            return;
        }
        $percent = absint( $progress['percent'] );
        $label = esc_html( $progress['label'] );
        $phase = esc_html( str_replace( '_', ' ', $progress['phase'] ) );
        $detail = '';
        if ( 'install_plugins' === $progress['phase'] && $progress['pluginCount'] ) {
            $plugin_index = absint( $progress['state']['plugin_index'] ?? 0 );
            $detail = $plugin_index >= $progress['pluginCount'] ? 'Finishing plugin installation' : sprintf( 'Plugin %d of %d', $plugin_index + 1, $progress['pluginCount'] );
        }
        if ( 'activate_plugins' === $progress['phase'] ) $detail = 'Activating packages and completing first-run setup';
        if ( 'languages' === $progress['phase'] && $progress['languageCount'] ) {
            $language_index = absint( $progress['state']['language_index'] ?? 0 );
            $detail = $language_index >= $progress['languageCount'] ? 'Finishing language setup' : sprintf( 'Language pack %d of %d', $language_index + 1, $progress['languageCount'] );
        }
        if ( '' === $detail ) $detail = 'This step may take a little while. Keep this page open.';
        echo '<p>WP Starter is installing and configuring the packages in your build. This screen will update as each stage finishes.</p>';
        echo '<section aria-live="polite" style="max-width:720px;background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:24px;margin-top:24px">';
        echo '<div style="display:flex;justify-content:space-between;gap:16px;align-items:center"><strong>' . $label . '</strong><strong>' . $percent . '%</strong></div>';
        echo '<div role="progressbar" aria-label="WordPress setup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' . $percent . '" style="height:14px;background:#e2e4e7;border-radius:999px;overflow:hidden;margin:14px 0 10px"><div style="width:' . $percent . '%;height:100%;background:#2271b1;transition:width .35s ease"></div></div>';
        echo '<p style="margin:0;color:#646970">Stage: ' . $phase . ' · ' . esc_html( $detail ) . '</p></section>';
        echo '<script>window.setTimeout(function(){ window.location.assign(' . wp_json_encode( self::setup_url( true ) ) . '); }, 650);</script></div>';
    }

    public static function render_notice() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }
        if ( self::is_setup_page() ) return;

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
