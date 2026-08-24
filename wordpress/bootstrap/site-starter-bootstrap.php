<?php
/**
 * Plugin Name: WP Starter Bootstrap
 * Description: Installs bundled local packages and applies a starter configuration after normal WordPress installation.
 * Version: 0.1.0-alpha.13
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
    const CONFIG_REVISION = 1;

    public static function init() {
        add_action( 'admin_init', array( __CLASS__, 'maybe_run' ), 1 );
        add_action( 'admin_notices', array( __CLASS__, 'render_notice' ) );
    }

    public static function maybe_run() {
        if ( wp_installing() || ! is_admin() || ! current_user_can( 'manage_options' ) ) {
            return;
        }

        $completed = get_option( self::COMPLETE_OPTION );
        $revision  = absint( get_option( self::REVISION_OPTION, 0 ) );

        if ( $completed && $revision >= self::CONFIG_REVISION ) {
            return;
        }

        // Alpha.10 introduced a configuration repair revision. Existing alpha.9
        // test installs may already be marked complete even though WooCommerce
        // pages were duplicated or Elementor had no valid active kit. Re-run
        // only the configuration phase instead of reinstalling package files.
        if ( $completed && $revision < self::CONFIG_REVISION ) {
            self::save_state( array( 'phase' => 'configure' ) );
            delete_option( self::COMPLETE_OPTION );
        }

        $build = self::read_json( WP_CONTENT_DIR . '/starter-package/starter-build.json' );
        if ( is_wp_error( $build ) ) {
            self::fail( $build->get_error_message() );
            return;
        }

        $configuration_enabled = array_key_exists( 'configurationEnabled', $build )
            ? ! empty( $build['configurationEnabled'] )
            : file_exists( WP_CONTENT_DIR . '/starter-package/starter-config.json' );
        $config = array();
        if ( $configuration_enabled ) {
            $config = self::read_json( WP_CONTENT_DIR . '/starter-package/starter-config.json' );
            if ( is_wp_error( $config ) ) {
                self::fail( $config->get_error_message() );
                return;
            }
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
            if ( $configuration_enabled ) {
                $result = self::apply_configuration( $config, $build );
                if ( is_wp_error( $result ) ) {
                    self::fail( $result->get_error_message() );
                    return;
                }
            } else {
                update_option(
                    self::REPORT_OPTION,
                    array(
                        'verification' => array( 'checked' => 0, 'mismatches' => 0 ),
                        'woocommerce_duplicates_removed' => 0,
                        'configuration_skipped' => true,
                    ),
                    false
                );
            }

            self::save_state( array( 'phase' => 'complete' ) );
            update_option( self::COMPLETE_OPTION, gmdate( 'c' ), false );
            update_option( self::REVISION_OPTION, self::CONFIG_REVISION, false );
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
        $report = array(
            'wordpress_options'  => 0,
            'elementor_options'  => 0,
            'woocommerce_options'=> 0,
            'persian_options'    => 0,
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
