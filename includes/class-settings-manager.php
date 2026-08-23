<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Settings_Manager {
    /** @return array[] */
    public function apply_wordpress_defaults() {
        $results = array();
        $options = Config::get( 'wordpress_options', array() );

        foreach ( $options as $key => $value ) {
            update_option( $key, $value );
            $results[] = $this->result( 'success', 'WordPress', sprintf( 'Set %s.', $key ) );
        }

        $structure = Config::get( 'permalink_structure', '/%postname%/' );
        if ( $structure ) {
            global $wp_rewrite;
            $wp_rewrite->set_permalink_structure( $structure );
            flush_rewrite_rules( false );
            $results[] = $this->result( 'success', 'WordPress', sprintf( 'Permalink structure set to %s.', $structure ) );
        }

        return $results;
    }

    /** @return array[] */
    public function clean_default_content() {
        $results = array();
        $targets = array(
            array( 'slug' => 'hello-world', 'type' => 'post', 'label' => 'Hello world' ),
            array( 'slug' => 'sample-page', 'type' => 'page', 'label' => 'Sample Page' ),
        );

        foreach ( $targets as $target ) {
            $post = get_page_by_path( $target['slug'], OBJECT, $target['type'] );
            if ( ! $post ) {
                $results[] = $this->result( 'success', 'Cleanup', $target['label'] . ' is already absent.' );
                continue;
            }

            wp_delete_post( $post->ID, true );
            $results[] = $this->result( 'success', 'Cleanup', $target['label'] . ' deleted.' );
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
