<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Admin_Page {
    public function hooks() {
        add_action( 'admin_menu', array( $this, 'register_pages' ) );
        add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
        add_action( 'admin_post_mss_run_setup', array( $this, 'handle_setup' ) );
        add_action( 'admin_post_mss_run_setup_step', array( $this, 'handle_setup_step' ) );
        add_action( 'admin_post_mss_cancel_setup', array( $this, 'handle_cancel_setup' ) );
        add_action( 'admin_post_mss_download_audit', array( $this, 'handle_audit' ) );
    }

    public function register_pages() {
        add_menu_page(
            'Site Starter',
            'Site Starter',
            'manage_options',
            'site-starter',
            array( $this, 'render_dashboard' ),
            'dashicons-admin-tools',
            58
        );

        add_submenu_page(
            'site-starter',
            'Site Starter Dashboard',
            'Dashboard',
            'manage_options',
            'site-starter',
            array( $this, 'render_dashboard' )
        );

        add_submenu_page(
            'site-starter',
            'Reference Audit',
            'Reference Audit',
            'manage_options',
            'site-starter-audit',
            array( $this, 'render_audit' )
        );

        add_submenu_page(
            'site-starter',
            'Initial Setup',
            'Initial Setup',
            'manage_options',
            'site-starter-setup',
            array( $this, 'render_setup' )
        );
    }

    public function enqueue_assets( $hook_suffix ) {
        $allowed_hooks = array(
            'toplevel_page_site-starter',
            'site-starter_page_site-starter-audit',
            'site-starter_page_site-starter-setup',
        );

        if ( ! in_array( $hook_suffix, $allowed_hooks, true ) ) {
            return;
        }

        wp_enqueue_style( 'mss-admin', MSS_URL . 'assets/css/admin.css', array(), MSS_VERSION );
    }

    private function page_header( $title, $description = '' ) {
        ?>
        <div class="mss-heading">
            <h1><?php echo esc_html( $title ); ?> <span class="mss-version">v<?php echo esc_html( MSS_VERSION ); ?></span></h1>
            <?php if ( $description ) : ?>
                <p class="description"><?php echo esc_html( $description ); ?></p>
            <?php endif; ?>
        </div>
        <?php
    }

    public function render_dashboard() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }

        $last_run = get_option( 'mss_last_setup_run', array() );
        $plugins  = Config::get( 'plugins', array() );
        ?>
        <div class="wrap mss-wrap">
            <?php $this->page_header( 'Site Starter', 'Reusable WordPress/Elementor setup without cloning media, users, orders, client content, or an entire old database.' ); ?>

            <div class="mss-grid">
                <section class="mss-card">
                    <h2>Reference Site Audit</h2>
                    <p>Exports the safe inventory needed to refine this starter: plugins, WordPress settings, page names, portable Elementor settings, snippet inventory and plugin option names without their values.</p>
                    <p><a class="button button-secondary" href="<?php echo esc_url( admin_url( 'admin.php?page=site-starter-audit' ) ); ?>">Open Reference Audit</a></p>
                </section>

                <section class="mss-card">
                    <h2>Initial Setup</h2>
                    <p>Use this only on a fresh or intentionally clean WordPress installation. It installs selected plugins and applies reviewed defaults.</p>
                    <p><a class="button button-primary" href="<?php echo esc_url( admin_url( 'admin.php?page=site-starter-setup' ) ); ?>">Open Initial Setup</a></p>
                </section>
            </div>

            <section class="mss-card">
                <h2>Bundled plugin packages</h2>
                <p>Private/premium plugin ZIPs are never committed to Git. Put them in the paths below before building your personal installer ZIP.</p>
                <ul class="mss-results">
                    <?php foreach ( $plugins as $plugin ) : ?>
                        <?php if ( isset( $plugin['source'] ) && 'bundled' === $plugin['source'] ) : ?>
                            <?php $exists = ! empty( $plugin['package'] ) && file_exists( MSS_DIR . ltrim( $plugin['package'], '/\\' ) ); ?>
                            <li class="mss-result mss-<?php echo $exists ? 'success' : 'warning'; ?>">
                                <strong><?php echo esc_html( $plugin['name'] ); ?>:</strong>
                                <?php echo esc_html( isset( $plugin['package'] ) ? $plugin['package'] : '' ); ?>
                                — <?php echo $exists ? 'present' : 'missing'; ?>
                            </li>
                        <?php endif; ?>
                    <?php endforeach; ?>
                </ul>
            </section>

            <section class="mss-card">
                <h2>Reviewed baseline</h2>
                <?php $default_groups = Config::get( 'plugin_option_defaults', array() ); ?>
                <?php $default_count = 0; foreach ( $default_groups as $group_options ) { $default_count += is_array( $group_options ) ? count( $group_options ) : 0; } ?>
                <p><strong><?php echo esc_html( (string) $default_count ); ?></strong> reviewed plugin option values are configured for Initial Setup.</p>
                <p>FilterX is intentionally install-only for now because the reference automatic-setup payload contains a site-specific filter-set ID.</p>
            </section>

            <section class="mss-card">
                <h2>State</h2>
                <?php if ( ! empty( $last_run ) ) : ?>
                    <p><strong>Last setup run:</strong> <?php echo esc_html( wp_date( 'Y-m-d H:i:s', isset( $last_run['timestamp'] ) ? (int) $last_run['timestamp'] : time() ) ); ?></p>
                    <p><strong>Profile:</strong> <?php echo esc_html( isset( $last_run['profile'] ) ? $last_run['profile'] : '' ); ?></p>
                    <p><strong>Starter version:</strong> <?php echo esc_html( isset( $last_run['version'] ) ? $last_run['version'] : '' ); ?></p>
                <?php else : ?>
                    <p>No initial setup has been run on this site.</p>
                <?php endif; ?>
            </section>
        </div>
        <?php
    }

    public function render_audit() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }
        ?>
        <div class="wrap mss-wrap">
            <?php $this->page_header( 'Reference Audit', 'Inspect a configured site without copying uploads, content bodies, users, orders, credentials, or arbitrary option values.' ); ?>

            <section class="mss-card">
                <h2>Export Reference Site Audit v3</h2>
                <p>Run this on the fully configured site you want to use as your reference.</p>
                <p>The JSON includes installed plugins, selected WordPress settings, page names/slugs, portable Elementor Site Kit settings, Code Snippets names/status, theme-mod keys, candidate plugin option names, and values for a small explicitly reviewed safe-option whitelist.</p>
                <p><strong>It intentionally excludes:</strong> uploads, media, users, page/post bodies, products, orders, arbitrary plugin option values, credentials/license keys, payment settings, client identity/contact data, and snippet source code.</p>

                <form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
                    <input type="hidden" name="action" value="mss_download_audit">
                    <?php wp_nonce_field( 'mss_download_audit' ); ?>
                    <?php submit_button( 'Download Reference Audit JSON', 'primary', 'submit', false ); ?>
                </form>
            </section>
        </div>
        <?php
    }

    public function render_setup() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }

        $profiles = Config::get( 'profiles', array() );
        $user_id  = get_current_user_id();
        $state    = get_transient( 'mss_setup_state_' . $user_id );
        $results  = get_transient( 'mss_results_' . $user_id );

        if ( false !== $results && empty( $state ) ) {
            delete_transient( 'mss_results_' . $user_id );
        }
        ?>
        <div class="wrap mss-wrap">
            <?php $this->page_header( 'Initial Setup', 'Apply the reviewed starter baseline to a new or intentionally clean WordPress installation.' ); ?>

            <?php if ( is_array( $results ) && ! empty( $results ) && empty( $state ) ) : ?>
                <section class="mss-card">
                    <h2>Last setup result</h2>
                    <ul class="mss-results">
                        <?php foreach ( $results as $row ) : ?>
                            <li class="mss-result mss-<?php echo esc_attr( $row['status'] ); ?>">
                                <strong><?php echo esc_html( $row['label'] ); ?>:</strong>
                                <?php echo esc_html( $row['message'] ); ?>
                            </li>
                        <?php endforeach; ?>
                    </ul>
                </section>
            <?php endif; ?>

            <?php if ( is_array( $state ) && ! empty( $state['queue'] ) ) : ?>
                <?php
                $remaining = count( $state['queue'] );
                $total     = isset( $state['total'] ) ? max( 1, (int) $state['total'] ) : $remaining;
                $completed = max( 0, $total - $remaining );
                $percent   = min( 100, (int) floor( ( $completed / $total ) * 100 ) );
                $current   = reset( $state['queue'] );
                ?>
                <section class="mss-card">
                    <h2>Setup in progress</h2>
                    <p>Site Starter now performs one potentially slow task per request so hosting gateway limits cannot kill the entire installation at once.</p>
                    <div class="mss-progress" aria-label="Setup progress">
                        <span style="width: <?php echo esc_attr( (string) $percent ); ?>%;"></span>
                    </div>
                    <p><strong><?php echo esc_html( (string) $completed ); ?> / <?php echo esc_html( (string) $total ); ?></strong> steps completed.</p>
                    <p><strong>Current step:</strong> <?php echo esc_html( isset( $current['label'] ) ? $current['label'] : 'Setup task' ); ?></p>
                    <p class="description">The next step starts automatically. If the host times out during a single plugin install, return to this page and the same step can be retried safely.</p>

                    <?php if ( ! empty( $state['results'] ) ) : ?>
                        <details class="mss-progress-results">
                            <summary>Completed step results</summary>
                            <ul class="mss-results">
                                <?php foreach ( $state['results'] as $row ) : ?>
                                    <li class="mss-result mss-<?php echo esc_attr( $row['status'] ); ?>">
                                        <strong><?php echo esc_html( $row['label'] ); ?>:</strong>
                                        <?php echo esc_html( $row['message'] ); ?>
                                    </li>
                                <?php endforeach; ?>
                            </ul>
                        </details>
                    <?php endif; ?>

                    <form id="mss-setup-step-form" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
                        <input type="hidden" name="action" value="mss_run_setup_step">
                        <?php wp_nonce_field( 'mss_run_setup_step' ); ?>
                        <?php submit_button( 'Continue Current Step', 'primary', 'submit', false ); ?>
                    </form>

                    <form class="mss-cancel-form" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
                        <input type="hidden" name="action" value="mss_cancel_setup">
                        <?php wp_nonce_field( 'mss_cancel_setup' ); ?>
                        <?php submit_button( 'Cancel Setup', 'secondary', 'submit', false ); ?>
                    </form>
                </section>
                <script>
                document.addEventListener('DOMContentLoaded', function () {
                    window.setTimeout(function () {
                        var form = document.getElementById('mss-setup-step-form');
                        if (form) {
                            if (typeof form.requestSubmit === 'function') {
                                form.requestSubmit();
                            } else {
                                form.submit();
                            }
                        }
                    }, 900);
                });
                </script>
            <?php else : ?>
                <section class="mss-card">
                    <h2>Run Initial Setup</h2>
                    <p><strong>Do not run this on the reference site unless you intentionally want to change that site.</strong></p>
                    <p>Tasks are idempotent and are now processed in separate requests. Existing starter pages and installed plugins are not duplicated.</p>

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
                            <label><input type="checkbox" name="components[]" value="theme" checked> Install/activate Hello Elementor theme</label>
                            <label><input type="checkbox" name="components[]" value="plugins" checked> Install/activate profile plugins</label>
                            <label><input type="checkbox" name="components[]" value="wordpress" checked> Apply WordPress baseline</label>
                            <label><input type="checkbox" name="components[]" value="plugin-settings" checked> Apply reviewed plugin defaults</label>
                            <label><input type="checkbox" name="components[]" value="cleanup" checked> Remove Hello World / Sample Page</label>
                            <label><input type="checkbox" name="components[]" value="pages" checked> Create starter pages</label>
                            <label><input type="checkbox" name="components[]" value="elementor" checked> Apply reviewed Elementor defaults</label>
                        </fieldset>

                        <?php submit_button( 'Run Initial Setup', 'primary', 'submit', false ); ?>
                    </form>
                </section>
            <?php endif; ?>
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
        $allowed    = array( 'theme', 'plugins', 'wordpress', 'plugin-settings', 'cleanup', 'pages', 'elementor' );
        $components = array_values( array_intersect( $components, $allowed ) );

        $runner = new Runner();
        $queue  = $runner->build_queue( $profile, $components );
        $user_id = get_current_user_id();

        if ( empty( $queue ) ) {
            set_transient(
                'mss_results_' . $user_id,
                array(
                    array(
                        'status'  => 'error',
                        'label'   => 'Setup',
                        'message' => 'Unknown starter profile or no setup components were selected.',
                    ),
                ),
                10 * MINUTE_IN_SECONDS
            );
            wp_safe_redirect( admin_url( 'admin.php?page=site-starter-setup' ) );
            exit;
        }

        delete_transient( 'mss_results_' . $user_id );
        set_transient(
            'mss_setup_state_' . $user_id,
            array(
                'version'    => MSS_VERSION,
                'profile'    => $profile,
                'components' => $components,
                'queue'      => $queue,
                'total'      => count( $queue ),
                'results'    => array(),
                'started_at' => time(),
            ),
            6 * HOUR_IN_SECONDS
        );

        wp_safe_redirect( admin_url( 'admin.php?page=site-starter-setup' ) );
        exit;
    }

    public function handle_setup_step() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'You are not allowed to run Site Starter.' );
        }

        check_admin_referer( 'mss_run_setup_step' );

        $user_id = get_current_user_id();
        $key     = 'mss_setup_state_' . $user_id;
        $state   = get_transient( $key );

        if ( ! is_array( $state ) || empty( $state['queue'] ) || empty( $state['profile'] ) ) {
            wp_safe_redirect( admin_url( 'admin.php?page=site-starter-setup' ) );
            exit;
        }

        $step    = reset( $state['queue'] );
        $runner  = new Runner();
        $results = $runner->run_step( $state['profile'], $step );

        if ( ! isset( $state['results'] ) || ! is_array( $state['results'] ) ) {
            $state['results'] = array();
        }
        $state['results'] = array_merge( $state['results'], $results );

        array_shift( $state['queue'] );

        if ( empty( $state['queue'] ) ) {
            $runner->finish( $state['profile'], isset( $state['components'] ) ? (array) $state['components'] : array() );
            set_transient( 'mss_results_' . $user_id, $state['results'], 10 * MINUTE_IN_SECONDS );
            delete_transient( $key );
        } else {
            set_transient( $key, $state, 6 * HOUR_IN_SECONDS );
        }

        wp_safe_redirect( admin_url( 'admin.php?page=site-starter-setup' ) );
        exit;
    }

    public function handle_cancel_setup() {
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_die( 'You are not allowed to cancel Site Starter setup.' );
        }

        check_admin_referer( 'mss_cancel_setup' );

        $user_id = get_current_user_id();
        delete_transient( 'mss_setup_state_' . $user_id );
        set_transient(
            'mss_results_' . $user_id,
            array(
                array(
                    'status'  => 'warning',
                    'label'   => 'Setup',
                    'message' => 'Setup was cancelled. Completed idempotent steps were left in place.',
                ),
            ),
            10 * MINUTE_IN_SECONDS
        );

        wp_safe_redirect( admin_url( 'admin.php?page=site-starter-setup' ) );
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
