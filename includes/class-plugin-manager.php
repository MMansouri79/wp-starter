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
                return $this->result( 'error', $plugin['name'], $activated->get_error_message() );
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

    /** @return array */
    private function install_from_wordpress_org( array $plugin ) {
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
            return $this->result( 'error', $plugin['name'], $api->get_error_message() );
        }

        if ( empty( $api->download_link ) ) {
            return $this->result( 'error', $plugin['name'], 'WordPress.org did not return a download package.' );
        }

        return $this->install_package( $plugin, $api->download_link );
    }

    /** @return array */
    private function install_from_bundled_package( array $plugin ) {
        $relative = isset( $plugin['package'] ) ? ltrim( $plugin['package'], '/\\' ) : '';
        $package  = $relative ? MSS_DIR . $relative : '';

        if ( ! $package || ! file_exists( $package ) ) {
            return $this->result(
                'warning',
                $plugin['name'],
                sprintf( 'Bundled package is missing. Add %s before building the installer ZIP.', $relative ? $relative : 'a package path' )
            );
        }

        return $this->install_package( $plugin, $package );
    }

    /** @return array */
    private function install_package( array $plugin, $package ) {
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

        $skin      = new \Automatic_Upgrader_Skin();
        $upgrader  = new \Plugin_Upgrader( $skin );
        $installed = $upgrader->install( $package );

        if ( is_wp_error( $installed ) ) {
            return $this->result( 'error', $plugin['name'], $installed->get_error_message() );
        }

        if ( ! $installed ) {
            return $this->result( 'error', $plugin['name'], 'Installation did not complete.' );
        }

        wp_clean_plugins_cache( true );

        $file = isset( $plugin['file'] ) ? $plugin['file'] : '';
        if ( ! $file || ! file_exists( WP_PLUGIN_DIR . '/' . $file ) ) {
            return $this->result( 'warning', $plugin['name'], 'Installed, but the configured main plugin file was not found. Check the manifest.' );
        }

        $activated = activate_plugin( $file );
        if ( is_wp_error( $activated ) ) {
            return $this->result( 'error', $plugin['name'], $activated->get_error_message() );
        }

        return $this->result( 'success', $plugin['name'], 'Installed and activated.' );
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
