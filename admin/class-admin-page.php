<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Admin_Page {
    public function hooks() {
        add_action( 'admin_menu', array( $this, 'register_page' ) );
        add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
        add_action( 'admin_post_mss_run_setup', array( $this, 'handle_setup' ) );
        add_action( 'admin_post_mss_download_audit', array( $this, 'handle_audit' ) );
    }

    public function register_page() {
        add_management_page(
            'Site Starter',
            'Site Starter',
            'manage_options',
            'site-starter',
            array( $this, 'render' )
        );
    }

    public function enqueue_assets( $hook_suffix ) {
        if ( 'tools_page_site-starter' !== $hook_suffix ) {
            return;
        }

        wp_enqueue_style( 'mss-admin', MSS_URL . 'assets/css/admin.css', array(), MSS_VERSION );
    }

    public function render() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }

        $profiles = Config::get( 'profiles', array() );
        $results  = get_transient( 'mss_results_' . get_current_user_id() );
        if ( false !== $results ) {
            delete_transient( 'mss_results_' . get_current_user_id() );
        }

        $last_run = get_option( 'mss_last_setup_run', array() );
        ?>
        <div class="wrap mss-wrap">
            <h1>Site Starter <span class="mss-version">v<?php echo esc_html( MSS_VERSION ); ?></span></h1>
            <p class="description">Build a clean new site from reviewed defaults. No media, users, orders, client content or arbitrary database copying.</p>

            <?php if ( is_array( $results ) && ! empty( $results ) ) : ?>
                <div class="mss-card">
                    <h2>Last setup result</h2>
                    <ul class="mss-results">
                        <?php foreach ( $results as $row ) : ?>
                            <li class="mss-result mss-<?php echo esc_attr( $row['status'] ); ?>">
                                <strong><?php echo esc_html( $row['label'] ); ?>:</strong>
                                <?php echo esc_html( $row['message'] ); ?>
                            </li>
                        <?php endforeach; ?>
                    </ul>
                </div>
            <?php endif; ?>

            <div class="mss-grid">
                <section class="mss-card">
                    <h2>1. Reference Site Audit</h2>
                    <p>Run this first on the fully configured site you want to use as your reference. The JSON inventory intentionally excludes uploads, users, post content, orders, arbitrary plugin options and snippet code.</p>
                    <p>It does include installed plugins, selected WordPress settings, selected Elementor options, the active Elementor Kit Site Settings, and Code Snippets names/status.</p>

                    <form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
                        <input type="hidden" name="action" value="mss_download_audit">
                        <?php wp_nonce_field( 'mss_download_audit' ); ?>
                        <?php submit_button( 'Download Reference Audit JSON', 'secondary', 'submit', false ); ?>
                    </form>
                </section>

                <section class="mss-card">
                    <h2>2. Initial Setup</h2>
                    <p>Run only on a new/clean site. Tasks are designed to be idempotent, so existing starter pages and installed plugins are not duplicated.</p>

                    <form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
                        <input type="hidden" name="action" value="mss_run_setup">
                        <?php wp_nonce_field( 'mss_run_setup' ); ?>

                        <label for="mss-profile"><strong>Profile</strong></label>
                        <select name="profile" id="mss-profile">
                            <?php foreach ( $profiles as $id => $profile ) : ?>
                                <option value="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $profile['label'] ); ?></option>
                            <?php endforeach; ?>
                        </select>

                        <fieldset class="mss-components">
                            <legend><strong>Components</strong></legend>
                            <label><input type="checkbox" name="components[]" value="plugins" checked> Install/activate profile plugins</label>
                            <label><input type="checkbox" name="components[]" value="wordpress" checked> Apply WordPress defaults</label>
                            <label><input type="checkbox" name="components[]" value="cleanup" checked> Remove Hello World / Sample Page</label>
                            <label><input type="checkbox" name="components[]" value="pages" checked> Create starter pages and assign Home/Blog</label>
                            <label><input type="checkbox" name="components[]" value="elementor" checked> Apply reviewed Elementor defaults</label>
                        </fieldset>

                        <?php submit_button( 'Run Initial Setup', 'primary', 'submit', false ); ?>
                    </form>
                </section>
            </div>

            <section class="mss-card">
                <h2>State</h2>
                <?php if ( ! empty( $last_run ) ) : ?>
                    <p><strong>Last run:</strong> <?php echo esc_html( wp_date( 'Y-m-d H:i:s', isset( $last_run['timestamp'] ) ? (int) $last_run['timestamp'] : time() ) ); ?></p>
                    <p><strong>Profile:</strong> <?php echo esc_html( isset( $last_run['profile'] ) ? $last_run['profile'] : '' ); ?></p>
                    <p><strong>Starter version:</strong> <?php echo esc_html( isset( $last_run['version'] ) ? $last_run['version'] : '' ); ?></p>
                <?php else : ?>
                    <p>No setup has been run on this site.</p>
                <?php endif; ?>
            </section>
        </div>
        <?php
    }

    public function handle_setup() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'You are not allowed to run Site Starter.' );
        }

        check_admin_referer( 'mss_run_setup' );

        $profile    = isset( $_POST['profile'] ) ? sanitize_key( wp_unslash( $_POST['profile'] ) ) : 'elementor';
        $components = isset( $_POST['components'] ) ? (array) wp_unslash( $_POST['components'] ) : array();
        $components = array_values( array_filter( array_map( 'sanitize_key', $components ) ) );
        $allowed    = array( 'plugins', 'wordpress', 'cleanup', 'pages', 'elementor' );
        $components = array_values( array_intersect( $components, $allowed ) );

        $runner  = new Runner();
        $results = $runner->run( $profile, $components );

        set_transient( 'mss_results_' . get_current_user_id(), $results, MINUTE_IN_SECONDS );
        wp_safe_redirect( admin_url( 'tools.php?page=site-starter' ) );
        exit;
    }

    public function handle_audit() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'You are not allowed to export a Site Starter audit.' );
        }

        check_admin_referer( 'mss_download_audit' );

        $auditor = new Auditor();
        $report  = $auditor->build_report();
        $json    = wp_json_encode( $report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES );

        nocache_headers();
        header( 'Content-Type: application/json; charset=utf-8' );
        header( 'Content-Disposition: attachment; filename="site-starter-reference-audit-' . gmdate( 'Ymd-His' ) . '.json"' );
        echo $json; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON download payload.
        exit;
    }
}
