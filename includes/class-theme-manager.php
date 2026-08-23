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
            return array( $this->result( 'warning', 'Theme', 'No starter theme is configured.' ) );
        }

        if ( ! current_user_can( 'install_themes' ) || ! current_user_can( 'switch_themes' ) ) {
            return array( $this->result( 'error', $theme['name'], 'Current user cannot install/switch themes.' ) );
        }

        $installed = wp_get_theme( $theme['slug'] );
        if ( ! $installed->exists() ) {
            if ( 'wordpress.org' !== $theme['source'] ) {
                return array( $this->result( 'warning', $theme['name'], 'Only WordPress.org theme installation is supported right now.' ) );
            }

            require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

            $package = ! empty( $theme['package_url'] ) ? $theme['package_url'] : '';
            $direct_error = '';

            if ( $package ) {
                $result = $this->install_package( $package );
                if ( true !== $result ) {
                    $direct_error = 'Direct package: ' . $result;
                }
            }

            if ( ! $package || $direct_error ) {
                require_once ABSPATH . 'wp-admin/includes/theme.php';
                $api = themes_api(
                    'theme_information',
                    array(
                        'slug'   => $theme['slug'],
                        'fields' => array( 'sections' => false ),
                    )
                );

                if ( is_wp_error( $api ) ) {
                    $message = 'WordPress.org API: ' . $this->format_wp_error( $api );
                    if ( $direct_error ) {
                        $message = $direct_error . ' | ' . $message;
                    }
                    return array( $this->result( 'error', $theme['name'], $message ) );
                }

                if ( empty( $api->download_link ) ) {
                    return array( $this->result( 'error', $theme['name'], trim( $direct_error . ' | WordPress.org did not return a theme package.', ' |' ) ) );
                }

                $fallback = $this->install_package( $api->download_link );
                if ( true !== $fallback ) {
                    return array( $this->result( 'error', $theme['name'], trim( $direct_error . ' | API package: ' . $fallback, ' |' ) ) );
                }
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

        return array( $this->result( 'success', $theme['name'], 'Installed and activated.' ) );
    }

    /**
     * @param string $package Remote or local package.
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
            return 'Installation did not complete. The server may be unable to download or write the package.';
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
