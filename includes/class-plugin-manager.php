<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Plugin_Manager {
    /**
     * Ensure configured plugins are installed and active.
     *
     * @param string[] $plugin_ids Config plugin IDs.
     * @return array[] Result rows.
     */
    public function ensure_plugins( array $plugin_ids ) {
        $definitions = Config::get( 'plugins', array() );
        $results     = array();

        foreach ( $plugin_ids as $plugin_id ) {
            if ( empty( $definitions[ $plugin_id ] ) ) {
                $results[] = $this->result( 'warning', $plugin_id, 'Plugin definition is missing.' );
                continue;
            }

            $results[] = $this->ensure_plugin( $definitions[ $plugin_id ] );
        }

        return $results;
    }

    /**
     * @param array $plugin Plugin definition.
     * @return array
     */
    private function ensure_plugin( array $plugin ) {
        if ( ! current_user_can( 'install_plugins' ) || ! current_user_can( 'activate_plugins' ) ) {
            return $this->result( 'error', $plugin['name'], 'Current user cannot install/activate plugins.' );
        }

        if ( ! function_exists( 'is_plugin_active' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $file = isset( $plugin['file'] ) ? $plugin['file'] : '';

        if ( $file && file_exists( WP_PLUGIN_DIR . '/' . $file ) ) {
            if ( is_plugin_active( $file ) ) {
                return $this->result( 'success', $plugin['name'], 'Already installed and active.' );
            }

            $activated = activate_plugin( $file );
            if ( is_wp_error( $activated ) ) {
                return $this->result( 'error', $plugin['name'], $this->format_wp_error( $activated ) );
            }

            return $this->result( 'success', $plugin['name'], 'Existing plugin activated.' );
        }

        $source = isset( $plugin['source'] ) ? $plugin['source'] : '';

        if ( 'wordpress.org' === $source ) {
            return $this->install_from_wordpress_org( $plugin );
        }

        if ( 'bundled' === $source ) {
            return $this->install_from_bundled_package( $plugin );
        }

        return $this->result( 'warning', $plugin['name'], 'Unknown plugin source.' );
    }

    /**
     * Install a public plugin without requiring the WordPress.org metadata API.
     *
     * The reference environment showed that api.wordpress.org can be blocked
     * while downloads.wordpress.org still works. Prefer a configured direct
     * package URL, then fall back to plugins_api() only if needed.
     *
     * @param array $plugin Plugin definition.
     * @return array
     */
    private function install_from_wordpress_org( array $plugin ) {
        $errors = array();

        if ( ! empty( $plugin['package_url'] ) ) {
            $direct = $this->install_package( $plugin, $plugin['package_url'], false );
            if ( 'success' === $direct['status'] ) {
                $direct['message'] = 'Installed and activated from the direct WordPress.org package.';
                return $direct;
            }

            $errors[] = 'Direct package: ' . $direct['message'];
        }

        require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

        $api = plugins_api(
            'plugin_information',
            array(
                'slug'   => $plugin['slug'],
                'fields' => array( 'sections' => false ),
            )
        );

        if ( is_wp_error( $api ) ) {
            $errors[] = 'WordPress.org API: ' . $this->format_wp_error( $api );
            return $this->result( 'error', $plugin['name'], implode( ' | ', $errors ) );
        }

        if ( empty( $api->download_link ) ) {
            $errors[] = 'WordPress.org API did not return a download package.';
            return $this->result( 'error', $plugin['name'], implode( ' | ', $errors ) );
        }

        $fallback = $this->install_package( $plugin, $api->download_link, false );
        if ( 'success' === $fallback['status'] ) {
            $fallback['message'] = 'Installed and activated using the WordPress.org API fallback.';
            return $fallback;
        }

        $errors[] = 'API package: ' . $fallback['message'];
        return $this->result( 'error', $plugin['name'], implode( ' | ', $errors ) );
    }

    /** @return array */
    private function install_from_bundled_package( array $plugin ) {
        $relative = isset( $plugin['package'] ) ? ltrim( $plugin['package'], '/\\' ) : '';
        $package  = $relative ? MSS_DIR . $relative : '';

        if ( ! $package || ! file_exists( $package ) ) {
            return $this->result(
                'warning',
                $plugin['name'],
                sprintf( 'Bundled package is missing. Add %s to the personal installer build, or install this plugin manually and retry this step.', $relative ? $relative : 'a package path' )
            );
        }

        return $this->install_package( $plugin, $package );
    }

    /**
     * @param array        $plugin Plugin definition.
     * @param string       $package Remote URL or local ZIP path.
     * @param bool         $normalize_errors Convert failure directly to result row.
     * @return array
     */
    private function install_package( array $plugin, $package, $normalize_errors = true ) {
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

        $skin      = new \Automatic_Upgrader_Skin();
        $upgrader  = new \Plugin_Upgrader( $skin );
        $installed = $upgrader->install( $package );

        if ( is_wp_error( $installed ) ) {
            return $this->result( 'error', $plugin['name'], $this->format_wp_error( $installed ) );
        }

        if ( is_wp_error( $skin->result ) ) {
            return $this->result( 'error', $plugin['name'], $this->format_wp_error( $skin->result ) );
        }

        if ( method_exists( $skin, 'get_errors' ) ) {
            $skin_errors = $skin->get_errors();
            if ( is_wp_error( $skin_errors ) && $skin_errors->has_errors() ) {
                return $this->result( 'error', $plugin['name'], $this->format_wp_error( $skin_errors ) );
            }
        }

        if ( ! $installed ) {
            return $this->result( 'error', $plugin['name'], 'Installation did not complete. The server may be unable to download or write the package.' );
        }

        wp_clean_plugins_cache( true );

        $file = isset( $plugin['file'] ) ? $plugin['file'] : '';
        if ( ! $file || ! file_exists( WP_PLUGIN_DIR . '/' . $file ) ) {
            return $this->result( 'warning', $plugin['name'], 'Installed, but the configured main plugin file was not found. Check the manifest/package directory name.' );
        }

        $activated = activate_plugin( $file );
        if ( is_wp_error( $activated ) ) {
            return $this->result( 'error', $plugin['name'], $this->format_wp_error( $activated ) );
        }

        return $this->result( 'success', $plugin['name'], 'Installed and activated.' );
    }

    /**
     * Include the actual WP_Error code because the stock translated message is
     * often too generic to diagnose blocked outbound HTTPS or filesystem issues.
     *
     * @param \WP_Error $error Error object.
     * @return string
     */
    private function format_wp_error( $error ) {
        if ( ! is_wp_error( $error ) ) {
            return 'Unknown WordPress error.';
        }

        $codes = $error->get_error_codes();
        $code  = ! empty( $codes ) ? implode( ',', array_map( 'sanitize_key', $codes ) ) : 'unknown_error';
        return sprintf( '[%s] %s', $code, wp_strip_all_tags( $error->get_error_message() ) );
    }

    /** @return array */
    private function result( $status, $label, $message ) {
        return array(
            'status'  => $status,
            'label'   => $label,
            'message' => $message,
        );
    }
}
