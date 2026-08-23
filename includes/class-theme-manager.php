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
            require_once ABSPATH . 'wp-admin/includes/theme.php';

            $api = themes_api(
                'theme_information',
                array(
                    'slug'   => $theme['slug'],
                    'fields' => array( 'sections' => false ),
                )
            );

            if ( is_wp_error( $api ) ) {
                return array( $this->result( 'error', $theme['name'], $api->get_error_message() ) );
            }

            if ( empty( $api->download_link ) ) {
                return array( $this->result( 'error', $theme['name'], 'WordPress.org did not return a theme package.' ) );
            }

            $skin      = new \Automatic_Upgrader_Skin();
            $upgrader  = new \Theme_Upgrader( $skin );
            $installed = $upgrader->install( $api->download_link );

            if ( is_wp_error( $installed ) ) {
                return array( $this->result( 'error', $theme['name'], $installed->get_error_message() ) );
            }

            if ( ! $installed ) {
                return array( $this->result( 'error', $theme['name'], 'Theme installation did not complete.' ) );
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

    /** @return array */
    private function result( $status, $label, $message ) {
        return array(
            'status'  => $status,
            'label'   => $label,
            'message' => $message,
        );
    }
}
