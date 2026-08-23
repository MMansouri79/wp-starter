<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Elementor_Manager {
    /** @return array[] */
    public function apply_defaults() {
        $results = array();

        if ( ! defined( 'ELEMENTOR_VERSION' ) && ! did_action( 'elementor/loaded' ) ) {
            return array(
                $this->result( 'warning', 'Elementor', 'Elementor is not active, so Elementor defaults were skipped.' ),
            );
        }

        $options = Config::get( 'elementor_options', array() );
        foreach ( $options as $key => $value ) {
            update_option( $key, $value );
            $results[] = $this->result( 'success', 'Elementor', sprintf( 'Set option %s.', $key ) );
        }

        $kit_settings = Config::get( 'elementor_kit_settings', array() );
        if ( ! empty( $kit_settings ) ) {
            $kit_id = absint( get_option( 'elementor_active_kit' ) );

            if ( $kit_id > 0 ) {
                $current = get_post_meta( $kit_id, '_elementor_page_settings', true );
                $current = is_array( $current ) ? $current : array();
                $merged  = array_replace_recursive( $current, $kit_settings );
                update_post_meta( $kit_id, '_elementor_page_settings', $merged );
                $results[] = $this->result( 'success', 'Elementor', 'Starter Site Settings merged into the active kit.' );
            } else {
                $results[] = $this->result( 'warning', 'Elementor', 'No active Elementor kit was found.' );
            }
        }

        if ( empty( $results ) ) {
            $results[] = $this->result( 'success', 'Elementor', 'No Elementor defaults are configured yet. Audit the reference site first.' );
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
