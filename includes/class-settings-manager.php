<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Settings_Manager {
    /**
     * Set the WordPress site language independently from the starter profile.
     *
     * @param string $locale keep|en_US|fa_IR.
     * @return array[]
     */
    public function apply_site_language( $locale ) {
        $allowed = array( 'keep', 'en_US', 'fa_IR' );
        if ( ! in_array( $locale, $allowed, true ) ) {
            return array( $this->result( 'error', 'Language', 'Unsupported site language selection.' ) );
        }

        if ( 'keep' === $locale ) {
            return array( $this->result( 'success', 'Language', sprintf( 'Kept current WordPress site language (%s).', get_locale() ) ) );
        }

        if ( 'en_US' === $locale ) {
            update_option( 'WPLANG', '' );
            return array( $this->result( 'success', 'Language', 'WordPress site language set to English (United States).' ) );
        }

        require_once ABSPATH . 'wp-admin/includes/translation-install.php';

        $installed = in_array( 'fa_IR', get_available_languages(), true );
        if ( ! $installed ) {
            $downloaded = wp_download_language_pack( 'fa_IR' );
            if ( false === $downloaded ) {
                return array(
                    $this->result(
                        'error',
                        'Language',
                        'Could not download the Persian WordPress language pack. The server may be blocking outbound WordPress.org requests.'
                    ),
                );
            }
        }

        update_option( 'WPLANG', 'fa_IR' );
        return array( $this->result( 'success', 'Language', 'WordPress site language set to Persian (fa_IR).' ) );
    }

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
