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
        add_management_page( 'WP Starter Exporter', 'WP Starter Exporter', 'manage_options', 'mms-wp-starter-exporter', array( __CLASS__, 'render' ) );
    }

    public static function render() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }

        $exporter = new Exporter();
        $plugins  = $exporter->plugin_inventory();
        $snippets = $exporter->snippet_selection_inventory();
        $roles    = $exporter->default_reading_roles();
        $role_options = array(
            ''        => 'Do not assign',
            'home'    => 'Home',
            'about'   => 'About',
            'contact' => 'Contact',
            'blog'    => 'Blog',
        );
        ?>
        <div class="wrap">
            <h1>WP Starter Exporter</h1>
            <p><strong>Exporter <?php echo esc_html( MMS_WP_STARTER_EXPORTER_VERSION ); ?></strong></p>
            <p>This creates a reusable starter snapshot. Source inventory and destination starter packages are deliberately separate.</p>

            <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
                <input type="hidden" name="action" value="mms_wp_starter_export">
                <?php wp_nonce_field( 'mms_wp_starter_export' ); ?>

                <h2>Starter packages</h2>
                <p>Choose which source plugins should become installation requirements in generated sites. The complete source inventory is still recorded for diagnostics, but unchecked plugins are not required by the Builder.</p>
                <div style="background:#fff;border:1px solid #dcdcde;padding:12px 16px;max-width:900px;max-height:330px;overflow:auto">
                    <?php if ( empty( $plugins ) ) : ?>
                        <p>No plugins were detected.</p>
                    <?php else : ?>
                        <?php foreach ( $plugins as $plugin ) : ?>
                            <label style="display:grid;grid-template-columns:24px minmax(220px,1fr) 120px 90px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #f0f0f1">
                                <input type="checkbox" name="starter_plugins[]" value="<?php echo esc_attr( $plugin['file'] ); ?>" <?php checked( ! empty( $plugin['active'] ) ); ?>>
                                <span><strong><?php echo esc_html( $plugin['name'] ); ?></strong><br><code><?php echo esc_html( $plugin['file'] ); ?></code></span>
                                <span><?php echo esc_html( $plugin['version'] ); ?></span>
                                <span><?php echo ! empty( $plugin['active'] ) ? '<span style="color:#008a20">Active</span>' : '<span style="color:#646970">Inactive</span>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                            </label>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </div>

                <h2 style="margin-top:28px">WordPress page roles</h2>
                <p>These are logical destination roles, not source database IDs. The Builder can safely resolve them after creating the starter pages.</p>
                <table class="form-table" role="presentation"><tbody>
                    <tr><th><label for="front_page_role">Front page</label></th><td><select id="front_page_role" name="front_page_role">
                        <?php foreach ( $role_options as $value => $label ) : ?><option value="<?php echo esc_attr( $value ); ?>" <?php selected( $roles['front_page_role'], $value ); ?>><?php echo esc_html( $label ); ?></option><?php endforeach; ?>
                    </select></td></tr>
                    <tr><th><label for="posts_page_role">Posts page</label></th><td><select id="posts_page_role" name="posts_page_role">
                        <?php foreach ( $role_options as $value => $label ) : ?><option value="<?php echo esc_attr( $value ); ?>" <?php selected( $roles['posts_page_role'], $value ); ?>><?php echo esc_html( $label ); ?></option><?php endforeach; ?>
                    </select></td></tr>
                </tbody></table>

                <h2>Code Snippets</h2>
                <p>Only selected snippets are exported. Active non-sample snippets are selected by default; inactive and bundled example snippets are left unchecked.</p>
                <div class="notice notice-warning inline"><p><strong>Secret review:</strong> snippet source code is exported verbatim. A hardcoded API key, token or password inside a selected snippet will also be exported.</p></div>
                <div style="background:#fff;border:1px solid #dcdcde;padding:12px 16px;max-width:900px;max-height:360px;overflow:auto">
                    <?php if ( empty( $snippets ) ) : ?>
                        <p>Code Snippets is unavailable or contains no portable snippets.</p>
                    <?php else : ?>
                        <?php foreach ( $snippets as $snippet ) : ?>
                            <label style="display:grid;grid-template-columns:24px minmax(220px,1fr) 130px 120px;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid #f0f0f1">
                                <input type="checkbox" name="starter_snippets[]" value="<?php echo esc_attr( $snippet['id'] ); ?>" <?php checked( ! empty( $snippet['default_selected'] ) ); ?>>
                                <span><strong><?php echo esc_html( $snippet['name'] ); ?></strong><?php echo ! empty( $snippet['sample'] ) ? ' <em style="color:#996800">sample</em>' : ''; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                                <code><?php echo esc_html( $snippet['scope'] ); ?></code>
                                <span><?php echo ! empty( $snippet['active'] ) ? '<span style="color:#008a20">Active</span>' : '<span style="color:#646970">Inactive</span>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></span>
                            </label>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </div>

                <h2 style="margin-top:28px">Portable configuration policy</h2>
                <ul style="list-style:disc;padding-left:22px">
                    <li><strong>WordPress:</strong> reusable Settings values, permalink structure and logical page roles. Site identity, URLs, admin email and raw page IDs are excluded.</li>
                    <li><strong>Elementor:</strong> structural Site Settings only: content/container width, padding, gaps, breakpoints, page-title selector, stretched-section target and default page layout.</li>
                    <li><strong>Elementor excluded:</strong> fonts, colors, typography, visual styles, custom CSS, site identity, WooCommerce page IDs, licenses/connections, Theme Builder conditions and arbitrary Kit fields.</li>
                    <li><strong>WooCommerce:</strong> the reviewed portable settings allowlist.</li>
                    <li><strong>FilterX:</strong> deferred until object-ID remapping is implemented.</li>
                </ul>
                <p><button class="button button-primary button-hero" type="submit">Download Starter Configuration</button></p>
            </form>
        </div>
        <?php
    }

    public static function handle_export() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'Insufficient permissions.' );
        }
        check_admin_referer( 'mms_wp_starter_export' );

        $selection = array(
            'starter_plugins'  => isset( $_POST['starter_plugins'] ) && is_array( $_POST['starter_plugins'] ) ? array_map( 'sanitize_text_field', wp_unslash( $_POST['starter_plugins'] ) ) : array(),
            'starter_snippets' => isset( $_POST['starter_snippets'] ) && is_array( $_POST['starter_snippets'] ) ? array_map( 'absint', $_POST['starter_snippets'] ) : array(),
            'front_page_role'  => isset( $_POST['front_page_role'] ) ? sanitize_key( wp_unslash( $_POST['front_page_role'] ) ) : '',
            'posts_page_role'  => isset( $_POST['posts_page_role'] ) ? sanitize_key( wp_unslash( $_POST['posts_page_role'] ) ) : '',
        );

        $exporter = new Exporter();
        $config   = wp_json_encode( $exporter->build_config( $selection ), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
        $manifest = wp_json_encode( $exporter->build_manifest(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
        if ( false === $config || false === $manifest ) {
            wp_die( 'Could not encode starter configuration.' );
        }

        $tmp = trailingslashit( get_temp_dir() ) . 'wp-starter-export-' . wp_generate_password( 24, false, false );
        if ( ! wp_mkdir_p( $tmp ) ) {
            wp_die( 'Could not create a temporary export directory.' );
        }
        @chmod( $tmp, 0700 );
        $config_path = $tmp . '/starter-config.json';
        $manifest_path = $tmp . '/export-manifest.json';
        if ( false === file_put_contents( $config_path, $config . "\n", LOCK_EX ) || false === file_put_contents( $manifest_path, $manifest . "\n", LOCK_EX ) ) {
            self::cleanup( $tmp ); wp_die( 'Could not write temporary export files.' );
        }
        @chmod( $config_path, 0600 ); @chmod( $manifest_path, 0600 );
        $zip_path = $tmp . '/starter-config.zip';
        if ( ! self::create_zip( $tmp, $zip_path ) || ! file_exists( $zip_path ) ) {
            self::cleanup( $tmp ); wp_die( 'Could not build the starter configuration ZIP.' );
        }
        @chmod( $zip_path, 0600 );

        nocache_headers();
        header( 'Content-Type: application/zip' );
        header( 'Content-Disposition: attachment; filename="starter-config-' . gmdate( 'Ymd-His' ) . '.zip"' );
        header( 'Content-Length: ' . filesize( $zip_path ) );
        header( 'X-Content-Type-Options: nosniff' );
        header( 'Content-Security-Policy: default-src \'none\'; sandbox' );
        readfile( $zip_path );
        self::cleanup( $tmp );
        exit;
    }

    private static function create_zip( $source_dir, $zip_path ) {
        if ( class_exists( '\\ZipArchive' ) ) {
            $zip = new \ZipArchive();
            if ( true !== $zip->open( $zip_path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE ) ) return false;
            foreach ( array( 'starter-config.json', 'export-manifest.json' ) as $name ) {
                if ( ! $zip->addFile( $source_dir . '/' . $name, $name ) ) { $zip->close(); return false; }
            }
            return $zip->close();
        }
        require_once ABSPATH . 'wp-admin/includes/class-pclzip.php';
        $archive = new \PclZip( $zip_path );
        return 0 !== $archive->create( array( $source_dir . '/starter-config.json', $source_dir . '/export-manifest.json' ), PCLZIP_OPT_REMOVE_PATH, $source_dir );
    }

    private static function cleanup( $dir ) {
        if ( ! is_dir( $dir ) ) return;
        foreach ( scandir( $dir ) as $entry ) {
            if ( '.' === $entry || '..' === $entry ) continue;
            $path = $dir . '/' . $entry;
            if ( is_dir( $path ) && ! is_link( $path ) ) self::cleanup( $path ); else @unlink( $path );
        }
        @rmdir( $dir );
    }
}
