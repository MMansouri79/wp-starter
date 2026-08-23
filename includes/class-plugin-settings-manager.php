<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Plugin_Settings_Manager {
    /** @return array[] */
    public function apply_defaults() {
        $defaults    = Config::get( 'plugin_option_defaults', array() );
        $definitions = Config::get( 'plugins', array() );
        $results     = array();

        if ( empty( $defaults ) ) {
            return array(
                $this->result( 'success', 'Plugin settings', 'No reviewed plugin option defaults are configured yet.' ),
            );
        }

        if ( ! function_exists( 'is_plugin_active' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        foreach ( $defaults as $plugin_id => $options ) {
            if ( empty( $definitions[ $plugin_id ] ) || ! is_array( $options ) ) {
                $results[] = $this->result( 'warning', 'Plugin settings', sprintf( 'Skipped unknown plugin settings group: %s.', $plugin_id ) );
                continue;
            }

            $definition = $definitions[ $plugin_id ];
            $file       = isset( $definition['file'] ) ? $definition['file'] : '';

            if ( $file && ! is_plugin_active( $file ) ) {
                $results[] = $this->result( 'warning', $definition['name'], 'Plugin is not active, so its reviewed defaults were skipped.' );
                continue;
            }

            foreach ( $options as $option_name => $value ) {
                update_option( $option_name, $value );
                $results[] = $this->result( 'success', $definition['name'], sprintf( 'Applied reviewed option %s.', $option_name ) );
            }
        }

        return $results;
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
