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

        if ( ! in_array( 'fa_IR', get_available_languages(), true ) ) {
            $packages = Config::get( 'language_packages', array() );
            $relative = isset( $packages['fa_IR'] ) ? ltrim( $packages['fa_IR'], '/\\' ) : '';
            $package  = $relative ? MSS_DIR . $relative : '';

            if ( ! $package || ! file_exists( $package ) ) {
                return array(
                    $this->result(
                        'error',
                        'Language',
                        sprintf(
                            'The bundled Persian language package is missing: %s. Rebuild the Offline Installer on the Persian reference site.',
                            $relative ? $relative : '(package path not configured)'
                        )
                    ),
                );
            }

            if ( ! wp_mkdir_p( WP_LANG_DIR ) ) {
                return array( $this->result( 'error', 'Language', 'Could not create the WordPress languages directory.' ) );
            }

            $extracted = $this->extract_local_zip( $package, WP_LANG_DIR );
            if ( true !== $extracted ) {
                return array( $this->result( 'error', 'Language', $extracted ) );
            }
        }

        if ( ! in_array( 'fa_IR', get_available_languages(), true ) ) {
            return array( $this->result( 'error', 'Language', 'The offline language archive was extracted, but WordPress still cannot detect fa_IR.' ) );
        }

        update_option( 'WPLANG', 'fa_IR' );
        return array( $this->result( 'success', 'Language', 'WordPress site language set to Persian (fa_IR) using the bundled offline language files.' ) );
    }

    /**
     * Extract a local ZIP without making any network request.
     *
     * @param string $package ZIP path.
     * @param string $destination Destination directory.
     * @return true|string
     */
    private function extract_local_zip( $package, $destination ) {
        if ( class_exists( '\\ZipArchive' ) ) {
            $zip  = new \ZipArchive();
            $open = $zip->open( $package );
            if ( true !== $open ) {
                return sprintf( 'Could not open the bundled language ZIP (ZipArchive code %s).', (string) $open );
            }

            $ok = $zip->extractTo( $destination );
            $zip->close();
            return $ok ? true : 'Could not extract the bundled language ZIP.';
        }

        require_once ABSPATH . 'wp-admin/includes/class-pclzip.php';
        $archive = new \PclZip( $package );
        $result  = $archive->extract( PCLZIP_OPT_PATH, $destination );
        if ( 0 === $result ) {
            return 'PclZip could not extract the bundled language package: ' . wp_strip_all_tags( $archive->errorInfo( true ) );
        }

        return true;
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
