<?php
namespace MMS\WPStarter\Exporter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Admin_Page {
    public static function init() {
        add_action( 'admin_menu', array( __CLASS__, 'register_menu' ) );
        add_action( 'admin_post_mms_wp_starter_export', array( __CLASS__, 'handle_export' ) );
    }

    public static function register_menu() {
        add_management_page(
            'WP Starter Exporter',
            'WP Starter Exporter',
            'manage_options',
            'mms-wp-starter-exporter',
            array( __CLASS__, 'render' )
        );
    }

    public static function render() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }

        $url = wp_nonce_url(
            admin_url( 'admin-post.php?action=mms_wp_starter_export' ),
            'mms_wp_starter_export'
        );
        ?>
        <div class="wrap">
            <h1>WP Starter Exporter</h1>
            <p><strong>Exporter <?php echo esc_html( MMS_WP_STARTER_EXPORTER_VERSION ); ?></strong></p>
            <p>This export uses explicit allowlists and is intended for reusable starter configuration, not cloning a site.</p>
            <ul style="list-style:disc;padding-left:22px">
                <li><strong>WordPress:</strong> reusable Settings values, permalink structure, logical front/posts page references, and existing Home/About/Contact/Blog page definitions.</li>
                <li><strong>Elementor:</strong> structural Site Settings only: content/container width, container padding, widget gaps, breakpoints, page-title selector, stretched-section target, and default page layout.</li>
                <li><strong>Elementor excluded:</strong> colors, fonts, typography, body/link/heading/button/form/lightbox styles, custom CSS, site identity, logo, favicon, site title/description, WooCommerce page IDs, licenses/connections, Theme Builder conditions, editor preferences, beta/experiment state, and arbitrary Kit fields.</li>
                <li><strong>Code Snippets:</strong> reusable plugin preferences plus non-trashed snippets. Database IDs, cloud IDs, revision/error state, network-sharing state and condition IDs are excluded.</li>
                <li><strong>WooCommerce:</strong> the existing reviewed portable settings allowlist.</li>
                <li><strong>FilterX:</strong> still deferred until the portable ID-remapping adapter is implemented.</li>
            </ul>
            <div class="notice notice-warning inline"><p><strong>Code Snippets warning:</strong> snippet source code is intentionally included. If a snippet contains a hardcoded API key, token, password or other secret, that secret will be inside the export. Review sensitive snippets before moving the snapshot to another site.</p></div>
            <p>The export does not intentionally include users, uploads/media, arbitrary wp_options, raw database data, licenses, connected-account data, or site-specific object IDs.</p>
            <p><a class="button button-primary" href="<?php echo esc_url( $url ); ?>">Download Starter Configuration</a></p>
        </div>
        <?php
    }

    public static function handle_export() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'Insufficient permissions.' );
        }

        check_admin_referer( 'mms_wp_starter_export' );

        $exporter = new Exporter();
        $config   = wp_json_encode( $exporter->build_config(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
        $manifest = wp_json_encode( $exporter->build_manifest(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );

        if ( false === $config || false === $manifest ) {
            wp_die( 'Could not encode starter configuration.' );
        }

        $tmp = trailingslashit( get_temp_dir() ) . 'wp-starter-export-' . wp_generate_password( 20, false, false );
        if ( ! wp_mkdir_p( $tmp ) ) {
            wp_die( 'Could not create a temporary export directory.' );
        }
        @chmod( $tmp, 0700 );

        $config_path   = $tmp . '/starter-config.json';
        $manifest_path = $tmp . '/export-manifest.json';

        if ( false === file_put_contents( $config_path, $config . "\n", LOCK_EX ) || false === file_put_contents( $manifest_path, $manifest . "\n", LOCK_EX ) ) {
            self::cleanup( $tmp );
            wp_die( 'Could not write temporary export files.' );
        }
        @chmod( $config_path, 0600 );
        @chmod( $manifest_path, 0600 );

        $zip_path = $tmp . '/starter-config.zip';
        $ok       = self::create_zip( $tmp, $zip_path );

        if ( ! $ok || ! file_exists( $zip_path ) ) {
            self::cleanup( $tmp );
            wp_die( 'Could not build the starter configuration ZIP.' );
        }
        @chmod( $zip_path, 0600 );

        nocache_headers();
        header( 'Content-Type: application/zip' );
        header( 'Content-Disposition: attachment; filename="starter-config-' . gmdate( 'Ymd-His' ) . '.zip"' );
        header( 'Content-Length: ' . filesize( $zip_path ) );
        header( 'X-Content-Type-Options: nosniff' );

        readfile( $zip_path );
        self::cleanup( $tmp );
        exit;
    }

    private static function create_zip( $source_dir, $zip_path ) {
        if ( class_exists( '\\ZipArchive' ) ) {
            $zip = new \ZipArchive();
            if ( true !== $zip->open( $zip_path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE ) ) {
                return false;
            }

            foreach ( array( 'starter-config.json', 'export-manifest.json' ) as $name ) {
                if ( ! $zip->addFile( $source_dir . '/' . $name, $name ) ) {
                    $zip->close();
                    return false;
                }
            }

            return $zip->close();
        }

        require_once ABSPATH . 'wp-admin/includes/class-pclzip.php';
        $archive = new \PclZip( $zip_path );
        $files   = array(
            $source_dir . '/starter-config.json',
            $source_dir . '/export-manifest.json',
        );

        return 0 !== $archive->create( $files, PCLZIP_OPT_REMOVE_PATH, $source_dir );
    }

    private static function cleanup( $dir ) {
        if ( ! is_dir( $dir ) ) {
            return;
        }

        foreach ( scandir( $dir ) as $entry ) {
            if ( '.' === $entry || '..' === $entry ) {
                continue;
            }

            $path = $dir . '/' . $entry;
            if ( is_dir( $path ) && ! is_link( $path ) ) {
                self::cleanup( $path );
            } else {
                @unlink( $path );
            }
        }

        @rmdir( $dir );
    }
}
