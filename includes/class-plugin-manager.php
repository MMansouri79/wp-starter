<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Plugin_Manager {
    /**
     * Ensure configured plugins are installed and active.
     *
     * Site Starter 0.5+ is deliberately offline-first. Every dependency must
     * exist inside the exported installer ZIP. No WordPress.org/API request is
     * attempted during installation.
     *
     * @param string[] $plugin_ids Config plugin IDs.
     * @return array[] Result rows.
     */
    public function ensure_plugins( array $plugin_ids ) {
        $definitions = Config::get( 'plugins', array() );
        $results     = array();

        foreach ( $plugin_ids as $plugin_id ) {
            if ( empty( $definitions[ $plugin_id ] ) ) {
                $results[] = $this->result( 'error', $plugin_id, 'Plugin definition is missing.' );
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

        $relative = isset( $plugin['package'] ) ? ltrim( $plugin['package'], '/\\' ) : '';
        $package  = $relative ? MSS_DIR . $relative : '';

        if ( ! $package || ! file_exists( $package ) ) {
            return $this->result(
                'error',
                $plugin['name'],
                sprintf(
                    'Offline package is missing: %s. Build a complete Offline Installer from the configured reference site first.',
                    $relative ? $relative : '(package path not configured)'
                )
            );
        }

        return $this->install_package( $plugin, $package );
    }

    /**
     * @param array  $plugin Plugin definition.
     * @param string $package Local ZIP path.
     * @return array
     */
    private function install_package( array $plugin, $package ) {
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

        if ( ! $installed ) {
            return $this->result( 'error', $plugin['name'], 'Local package installation did not complete.' );
        }

        wp_clean_plugins_cache( true );

        $file = isset( $plugin['file'] ) ? $plugin['file'] : '';
        if ( ! $file || ! file_exists( WP_PLUGIN_DIR . '/' . $file ) ) {
            return $this->result( 'error', $plugin['name'], 'Package was extracted, but the configured main plugin file was not found.' );
        }

        $activated = activate_plugin( $file );
        if ( is_wp_error( $activated ) ) {
            return $this->result( 'error', $plugin['name'], $this->format_wp_error( $activated ) );
        }

        return $this->result( 'success', $plugin['name'], 'Installed and activated from the bundled offline package.' );
    }

    /** @return string */
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
