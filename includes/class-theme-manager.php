<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Theme_Manager {
    /** @return array[] */
    public function ensure_theme() {
        $theme = Config::get( 'theme', array() );

        if ( empty( $theme['slug'] ) ) {
            return array( $this->result( 'error', 'Theme', 'No starter theme is configured.' ) );
        }

        if ( ! current_user_can( 'install_themes' ) || ! current_user_can( 'switch_themes' ) ) {
            return array( $this->result( 'error', $theme['name'], 'Current user cannot install/switch themes.' ) );
        }

        $installed = wp_get_theme( $theme['slug'] );
        if ( ! $installed->exists() ) {
            $relative = isset( $theme['package'] ) ? ltrim( $theme['package'], '/\\' ) : '';
            $package  = $relative ? MSS_DIR . $relative : '';

            if ( ! $package || ! file_exists( $package ) ) {
                return array(
                    $this->result(
                        'error',
                        $theme['name'],
                        sprintf(
                            'Offline theme package is missing: %s. Build a complete Offline Installer from the reference site first.',
                            $relative ? $relative : '(package path not configured)'
                        )
                    ),
                );
            }

            $result = $this->install_package( $package );
            if ( true !== $result ) {
                return array( $this->result( 'error', $theme['name'], $result ) );
            }
        }

        $current = wp_get_theme();
        if ( $current->get_stylesheet() === $theme['slug'] ) {
            return array( $this->result( 'success', $theme['name'], 'Already installed and active.' ) );
        }

        switch_theme( $theme['slug'] );
        $current = wp_get_theme();

        if ( $current->get_stylesheet() !== $theme['slug'] ) {
            return array( $this->result( 'error', $theme['name'], 'Theme was installed but could not be activated.' ) );
        }

        return array( $this->result( 'success', $theme['name'], 'Installed and activated from the bundled offline package.' ) );
    }

    /**
     * @param string $package Local ZIP path.
     * @return true|string
     */
    private function install_package( $package ) {
        require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

        $skin      = new \Automatic_Upgrader_Skin();
        $upgrader  = new \Theme_Upgrader( $skin );
        $installed = $upgrader->install( $package );

        if ( is_wp_error( $installed ) ) {
            return $this->format_wp_error( $installed );
        }
        if ( is_wp_error( $skin->result ) ) {
            return $this->format_wp_error( $skin->result );
        }
        if ( ! $installed ) {
            return 'Local theme package installation did not complete.';
        }

        wp_clean_themes_cache( true );
        return true;
    }

    /** @return string */
    private function format_wp_error( $error ) {
        $codes = is_wp_error( $error ) ? $error->get_error_codes() : array();
        $code  = ! empty( $codes ) ? implode( ',', array_map( 'sanitize_key', $codes ) ) : 'unknown_error';
        $msg   = is_wp_error( $error ) ? $error->get_error_message() : 'Unknown WordPress error.';
        return sprintf( '[%s] %s', $code, wp_strip_all_tags( $msg ) );
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
