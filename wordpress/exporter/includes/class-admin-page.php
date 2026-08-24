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
            <p>Export only approved portable configuration from this reference site. Plugin/theme binaries are supplied separately to the local Builder.</p>
            <p>The export intentionally excludes users, uploads, credentials, arbitrary options, and raw database data.</p>
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
        $config   = wp_json_encode( $exporter->build_config(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );
        $manifest = wp_json_encode( $exporter->build_manifest(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );

        if ( false === $config || false === $manifest ) {
            wp_die( 'Could not encode starter configuration.' );
        }

        $tmp = trailingslashit( get_temp_dir() ) . 'wp-starter-export-' . wp_generate_password( 12, false, false );
        if ( ! wp_mkdir_p( $tmp ) ) {
            wp_die( 'Could not create a temporary export directory.' );
        }

        file_put_contents( $tmp . '/starter-config.json', $config . "\n" );
        file_put_contents( $tmp . '/export-manifest.json', $manifest . "\n" );

        $zip_path = $tmp . '/starter-config.zip';
        $ok       = self::create_zip( $tmp, $zip_path );

        if ( ! $ok || ! file_exists( $zip_path ) ) {
            self::cleanup( $tmp );
            wp_die( 'Could not build the starter configuration ZIP.' );
        }

        nocache_headers();
        header( 'Content-Type: application/zip' );
        header( 'Content-Disposition: attachment; filename="starter-config-' . gmdate( 'Ymd-His' ) . '.zip"' );
        header( 'Content-Length: ' . filesize( $zip_path ) );

        readfile( $zip_path );
        self::cleanup( $tmp );
        exit;
    }

    private static function create_zip( $source_dir, $zip_path ) {
        if ( class_exists( '\ZipArchive' ) ) {
            $zip = new \ZipArchive();
            if ( true !== $zip->open( $zip_path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE ) ) {
                return false;
            }

            foreach ( array( 'starter-config.json', 'export-manifest.json' ) as $name ) {
                $zip->addFile( $source_dir . '/' . $name, $name );
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
            if ( is_dir( $path ) ) {
                self::cleanup( $path );
            } else {
                @unlink( $path );
            }
        }

        @rmdir( $dir );
    }
}
