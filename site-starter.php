<?php
/**
 * Plugin Name: Site Starter
 * Description: Reusable WordPress/Elementor starter setup with safe reference-site auditing and idempotent setup tasks.
 * Version: 0.1.0
 * Author: MMansouri79
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Text Domain: site-starter
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'MSS_VERSION', '0.1.0' );
define( 'MSS_FILE', __FILE__ );
define( 'MSS_DIR', plugin_dir_path( __FILE__ ) );
define( 'MSS_URL', plugin_dir_url( __FILE__ ) );

require_once MSS_DIR . 'includes/class-config.php';
require_once MSS_DIR . 'includes/class-auditor.php';
require_once MSS_DIR . 'includes/class-plugin-manager.php';
require_once MSS_DIR . 'includes/class-settings-manager.php';
require_once MSS_DIR . 'includes/class-page-manager.php';
require_once MSS_DIR . 'includes/class-elementor-manager.php';
require_once MSS_DIR . 'includes/class-runner.php';
require_once MSS_DIR . 'admin/class-admin-page.php';
require_once MSS_DIR . 'includes/class-plugin.php';

MMS\SiteStarter\Plugin::instance()->boot();
