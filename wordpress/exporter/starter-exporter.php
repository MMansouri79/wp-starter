<?php
/**
 * Plugin Name: WP Starter Exporter
 * Description: Exports explicitly approved portable starter configuration from a reference WordPress site.
 * Version: 0.2.0-alpha.1
 * Author: MMansouri79
 */

namespace MMS\WPStarter\Exporter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'MMS_WP_STARTER_EXPORTER_VERSION', '0.2.0-alpha.1' );
define( 'MMS_WP_STARTER_EXPORTER_DIR', plugin_dir_path( __FILE__ ) );

require_once MMS_WP_STARTER_EXPORTER_DIR . 'includes/class-exporter.php';
require_once MMS_WP_STARTER_EXPORTER_DIR . 'includes/class-admin-page.php';

Admin_Page::init();
